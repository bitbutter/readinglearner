import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createSpeechGateway, readGatewayConfiguration } from '../server.mjs';
import { SPEECH_AUDIO_PREPROCESSING_VERSION, SpeechAudioPreparationError } from '../audio_preprocessing.mjs';
import { createGoogleSpeechTranscriber, MAX_REQUEST_BYTES } from '../providers.mjs';

const gatewayToken = 'fake-gateway-token-at-least-24-characters';
const referenceBucket = 'reading-learner-test-references';
const gatewayEnvironment = { SPEECH_GATEWAY_TOKEN: gatewayToken, SPEECH_REFERENCE_BUCKET: referenceBucket };
const recording = { model: 'chirp_3', audioBase64: Buffer.from('recording').toString('base64'), mimeType: 'audio/webm', durationMs: 2000 };
const latestShortRecording = { ...recording, model: 'latest_short' };
const preparedAudioBytes = Buffer.from('prepared mono WAV bytes');
const preparedAudioSha256 = createHash('sha256').update(preparedAudioBytes).digest('hex');
const preprocessing = {
  version: SPEECH_AUDIO_PREPROCESSING_VERSION, sampleRateHertz: 16000, audioChannelCount: 1,
  inputDurationMs: 2000, trimmedLeadingSilenceMs: 700, outputDurationMs: 1300, preparedAudioSha256,
};
const prepareAudio = async () => ({ audioBytes: preparedAudioBytes, mimeType: 'audio/wav', preprocessing });
const authorizedHeaders = { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' };

async function withGateway(configChanges, transcribe, run, now, referenceLibrary, prepareAudio) {
  const configuration = { ...readGatewayConfiguration(gatewayEnvironment), ...configChanges };
  const server = createSpeechGateway({ configuration, transcribe, now, referenceLibrary, prepareAudio });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/transcribe`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('configuration requires a private token and exact allowed origins', () => {
  assert.throws(() => readGatewayConfiguration({}), /SPEECH_GATEWAY_TOKEN/);
  assert.throws(() => readGatewayConfiguration({ ...gatewayEnvironment, SPEECH_ALLOWED_ORIGINS: '*' }), /exact/);
  assert.throws(() => readGatewayConfiguration({ ...gatewayEnvironment, SPEECH_ALLOWED_ORIGINS: 'https://example.com/path' }), /exact/);
  assert.throws(() => readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken }), /SPEECH_REFERENCE_BUCKET/);
});

test('network exposure requires an explicit container host; local binding remains the default', () => {
  const localConfiguration = readGatewayConfiguration(gatewayEnvironment);
  assert.equal(localConfiguration.host, '127.0.0.1');
  assert.equal(localConfiguration.port, 8081);
  const containerConfiguration = readGatewayConfiguration({ ...gatewayEnvironment, SPEECH_GATEWAY_HOST: '0.0.0.0', PORT: '8080' });
  assert.equal(containerConfiguration.host, '0.0.0.0');
  assert.equal(containerConfiguration.port, 8080);
  for (const host of ['', 'localhost', '::', '192.168.1.1', 'example.com', '0.0.0.0 ']) {
    assert.throws(() => readGatewayConfiguration({ ...gatewayEnvironment, SPEECH_GATEWAY_HOST: host }), /SPEECH_GATEWAY_HOST/);
  }
});

test('token, origin, route, content type and target metadata are rejected before transcription', async () => {
  let calls = 0;
  await withGateway({}, async () => { calls++; }, async endpoint => {
    const requests = [
      { headers: { ...authorizedHeaders, Authorization: 'Bearer wrong' }, status: 401 },
      { headers: { ...authorizedHeaders, Origin: 'https://evil.example' }, status: 403 },
      { headers: { ...authorizedHeaders, 'Content-Type': 'text/plain' }, status: 415 },
      { body: { ...recording, expectedWord: 'mat' }, status: 400 },
      { body: { ...recording, durationMs: 60_000 }, status: 400 },
      { body: { ...recording, model: 'latest_short', sampleRateHertz: 48000 }, status: 400 },
      { body: { ...recording, model: 'long' }, status: 400 },
      { path: '/elsewhere', status: 404 },
    ];
    for (const badRequest of requests) {
      const response = await fetch(badRequest.path ? new URL(badRequest.path, endpoint) : endpoint, {
        method: 'POST', headers: badRequest.headers || authorizedHeaders, body: JSON.stringify(badRequest.body || recording),
      });
      assert.equal(response.status, badRequest.status);
      assert.ok((await response.json()).error.code);
      if (badRequest.status === 403) assert.equal(response.headers.get('access-control-allow-origin'), null);
    }
  });
  assert.equal(calls, 0);
});

test('preflight allows only the configured origin, POST and necessary headers', async () => {
  await withGateway({}, async () => { throw new Error('preflight must not transcribe'); }, async endpoint => {
    for (const path of ['/transcribe', '/playback-preview']) {
      const response = await fetch(new URL(path, endpoint), { method: 'OPTIONS', headers: {
        Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
      } });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8080');
    }
    const wrongMethod = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'DELETE' } });
    assert.equal(wrongMethod.status, 400);
  });
});

test('reference-library requests use the private token and stay separate from Google transcription quota', async () => {
  const referenceCalls = [];
  const reference = { referenceId: '20000000-0000-4000-8000-000000000001', word: 'mat', attemptId: '20000000-0000-4000-8000-000000000001' };
  const referenceLibrary = {
    async listReferences() { referenceCalls.push(['list']); return [reference]; },
    async approveReference(body) { referenceCalls.push(['approve', body]); return reference; },
    async compareRecording(body) { referenceCalls.push(['compare', body]); return { scoringStatus: 'experimental-uncalibrated', targetRank: 1 }; },
    async deleteReference(id) { referenceCalls.push(['delete', id]); return { referenceId: id, deleted: true }; },
  };
  let transcriptions = 0;
  await withGateway({ requestsPerMinute: 1 }, async () => { transcriptions++; return { transcript: 'mat' }; }, async endpoint => {
    const referencesUrl = new URL('/references', endpoint);
    const getResponse = await fetch(referencesUrl, { headers: authorizedHeaders });
    assert.equal(getResponse.status, 200);
    assert.deepEqual(await getResponse.json(), { references: [reference] });
    const comparisonResponse = await fetch(new URL('/compare', endpoint), {
      method: 'POST', headers: authorizedHeaders, body: JSON.stringify({ attemptId: 'candidate' }),
    });
    assert.equal(comparisonResponse.status, 200);
    assert.equal((await comparisonResponse.json()).scoringStatus, 'experimental-uncalibrated');
    const approvalResponse = await fetch(referencesUrl, {
      method: 'POST', headers: authorizedHeaders, body: JSON.stringify({ attemptId: 'approved' }),
    });
    assert.equal(approvalResponse.status, 201);
    const deleteResponse = await fetch(new URL(`/references/${reference.referenceId}`, endpoint), {
      method: 'DELETE', headers: { Authorization: authorizedHeaders.Authorization, Origin: authorizedHeaders.Origin },
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).deleted, true);
    const transcriptionResponse = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal(transcriptionResponse.status, 200);
    assert.equal((await transcriptionResponse.json()).transcript, 'mat');
    const secondTranscription = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal((await secondTranscription.json()).error.code, 'transcription_rate_limit');
  }, undefined, referenceLibrary);
  assert.deepEqual(referenceCalls.map(call => call[0]), ['list', 'compare', 'approve', 'delete']);
  assert.equal(transcriptions, 1);
});

test('reference endpoints require authorization and reject unsupported CORS methods', async () => {
  const referenceLibrary = {
    async listReferences() { throw new Error('unauthorized reference list must not be read'); },
    async approveReference() { throw new Error('unauthorized reference must not be saved'); },
    async compareRecording() { throw new Error('unauthorized comparison must not run'); },
    async deleteReference() { throw new Error('unauthorized reference must not be deleted'); },
  };
  await withGateway({}, async () => ({ transcript: 'mat' }), async endpoint => {
    const response = await fetch(new URL('/references', endpoint), {
      headers: { Origin: authorizedHeaders.Origin },
    });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'gateway_token_required');
    const preflight = await fetch(new URL('/references/20000000-0000-4000-8000-000000000001', endpoint), {
      method: 'OPTIONS', headers: {
        Origin: authorizedHeaders.Origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization',
      },
    });
    assert.equal(preflight.status, 400);
  }, undefined, referenceLibrary);
});

test('processed playback uses the shared preparation pipeline without Google or reference storage calls', async () => {
  const preparationCalls = [], referenceCalls = [];
  let transcriptionCalls = 0;
  const referenceLibrary = {
    async listReferences() { referenceCalls.push('list'); return []; },
    async approveReference() { referenceCalls.push('approve'); return {}; },
    async compareRecording() { referenceCalls.push('compare'); return {}; },
    async deleteReference() { referenceCalls.push('delete'); return {}; },
  };
  const prepareAudio = async request => {
    preparationCalls.push(request);
    return { audioBytes: preparedAudioBytes, mimeType: 'audio/wav', preprocessing };
  };
  const previewRequestBody = { audioBase64: recording.audioBase64, mimeType: recording.mimeType, durationMs: recording.durationMs };
  await withGateway({ requestsPerMinute: 1 }, async () => {
    transcriptionCalls++;
    return { transcript: 'mat' };
  }, async endpoint => {
    const previewResponse = await fetch(new URL('/playback-preview', endpoint), {
      method: 'POST', headers: authorizedHeaders, body: JSON.stringify(previewRequestBody),
    });
    assert.equal(previewResponse.status, 200);
    assert.equal(previewResponse.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await previewResponse.json(), {
      audioBase64: preparedAudioBytes.toString('base64'), mimeType: 'audio/wav',
      originalAudioSha256: createHash('sha256').update(Buffer.from(recording.audioBase64, 'base64')).digest('hex'),
      preprocessing,
    });
    const labelLeakResponse = await fetch(new URL('/playback-preview', endpoint), {
      method: 'POST', headers: authorizedHeaders, body: JSON.stringify({ ...previewRequestBody, expectedWord: 'mat' }),
    });
    assert.equal(labelLeakResponse.status, 400);
    assert.equal((await labelLeakResponse.json()).error.code, 'unexpected_recording_fields');
    assert.equal(preparationCalls.length, 1, 'invalid playback requests must fail before preparation');
    const transcriptionResponse = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal(transcriptionResponse.status, 200, 'a preview must not consume Google transcription quota');
    assert.equal((await transcriptionResponse.json()).transcript, 'mat');
  }, undefined, referenceLibrary, prepareAudio);
  assert.equal(preparationCalls.length, 1);
  assert.deepEqual(preparationCalls[0].audioBytes, Buffer.from(recording.audioBase64, 'base64'));
  assert.equal(preparationCalls[0].mimeType, recording.mimeType);
  assert.equal(preparationCalls[0].durationMs, recording.durationMs);
  assert.ok(preparationCalls[0].signal instanceof AbortSignal);
  assert.equal(transcriptionCalls, 1);
  assert.deepEqual(referenceCalls, []);
});

test('valid requests pass only validated recording fields and return evidence', async () => {
  await withGateway({}, async validatedRecording => {
    assert.equal(validatedRecording.audioBase64, recording.audioBase64);
    assert.match(validatedRecording.audioSha256, /^[a-f0-9]{64}$/);
    return { model: 'chirp_3', transcript: 'Matt', audioSha256: validatedRecording.audioSha256 };
  }, async endpoint => {
    const response = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).transcript, 'Matt');
  });
});

test('HTTP model comparison sends each selected model to Google and returns its distinct identity', async () => {
  const googleModels = [];
  const transcribe = createGoogleSpeechTranscriber({
    projectId: 'reading-learner-test', getAccessToken: async () => 'private-test-google-token',
    prepareAudio,
    fetchImplementation: async (url, options) => {
      const googleRequest = JSON.parse(options.body);
      googleModels.push(googleRequest.config.model);
      if (googleRequest.config.model === 'latest_short') {
        assert.equal(url, 'https://eu-speech.googleapis.com/v1/speech:recognize');
        assert.deepEqual(googleRequest, { config: { languageCode: 'en-GB', model: 'latest_short' }, audio: { content: preparedAudioBytes.toString('base64') } });
        return Response.json({ results: [{ alternatives: [{ transcript: 'Matt.' }] }], totalBilledTime: '2s' });
      }
      assert.equal(url, 'https://eu-speech.googleapis.com/v2/projects/reading-learner-test/locations/eu/recognizers/_:recognize');
      assert.deepEqual(googleRequest, { config: { autoDecodingConfig: {}, languageCodes: ['en-GB'], model: googleRequest.config.model }, content: preparedAudioBytes.toString('base64') });
      return Response.json({ results: [{ alternatives: [{ transcript: 'Matt.' }] }], metadata: { totalBilledDuration: '2s' } });
    },
  });
  await withGateway({}, transcribe, async endpoint => {
    for (const [model, configurationVersion] of [
      ['chirp_3', 'recorded-word-en-GB-chirp3-leading-silence-preroll-300ms-v2'],
      ['short', 'recorded-word-en-GB-short-leading-silence-preroll-300ms-v2'],
    ]) {
      const response = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify({ ...recording, model }) });
      assert.equal(response.status, 200);
      const transcription = await response.json();
      assert.equal(transcription.provider, 'google-cloud-stt');
      assert.equal(transcription.model, model);
      assert.equal(transcription.configurationVersion, configurationVersion);
      assert.equal(transcription.languageCode, 'en-GB');
      assert.equal(transcription.transcript, 'Matt.');
      assert.deepEqual(transcription.preprocessing, preprocessing);
      assert.deepEqual(transcription.usage, { totalBilledDuration: '2s' });
    }
    const response = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(latestShortRecording) });
    assert.equal(response.status, 200);
    const transcription = await response.json();
    assert.equal(transcription.model, 'latest_short');
    assert.equal(transcription.configurationVersion, 'recorded-word-en-GB-v1-latest-short-leading-silence-preroll-300ms-v3');
    assert.equal(transcription.transcript, 'Matt.');
    assert.deepEqual(transcription.preprocessing, preprocessing);
    assert.deepEqual(transcription.usage, { totalBilledTime: '2s' });
  });
  assert.deepEqual(googleModels, ['chirp_3', 'short', 'latest_short']);
});

test('audio preparation failures return a clear gateway error without a Google call', async () => {
  let credentialCalls = 0;
  let googleCalls = 0;
  const transcribe = createGoogleSpeechTranscriber({
    projectId: 'reading-learner-test',
    prepareAudio: async () => { throw new SpeechAudioPreparationError(422, 'speech_audio_decode_failed', 'The saved recording could not be decoded for silence trimming.'); },
    getAccessToken: async () => { credentialCalls++; return 'unused-token'; },
    fetchImplementation: async () => { googleCalls++; throw new Error('Google must not be called'); },
  });
  await withGateway({}, transcribe, async endpoint => {
    const response = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: {
      code: 'speech_audio_decode_failed',
      message: 'The saved recording could not be decoded for silence trimming.',
    } });
  });
  assert.equal(credentialCalls, 0);
  assert.equal(googleCalls, 0);
});

test('oversized declared bodies are rejected before being uploaded or decoded', async () => {
  let calls = 0;
  await withGateway({}, async () => { calls++; }, async endpoint => {
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(endpoint, { method: 'POST', headers: { ...authorizedHeaders, 'Content-Length': MAX_REQUEST_BYTES + 1 } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end('{}');
    });
    assert.equal(status, 413);
  });
  assert.equal(calls, 0);
});

test('concurrent recordings cannot exceed the configured provider capacity', async () => {
  let releaseProvider;
  let notifyProviderEntered;
  const providerEntered = new Promise(resolve => { notifyProviderEntered = resolve; });
  await withGateway({ maxConcurrent: 1 }, async () => {
    notifyProviderEntered();
    return new Promise(resolve => { releaseProvider = () => resolve({ transcript: 'cat' }); });
  }, async endpoint => {
    const first = fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    await providerEntered;
    const blocked = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).error.code, 'transcription_busy');
    releaseProvider();
    assert.equal((await first).status, 200);
  });
});

test('per-minute and daily limits bound provider calls, then reset on their intended clocks', async () => {
  let clockMs = Date.parse('2026-10-03T10:00:00Z');
  let calls = 0;
  await withGateway({ requestsPerMinute: 1, requestsPerDay: 2 }, async () => { calls++; return { transcript: 'cat' }; }, async endpoint => {
    const post = () => fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify(recording) });
    assert.equal((await post()).status, 200);
    assert.equal((await (await post()).json()).error.code, 'transcription_rate_limit');
    clockMs += 60_000;
    assert.equal((await post()).status, 200);
    clockMs += 60_000;
    assert.equal((await (await post()).json()).error.code, 'daily_transcription_limit');
    clockMs = Date.parse('2026-10-04T00:00:00Z');
    assert.equal((await post()).status, 200);
  }, () => clockMs);
  assert.equal(calls, 3);
});
