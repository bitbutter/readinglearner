import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SPEECH_AUDIO_PREPROCESSING_VERSION, SpeechAudioPreparationError } from '../audio_preprocessing.mjs';
import { createGoogleSpeechTranscriber, extractSpeechTranscript, MAX_AUDIO_BYTES, SPEECH_MODEL_CONFIGURATION_VERSIONS, validateRecordingRequest } from '../providers.mjs';

const originalAudioBytes = Buffer.from('original recording bytes');
const preparedAudioBytes = Buffer.from('prepared mono WAV bytes');
const preparedAudioSha256 = createHash('sha256').update(preparedAudioBytes).digest('hex');
const preprocessing = Object.freeze({
  version: SPEECH_AUDIO_PREPROCESSING_VERSION, sampleRateHertz: 16000, audioChannelCount: 1,
  inputDurationMs: 2000, trimmedLeadingSilenceMs: 700, outputDurationMs: 1300,
  preparedAudioSha256,
});
const prepareAudio = async () => ({ audioBytes: preparedAudioBytes, mimeType: 'audio/wav', preprocessing });
const recordingRequest = (model = 'chirp_3') => ({
  model, audioBase64: originalAudioBytes.toString('base64'), mimeType: 'audio/webm;codecs=opus', durationMs: 2000,
});

test('recording identity is computed from the decoded original bytes', () => {
  const recording = validateRecordingRequest(recordingRequest());
  assert.equal(recording.audioSha256, createHash('sha256').update('original recording bytes').digest('hex'));
  assert.deepEqual(recording.audioBytes, originalAudioBytes);
  assert.equal(recording.mimeType, 'audio/webm;codecs=opus');
});

test('invalid recordings and target-word fields are rejected before a provider call', () => {
  for (const changes of [
    { model: 'gemini-3.5-transcribe' }, { model: 'long' }, { model: 'short ' }, { model: 'SHORT' },
    { model: null }, { model: 1 }, { model: 'toString' }, { model: '__proto__' },
    { sampleRateHertz: 48000 },
    { durationMs: 60_000 }, { durationMs: 0 }, { durationMs: '2000' },
    { audioBase64: '' }, { audioBase64: 'Zg=' }, { audioBase64: 'Zh==' }, { audioBase64: 'data:audio/webm;base64,Zg==' },
    { mimeType: 'text/plain' }, { prompt: 'mat' }, { expectedWord: 'mat' },
    { audioBase64: 'A'.repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) },
  ]) assert.throws(() => validateRecordingRequest({ ...recordingRequest(), ...changes }));
});

test('V1 accepts the same original formats because the gateway converts them to mono WAV', () => {
  for (const mimeType of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']) {
    const recording = validateRecordingRequest({ ...recordingRequest('latest_short'), mimeType });
    assert.equal(recording.mimeType, mimeType);
  }
});

test('the actual 10 MiB boundary validates without exhausting the regular expression stack', () => {
  const recording = validateRecordingRequest({ ...recordingRequest(), audioBase64: Buffer.alloc(MAX_AUDIO_BYTES).toString('base64') });
  assert.match(recording.audioSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => validateRecordingRequest({ ...recordingRequest(), audioBase64: Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64') }), error => error.code === 'recording_too_large');
});

test('Google gets the explicitly selected model, blind configuration, ADC authorization and bytes', async context => {
  assert.deepEqual(Object.keys(SPEECH_MODEL_CONFIGURATION_VERSIONS).sort(), ['chirp_3', 'latest_short', 'short']);
  for (const [model, configurationVersion] of [
    ['chirp_3', 'recorded-word-en-GB-chirp3-leading-silence-preroll-300ms-v2'],
    ['short', 'recorded-word-en-GB-short-leading-silence-preroll-300ms-v2'],
    ['latest_short', 'recorded-word-en-GB-v1-latest-short-leading-silence-preroll-300ms-v3'],
  ]) await context.test(model, async () => {
    const providerResponse = model === 'latest_short'
      ? { results: [{ alternatives: [{ transcript: 'Matt.', confidence: 0.91 }] }], totalBilledTime: '2s' }
      : { results: [{ alternatives: [{ transcript: 'Matt.', confidence: 0.91 }] }], metadata: { totalBilledDuration: '2s' } };
    let requestCount = 0;
    const transcribe = createGoogleSpeechTranscriber({
      projectId: 'reading-learner-test', getAccessToken: async () => 'fake-private-google-token',
      prepareAudio,
      fetchImplementation: async (url, options) => {
        requestCount++;
        assert.equal(url, model === 'latest_short'
          ? 'https://eu-speech.googleapis.com/v1/speech:recognize'
          : 'https://eu-speech.googleapis.com/v2/projects/reading-learner-test/locations/eu/recognizers/_:recognize');
        assert.deepEqual(options.headers, {
          Authorization: 'Bearer fake-private-google-token',
          'Content-Type': 'application/json',
          'x-goog-user-project': 'reading-learner-test',
        });
        const expectedGoogleRequest = model === 'latest_short'
          ? { config: { languageCode: 'en-GB', model }, audio: { content: preparedAudioBytes.toString('base64') } }
          : { config: { autoDecodingConfig: {}, languageCodes: ['en-GB'], model }, content: preparedAudioBytes.toString('base64') };
        assert.deepEqual(JSON.parse(options.body), expectedGoogleRequest);
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(providerResponse);
      },
    });
    const transcription = await transcribe(validateRecordingRequest(recordingRequest(model)));
    assert.equal(requestCount, 1);
    assert.equal(transcription.transcript, 'Matt.');
    assert.equal(transcription.model, model);
    assert.equal(transcription.configurationVersion, configurationVersion);
    assert.deepEqual(transcription.preprocessing, preprocessing);
    assert.deepEqual(transcription.providerResponse, providerResponse);
    assert.deepEqual(transcription.usage, model === 'latest_short' ? { totalBilledTime: '2s' } : { totalBilledDuration: '2s' });
    assert.deepEqual(transcription.alternatives, []);
  });
});

test('no-speech protobuf responses are valid; malformed transcript results fail', () => {
  assert.equal(extractSpeechTranscript({}), '');
  assert.equal(extractSpeechTranscript({ results: [] }), '');
  assert.equal(extractSpeechTranscript({ results: [{ alternatives: [{ transcript: 'one' }] }, { alternatives: [{ transcript: 'two' }] }] }), 'one two');
  for (const response of [null, [], { results: {} }, { results: [{}] }, { results: [{ alternatives: [{ confidence: 0.2 }] }] }]) {
    assert.throws(() => extractSpeechTranscript(response), /Google/);
  }
});

test('credential and project failures are explicit and never call Google', async () => {
  let calls = 0;
  const fetchImplementation = async () => { calls++; throw new Error('must not run'); };
  const badProject = createGoogleSpeechTranscriber({ fetchImplementation, getAccessToken: async () => 'unused' });
  await assert.rejects(badProject(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_project_unconfigured');
  const missingCredentials = createGoogleSpeechTranscriber({ projectId: 'reading-learner-test', fetchImplementation, prepareAudio, getAccessToken: async () => { throw new Error('sensitive credential details'); } });
  await assert.rejects(missingCredentials(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_credentials_unavailable' && !error.message.includes('sensitive'));
  assert.equal(calls, 0);
});

test('audio preparation errors stop before credentials or Google are contacted', async () => {
  let credentialCalls = 0;
  let providerCalls = 0;
  const transcribe = createGoogleSpeechTranscriber({
    projectId: 'reading-learner-test',
    prepareAudio: async () => { throw new SpeechAudioPreparationError(422, 'speech_audio_decode_failed', 'Audio decode failed.'); },
    getAccessToken: async () => { credentialCalls++; return 'unused-token'; },
    fetchImplementation: async () => { providerCalls++; throw new Error('Google must not be called'); },
  });
  await assert.rejects(transcribe(validateRecordingRequest(recordingRequest())), error =>
    error.code === 'speech_audio_decode_failed' && error.httpStatus === 422);
  assert.equal(credentialCalls, 0);
  assert.equal(providerCalls, 0);
});

test('Google rejections preserve the selected model and evidence without retrying another model', async context => {
  for (const model of ['chirp_3', 'short', 'latest_short']) await context.test(model, async () => {
    let calls = 0;
    const transcribe = createGoogleSpeechTranscriber({
      projectId: 'reading-learner-test', getAccessToken: async () => 'fake-private-google-token',
      prepareAudio,
      fetchImplementation: async url => {
        calls++;
        assert.equal(url, model === 'latest_short'
          ? 'https://eu-speech.googleapis.com/v1/speech:recognize'
          : 'https://eu-speech.googleapis.com/v2/projects/reading-learner-test/locations/eu/recognizers/_:recognize');
        return Response.json({ error: { status: 'PERMISSION_DENIED', message: 'fake-private-google-token access rejected' } }, { status: 403 });
      },
    });
    await assert.rejects(transcribe(validateRecordingRequest(recordingRequest(model))), error => {
      assert.equal(error.code, 'speech_provider_error');
      assert.equal(error.details.providerStatus, 403);
      assert.equal(error.details.model, model);
      assert.equal(error.details.configurationVersion, SPEECH_MODEL_CONFIGURATION_VERSIONS[model]);
      assert.equal(error.details.providerResponse.error.message, '[credential removed] access rejected');
      return true;
    });
    assert.equal(calls, 1);
  });
});

test('direct provider calls reject unapproved models before acquiring credentials', async () => {
  let credentialCalls = 0, providerCalls = 0;
  const transcribe = createGoogleSpeechTranscriber({
    projectId: 'reading-learner-test', getAccessToken: async () => { credentialCalls++; return 'unused-token'; },
    fetchImplementation: async () => { providerCalls++; throw new Error('must not run'); },
  });
  for (const model of ['long', 'latest_short ', 'short ', '__proto__', null]) {
    await assert.rejects(transcribe({ ...recordingRequest(), model }), error => error.code === 'unsupported_model');
  }
  assert.throws(() => validateRecordingRequest({ ...recordingRequest(), sampleRateHertz: 48000 }), error => error.code === 'unexpected_recording_fields');
  assert.equal(credentialCalls, 0);
  assert.equal(providerCalls, 0);
});

test('a provider deadline interrupts a pending recognition request without retry', async () => {
  const keepTestAlive = setTimeout(() => {}, 100);
  let calls = 0;
  try {
    const transcribe = createGoogleSpeechTranscriber({
      projectId: 'reading-learner-test', timeoutMs: 10, getAccessToken: async () => 'fake-token',
      prepareAudio,
      fetchImplementation: async (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
    });
    await assert.rejects(transcribe(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_request_timeout');
    assert.equal(calls, 1);
  } finally { clearTimeout(keepTestAlive); }
});
