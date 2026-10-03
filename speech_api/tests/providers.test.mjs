import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGoogleSpeechTranscriber, extractSpeechTranscript, MAX_AUDIO_BYTES, SPEECH_MODEL_CONFIGURATION_VERSIONS, validateRecordingRequest } from '../providers.mjs';

const opusRecordingBytes = channelCount => Buffer.concat([
  Buffer.from([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 1, channelCount, 0, 0, 0x80, 0xbb, 0, 0, 0, 0, 0]),
  Buffer.from('original recording bytes'),
]);

const recordingRequest = (model = 'chirp_3', opusChannelCount = 2) => ({
  model, audioBase64: (model === 'latest_short' ? opusRecordingBytes(opusChannelCount) : Buffer.from('original recording bytes')).toString('base64'),
  mimeType: 'audio/webm;codecs=opus', durationMs: 2000,
  ...(model === 'latest_short' ? { sampleRateHertz: 48000 } : {}),
});

test('recording identity is computed from the decoded original bytes', () => {
  const recording = validateRecordingRequest(recordingRequest());
  assert.equal(recording.audioSha256, createHash('sha256').update('original recording bytes').digest('hex'));
  assert.equal(recording.mimeType, 'audio/webm;codecs=opus');
});

test('invalid recordings and target-word fields are rejected before a provider call', () => {
  for (const changes of [
    { model: 'gemini-3.5-transcribe' }, { model: 'long' }, { model: 'short ' }, { model: 'SHORT' },
    { model: null }, { model: 1 }, { model: 'toString' }, { model: '__proto__' },
    { model: 'latest_short' }, { model: 'latest_short', sampleRateHertz: 44100 },
    { model: 'latest_short', mimeType: 'audio/mp4' },
    { durationMs: 60_000 }, { durationMs: 0 }, { durationMs: '2000' },
    { audioBase64: '' }, { audioBase64: 'Zg=' }, { audioBase64: 'Zh==' }, { audioBase64: 'data:audio/webm;base64,Zg==' },
    { mimeType: 'text/plain' }, { prompt: 'mat' }, { expectedWord: 'mat' },
    { audioBase64: 'A'.repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) },
  ]) assert.throws(() => validateRecordingRequest({ ...recordingRequest(), ...changes }));
});

test('V1 derives the channel count from the saved OpusHead and rejects a missing header', () => {
  for (const opusChannelCount of [1, 2]) {
    const recording = validateRecordingRequest(recordingRequest('latest_short', opusChannelCount));
    assert.equal(recording.audioChannelCount, opusChannelCount);
  }
  assert.throws(() => validateRecordingRequest({
    ...recordingRequest('chirp_3'), model: 'latest_short', sampleRateHertz: 48000,
  }), error => error.code === 'opus_channel_count_unavailable');
});

test('the actual 10 MiB boundary validates without exhausting the regular expression stack', () => {
  const recording = validateRecordingRequest({ ...recordingRequest(), audioBase64: Buffer.alloc(MAX_AUDIO_BYTES).toString('base64') });
  assert.match(recording.audioSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => validateRecordingRequest({ ...recordingRequest(), audioBase64: Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64') }), error => error.code === 'recording_too_large');
});

test('Google gets the explicitly selected model, blind configuration, ADC authorization and bytes', async context => {
  assert.deepEqual(Object.keys(SPEECH_MODEL_CONFIGURATION_VERSIONS).sort(), ['chirp_3', 'latest_short', 'short']);
  for (const [model, configurationVersion] of [
    ['chirp_3', 'recorded-word-en-GB-chirp3-v1'], ['short', 'recorded-word-en-GB-short-v1'],
    ['latest_short', 'recorded-word-en-GB-v1-latest-short-opus-header-channel-count-v2'],
  ]) await context.test(model, async () => {
    const providerResponse = model === 'latest_short'
      ? { results: [{ alternatives: [{ transcript: 'Matt.', confidence: 0.91 }] }], totalBilledTime: '2s' }
      : { results: [{ alternatives: [{ transcript: 'Matt.', confidence: 0.91 }] }], metadata: { totalBilledDuration: '2s' } };
    let requestCount = 0;
    const transcribe = createGoogleSpeechTranscriber({
      projectId: 'reading-learner-test', getAccessToken: async () => 'fake-private-google-token',
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
          ? { config: { encoding: 'WEBM_OPUS', sampleRateHertz: 48000, audioChannelCount: 2, languageCode: 'en-GB', model }, audio: { content: recordingRequest(model).audioBase64 } }
          : { config: { autoDecodingConfig: {}, languageCodes: ['en-GB'], model }, content: recordingRequest(model).audioBase64 };
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
  const missingCredentials = createGoogleSpeechTranscriber({ projectId: 'reading-learner-test', fetchImplementation, getAccessToken: async () => { throw new Error('sensitive credential details'); } });
  await assert.rejects(missingCredentials(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_credentials_unavailable' && !error.message.includes('sensitive'));
  assert.equal(calls, 0);
});

test('Google rejections preserve the selected model and evidence without retrying another model', async context => {
  for (const model of ['chirp_3', 'short', 'latest_short']) await context.test(model, async () => {
    let calls = 0;
    const transcribe = createGoogleSpeechTranscriber({
      projectId: 'reading-learner-test', getAccessToken: async () => 'fake-private-google-token',
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
  assert.throws(() => validateRecordingRequest({ ...recordingRequest(), model: 'latest_short' }), error => error.code === 'invalid_audio_sample_rate');
  assert.equal(credentialCalls, 0);
  assert.equal(providerCalls, 0);
});

test('a provider deadline interrupts a pending recognition request without retry', async () => {
  const keepTestAlive = setTimeout(() => {}, 100);
  let calls = 0;
  try {
    const transcribe = createGoogleSpeechTranscriber({
      projectId: 'reading-learner-test', timeoutMs: 10, getAccessToken: async () => 'fake-token',
      fetchImplementation: async (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
    });
    await assert.rejects(transcribe(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_request_timeout');
    assert.equal(calls, 1);
  } finally { clearTimeout(keepTestAlive); }
});
