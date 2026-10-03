import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createChirpTranscriber, extractSpeechTranscript, MAX_AUDIO_BYTES, SPEECH_CONFIGURATION_VERSION, validateRecordingRequest } from '../providers.mjs';

const recordingRequest = () => ({ model: 'chirp_3', audioBase64: Buffer.from('original recording bytes').toString('base64'), mimeType: 'audio/webm;codecs=opus', durationMs: 2000 });

test('recording identity is computed from the decoded original bytes', () => {
  const recording = validateRecordingRequest(recordingRequest());
  assert.equal(recording.audioSha256, createHash('sha256').update('original recording bytes').digest('hex'));
  assert.equal(recording.mimeType, 'audio/webm;codecs=opus');
});

test('invalid recordings and target-word fields are rejected before a provider call', () => {
  for (const changes of [
    { model: 'gemini-3.5-transcribe' }, { durationMs: 60_000 }, { durationMs: 0 }, { durationMs: '2000' },
    { audioBase64: '' }, { audioBase64: 'Zg=' }, { audioBase64: 'Zh==' }, { audioBase64: 'data:audio/webm;base64,Zg==' },
    { mimeType: 'text/plain' }, { prompt: 'mat' }, { expectedWord: 'mat' },
    { audioBase64: 'A'.repeat(Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) },
  ]) assert.throws(() => validateRecordingRequest({ ...recordingRequest(), ...changes }));
});

test('the actual 10 MiB boundary validates without exhausting the regular expression stack', () => {
  const recording = validateRecordingRequest({ ...recordingRequest(), audioBase64: Buffer.alloc(MAX_AUDIO_BYTES).toString('base64') });
  assert.match(recording.audioSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => validateRecordingRequest({ ...recordingRequest(), audioBase64: Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64') }), error => error.code === 'recording_too_large');
});

test('Google gets the exact blind Chirp 3 configuration, ADC authorization and bytes', async () => {
  const providerResponse = { results: [{ alternatives: [{ transcript: 'Matt.', confidence: 0.91 }] }], metadata: { totalBilledDuration: '2s' } };
  let requestCount = 0;
  const transcribe = createChirpTranscriber({
    projectId: 'reading-learner-test', getAccessToken: async () => 'fake-private-google-token',
    fetchImplementation: async (url, options) => {
      requestCount++;
      assert.equal(url, 'https://eu-speech.googleapis.com/v2/projects/reading-learner-test/locations/eu/recognizers/_:recognize');
      assert.deepEqual(options.headers, {
        Authorization: 'Bearer fake-private-google-token',
        'Content-Type': 'application/json',
        'x-goog-user-project': 'reading-learner-test',
      });
      assert.deepEqual(JSON.parse(options.body), {
        config: { autoDecodingConfig: {}, languageCodes: ['en-GB'], model: 'chirp_3' }, content: recordingRequest().audioBase64,
      });
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json(providerResponse);
    },
  });
  const transcription = await transcribe(validateRecordingRequest(recordingRequest()));
  assert.equal(requestCount, 1);
  assert.equal(transcription.transcript, 'Matt.');
  assert.equal(transcription.model, 'chirp_3');
  assert.equal(transcription.configurationVersion, SPEECH_CONFIGURATION_VERSION);
  assert.deepEqual(transcription.providerResponse, providerResponse);
  assert.deepEqual(transcription.usage, { totalBilledDuration: '2s' });
  assert.deepEqual(transcription.alternatives, []);
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
  const badProject = createChirpTranscriber({ fetchImplementation, getAccessToken: async () => 'unused' });
  await assert.rejects(badProject(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_project_unconfigured');
  const missingCredentials = createChirpTranscriber({ projectId: 'reading-learner-test', fetchImplementation, getAccessToken: async () => { throw new Error('sensitive credential details'); } });
  await assert.rejects(missingCredentials(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_credentials_unavailable' && !error.message.includes('sensitive'));
  assert.equal(calls, 0);
});

test('Google rejections preserve evidence, remove tokens and are never retried', async () => {
  let calls = 0;
  const transcribe = createChirpTranscriber({
    projectId: 'reading-learner-test', getAccessToken: async () => 'fake-private-google-token',
    fetchImplementation: async () => { calls++; return Response.json({ error: { status: 'PERMISSION_DENIED', message: 'fake-private-google-token access rejected' } }, { status: 403 }); },
  });
  await assert.rejects(transcribe(validateRecordingRequest(recordingRequest())), error => {
    assert.equal(error.code, 'speech_provider_error');
    assert.equal(error.details.providerStatus, 403);
    assert.equal(error.details.providerResponse.error.message, '[credential removed] access rejected');
    return true;
  });
  assert.equal(calls, 1);
});

test('a provider deadline interrupts a pending recognition request without retry', async () => {
  const keepTestAlive = setTimeout(() => {}, 100);
  let calls = 0;
  try {
    const transcribe = createChirpTranscriber({
      projectId: 'reading-learner-test', timeoutMs: 10, getAccessToken: async () => 'fake-token',
      fetchImplementation: async (_url, { signal }) => { calls++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })); },
    });
    await assert.rejects(transcribe(validateRecordingRequest(recordingRequest())), error => error.code === 'speech_request_timeout');
    assert.equal(calls, 1);
  } finally { clearTimeout(keepTestAlive); }
});
