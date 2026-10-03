import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createSpeechGateway, readGatewayConfiguration } from '../server.mjs';
import { createGoogleSpeechTranscriber, MAX_REQUEST_BYTES } from '../providers.mjs';

const gatewayToken = 'fake-gateway-token-at-least-24-characters';
const recording = { model: 'chirp_3', audioBase64: Buffer.from('recording').toString('base64'), mimeType: 'audio/webm', durationMs: 2000 };
const authorizedHeaders = { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' };

async function withGateway(configChanges, transcribe, run, now) {
  const configuration = { ...readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken }), ...configChanges };
  const server = createSpeechGateway({ configuration, transcribe, now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}/transcribe`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('configuration requires a private token and exact allowed origins', () => {
  assert.throws(() => readGatewayConfiguration({}), /SPEECH_GATEWAY_TOKEN/);
  assert.throws(() => readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken, SPEECH_ALLOWED_ORIGINS: '*' }), /exact/);
  assert.throws(() => readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken, SPEECH_ALLOWED_ORIGINS: 'https://example.com/path' }), /exact/);
});

test('network exposure requires an explicit container host; local binding remains the default', () => {
  const localConfiguration = readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken });
  assert.equal(localConfiguration.host, '127.0.0.1');
  assert.equal(localConfiguration.port, 8081);
  const containerConfiguration = readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken, SPEECH_GATEWAY_HOST: '0.0.0.0', PORT: '8080' });
  assert.equal(containerConfiguration.host, '0.0.0.0');
  assert.equal(containerConfiguration.port, 8080);
  for (const host of ['', 'localhost', '::', '192.168.1.1', 'example.com', '0.0.0.0 ']) {
    assert.throws(() => readGatewayConfiguration({ SPEECH_GATEWAY_TOKEN: gatewayToken, SPEECH_GATEWAY_HOST: host }), /SPEECH_GATEWAY_HOST/);
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
      { body: { ...recording, model: 'latest_short' }, status: 400 },
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
    const response = await fetch(endpoint, { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:8080');
    const wrongMethod = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'DELETE' } });
    assert.equal(wrongMethod.status, 400);
  });
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
    fetchImplementation: async (url, options) => {
      assert.equal(url, 'https://eu-speech.googleapis.com/v2/projects/reading-learner-test/locations/eu/recognizers/_:recognize');
      const googleRequest = JSON.parse(options.body);
      googleModels.push(googleRequest.config.model);
      assert.deepEqual(googleRequest, { config: { autoDecodingConfig: {}, languageCodes: ['en-GB'], model: googleRequest.config.model }, content: recording.audioBase64 });
      return Response.json({ results: [{ alternatives: [{ transcript: 'Matt.' }] }], metadata: { totalBilledDuration: '2s' } });
    },
  });
  await withGateway({}, transcribe, async endpoint => {
    for (const [model, configurationVersion] of [
      ['chirp_3', 'recorded-word-en-GB-chirp3-v1'], ['short', 'recorded-word-en-GB-short-v1'],
    ]) {
      const response = await fetch(endpoint, { method: 'POST', headers: authorizedHeaders, body: JSON.stringify({ ...recording, model }) });
      assert.equal(response.status, 200);
      const transcription = await response.json();
      assert.equal(transcription.provider, 'google-cloud-stt');
      assert.equal(transcription.model, model);
      assert.equal(transcription.configurationVersion, configurationVersion);
      assert.equal(transcription.languageCode, 'en-GB');
      assert.equal(transcription.transcript, 'Matt.');
      assert.deepEqual(transcription.usage, { totalBilledDuration: '2s' });
    }
  });
  assert.deepEqual(googleModels, ['chirp_3', 'short']);
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
