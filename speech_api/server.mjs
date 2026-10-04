import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  createGoogleSpeechTranscriber, MAX_REQUEST_BYTES, SPEECH_MODEL_CONFIGURATION_VERSIONS, SpeechGatewayError,
  validateAudioPreparationRequest, validateRecordingRequest,
} from './providers.mjs';
import { createGoogleCloudReferenceLibrary, MAX_REFERENCE_REQUEST_BYTES, ReferenceLibraryError } from './reference_library.mjs';
import { prepareSpeechAudio, SPEECH_AUDIO_PREPROCESSING_VERSION } from './audio_preprocessing.mjs';

function positiveInteger(value, defaultValue, name) {
  if (value === undefined || value === '') return defaultValue;
  if (!/^\d+$/.test(String(value)) || Number(value) <= 0 || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

export function readGatewayConfiguration(environment = process.env) {
  const gatewayToken = environment.SPEECH_GATEWAY_TOKEN;
  if (typeof gatewayToken !== 'string' || gatewayToken.length < 24 || /\s/.test(gatewayToken)) {
    throw new Error('Set SPEECH_GATEWAY_TOKEN to a private token of at least 24 characters without whitespace.');
  }
  const allowedOrigins = (environment.SPEECH_ALLOWED_ORIGINS || 'https://bitbutter.github.io,http://localhost:8080,http://127.0.0.1:8080')
    .split(',').map(origin => origin.trim());
  if (allowedOrigins.some(origin => {
    try { const url = new URL(origin); return !['https:', 'http:'].includes(url.protocol) || url.origin !== origin; }
    catch { return true; }
  })) throw new Error('SPEECH_ALLOWED_ORIGINS must contain exact HTTP or HTTPS origins separated by commas.');
  const port = positiveInteger(environment.PORT, 8081, 'PORT');
  if (port > 65535) throw new Error('PORT must be at most 65535.');
  const host = environment.SPEECH_GATEWAY_HOST === undefined ? '127.0.0.1' : environment.SPEECH_GATEWAY_HOST;
  if (!['127.0.0.1', '0.0.0.0'].includes(host)) {
    throw new Error('SPEECH_GATEWAY_HOST must be 127.0.0.1 for local use or explicitly 0.0.0.0 for container deployment.');
  }
  const referenceBucket = environment.SPEECH_REFERENCE_BUCKET;
  if (typeof referenceBucket !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(referenceBucket) || referenceBucket.includes('..')) {
    throw new Error('Set SPEECH_REFERENCE_BUCKET to the private Cloud Storage bucket for approved word recordings.');
  }
  return {
    gatewayToken, allowedOrigins: new Set(allowedOrigins), port, host, referenceBucket,
    projectId: environment.GOOGLE_CLOUD_PROJECT,
    maxConcurrent: positiveInteger(environment.SPEECH_GATEWAY_MAX_CONCURRENT, 2, 'SPEECH_GATEWAY_MAX_CONCURRENT'),
    requestsPerMinute: positiveInteger(environment.SPEECH_GATEWAY_REQUESTS_PER_MINUTE, 20, 'SPEECH_GATEWAY_REQUESTS_PER_MINUTE'),
    requestsPerDay: positiveInteger(environment.SPEECH_GATEWAY_REQUESTS_PER_DAY, 200, 'SPEECH_GATEWAY_REQUESTS_PER_DAY'),
    timeoutMs: positiveInteger(environment.SPEECH_GATEWAY_TIMEOUT_MS, 15_000, 'SPEECH_GATEWAY_TIMEOUT_MS'),
  };
}

function bearerTokenMatches(authorization, configuredToken) {
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(configuredToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function readJsonBody(request, timeoutMs, maximumBytes) {
  const contentLength = request.headers['content-length'];
  if (contentLength !== undefined && (!/^\d+$/.test(contentLength) || Number(contentLength) > maximumBytes)) {
    throw new SpeechGatewayError(413, 'request_too_large', 'The request is too large.');
  }
  return new Promise((resolve, reject) => {
    let byteLength = 0;
    const chunks = [];
    const deadline = setTimeout(() => finish(new SpeechGatewayError(408, 'recording_upload_timeout', 'The recording upload timed out.')), timeoutMs);
    const cleanup = () => {
      clearTimeout(deadline);
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      request.removeListener('aborted', onAborted);
    };
    const finish = error => { cleanup(); request.pause(); reject(error); };
    const onData = chunk => {
      byteLength += chunk.length;
      if (byteLength > maximumBytes) { finish(new SpeechGatewayError(413, 'request_too_large', 'The request is too large.')); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new SpeechGatewayError(400, 'invalid_json', 'The recording request must contain valid JSON.')); }
    };
    const onError = () => finish(new SpeechGatewayError(400, 'recording_upload_failed', 'The recording upload failed.'));
    const onAborted = () => finish(new SpeechGatewayError(400, 'recording_upload_failed', 'The recording upload was interrupted.'));
    request.on('data', onData);
    request.on('end', onEnd);
    request.on('error', onError);
    request.on('aborted', onAborted);
  });
}

function requestOperationSignal(response, timeoutMs) {
  const clientDisconnected = new AbortController();
  response.once('close', () => { if (!response.writableFinished) clientDisconnected.abort(); });
  return AbortSignal.any([clientDisconnected.signal, AbortSignal.timeout(timeoutMs)]);
}

export function createSpeechGateway({ configuration, transcribe, referenceLibrary, prepareAudio = prepareSpeechAudio, now = () => Date.now() }) {
  const transcribeRecording = transcribe || createGoogleSpeechTranscriber({ projectId: configuration.projectId, timeoutMs: configuration.timeoutMs });
  const approvedWordReferences = referenceLibrary || createGoogleCloudReferenceLibrary({ bucketName: configuration.referenceBucket });
  let requestsInFlight = 0;
  let admittedAt = [];
  let quotaDay = '';
  let requestsToday = 0;
  function admitProviderRequest() {
    const timestamp = now();
    const currentDay = new Date(timestamp).toISOString().slice(0, 10);
    if (currentDay !== quotaDay) { quotaDay = currentDay; requestsToday = 0; }
    admittedAt = admittedAt.filter(previous => timestamp - previous < 60_000);
    if (requestsToday >= configuration.requestsPerDay) {
      throw new SpeechGatewayError(429, 'daily_transcription_limit', 'The daily recording limit has been reached. It resets at midnight UTC.');
    }
    if (admittedAt.length >= configuration.requestsPerMinute) {
      throw new SpeechGatewayError(429, 'transcription_rate_limit', 'Too many recording requests. Wait one minute before trying again.');
    }
    admittedAt.push(timestamp);
    requestsToday++;
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, body) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' });
      response.end(JSON.stringify(body));
    };
    const closeUploadAfterResponse = () => response.once('finish', () => request.destroy());
    let ownsRequestSlot = false;
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      if (requestUrl.search || requestUrl.hash) throw new SpeechGatewayError(404, 'unknown_endpoint', 'Use one of the documented speech API paths without query parameters.');
      const referenceIdMatch = requestUrl.pathname.match(/^\/references\/([0-9a-f-]{36})$/i);
      const routePath = referenceIdMatch ? '/references/:referenceId' : requestUrl.pathname;
      const routeMethods = {
        '/transcribe': ['POST'], '/playback-preview': ['POST'], '/references': ['GET', 'POST'], '/compare': ['POST'], '/references/:referenceId': ['DELETE'],
      };
      const allowedMethods = routeMethods[routePath];
      if (!allowedMethods) throw new SpeechGatewayError(404, 'unknown_endpoint', 'Use /transcribe, /playback-preview, /references or /compare.');
      const origin = request.headers.origin;
      if (origin !== undefined && !configuration.allowedOrigins.has(origin)) {
        throw new SpeechGatewayError(403, 'origin_not_allowed', 'This browser origin is not allowed to use the speech API.');
      }
      if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
      if (request.method === 'OPTIONS') {
        const requestedMethod = request.headers['access-control-request-method'];
        if (!origin || !allowedMethods.includes(requestedMethod)) {
          throw new SpeechGatewayError(400, 'invalid_preflight', 'A browser preflight must request a method supported by this path.');
        }
        const requestedHeaders = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (requestedHeaders.some(header => !['authorization', 'content-type'].includes(header))) {
          throw new SpeechGatewayError(400, 'unsupported_preflight_headers', 'Only Authorization and Content-Type request headers are supported.');
        }
        response.writeHead(204, {
          'Access-Control-Allow-Methods': allowedMethods.join(', '), 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '300',
        });
        response.end();
        return;
      }
      if (!allowedMethods.includes(request.method)) throw new SpeechGatewayError(405, 'unsupported_method', `Use ${allowedMethods.join(' or ')} for this path.`);
      if (!bearerTokenMatches(request.headers.authorization, configuration.gatewayToken)) {
        throw new SpeechGatewayError(401, 'gateway_token_required', 'A valid speech server access code is required.');
      }
      if (request.method === 'POST' && (request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        throw new SpeechGatewayError(415, 'json_required', 'Send this request as application/json.');
      }
      if (routePath === '/references' && request.method === 'GET') {
        send(200, { references: await approvedWordReferences.listReferences({ signal: requestOperationSignal(response, 45_000) }) });
        return;
      }
      if (requestsInFlight >= configuration.maxConcurrent) {
        throw new SpeechGatewayError(429, routePath === '/transcribe' ? 'transcription_busy' : 'speech_gateway_busy', 'The speech API is already processing its maximum number of recordings.');
      }
      requestsInFlight++;
      ownsRequestSlot = true;
      if (routePath === '/transcribe') {
        const recording = validateRecordingRequest(await readJsonBody(request, configuration.timeoutMs, MAX_REQUEST_BYTES));
        admitProviderRequest();
        send(200, await transcribeRecording(recording, { signal: requestOperationSignal(response, configuration.timeoutMs) }));
      } else if (routePath === '/playback-preview') {
        const recording = validateAudioPreparationRequest(await readJsonBody(request, configuration.timeoutMs, MAX_REQUEST_BYTES));
        const preparedAudio = await prepareAudio({
          audioBytes: recording.audioBytes, mimeType: recording.mimeType, durationMs: recording.durationMs,
          signal: requestOperationSignal(response, configuration.timeoutMs),
        });
        if (!Buffer.isBuffer(preparedAudio?.audioBytes) || preparedAudio.mimeType !== 'audio/wav' ||
            preparedAudio.preprocessing?.version !== SPEECH_AUDIO_PREPROCESSING_VERSION ||
            preparedAudio.preprocessing.sampleRateHertz !== 16_000 || preparedAudio.preprocessing.audioChannelCount !== 1 ||
            !Number.isInteger(preparedAudio.preprocessing.trimmedLeadingSilenceMs) || preparedAudio.preprocessing.trimmedLeadingSilenceMs < 0 ||
            !Number.isInteger(preparedAudio.preprocessing.outputDurationMs) || preparedAudio.preprocessing.outputDurationMs <= 0 ||
            !/^[a-f0-9]{64}$/.test(preparedAudio.preprocessing.preparedAudioSha256 || '')) {
          throw new SpeechGatewayError(500, 'audio_preview_preparation_failed', 'The processed playback preview could not be prepared consistently.');
        }
        send(200, {
          audioBase64: preparedAudio.audioBytes.toString('base64'), mimeType: preparedAudio.mimeType,
          originalAudioSha256: recording.audioSha256, preprocessing: preparedAudio.preprocessing,
        });
      } else if (routePath === '/references' && request.method === 'POST') {
        const approvedReference = await approvedWordReferences.approveReference(await readJsonBody(request, configuration.timeoutMs, MAX_REFERENCE_REQUEST_BYTES), {
          signal: requestOperationSignal(response, 45_000),
        });
        send(201, { reference: approvedReference });
      } else if (routePath === '/compare') {
        const comparison = await approvedWordReferences.compareRecording(await readJsonBody(request, configuration.timeoutMs, MAX_REFERENCE_REQUEST_BYTES), {
          signal: requestOperationSignal(response, 45_000),
        });
        send(200, comparison);
      } else if (routePath === '/references/:referenceId') {
        send(200, await approvedWordReferences.deleteReference(referenceIdMatch[1], { signal: requestOperationSignal(response, 45_000) }));
      }
    } catch (error) {
      closeUploadAfterResponse();
      if (error instanceof SpeechGatewayError) send(error.httpStatus, { error: { code: error.code, message: error.message, ...error.details } });
      else if (error instanceof ReferenceLibraryError) send(error.httpStatus, { error: { code: error.code, message: error.message } });
      else if (Number.isInteger(error?.httpStatus) && typeof error?.code === 'string') send(error.httpStatus, { error: { code: error.code, message: error.message || 'The audio could not be prepared.' } });
      else send(500, { error: { code: 'gateway_failure', message: 'The speech API could not complete this request.' } });
    } finally {
      if (ownsRequestSlot) requestsInFlight--;
    }
  });
  server.requestTimeout = configuration.timeoutMs;
  server.headersTimeout = Math.min(configuration.timeoutMs, 5000);
  return server;
}

export async function startSpeechGateway(environment = process.env) {
  const configuration = readGatewayConfiguration(environment);
  const server = createSpeechGateway({ configuration });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(configuration.port, configuration.host, resolve); });
  console.log(`Speech API listening on ${configuration.host}:${configuration.port}; endpoint /transcribe (Google Cloud models: ${Object.keys(SPEECH_MODEL_CONFIGURATION_VERSIONS).join(', ')}).`);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSpeechGateway().catch(error => { console.error(error.message); process.exitCode = 1; });
}
