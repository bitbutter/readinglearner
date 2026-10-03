import { createHash } from 'node:crypto';

export const SPEECH_CONFIGURATION_VERSION = 'recorded-word-en-GB-chirp3-v1';
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4096;
export const SPEECH_LANGUAGE_CODE = 'en-GB';
export const SPEECH_MODEL = 'chirp_3';
export const SPEECH_MODEL_CONFIGURATION_VERSIONS = Object.freeze({
  chirp_3: SPEECH_CONFIGURATION_VERSION,
  short: 'recorded-word-en-GB-short-v1',
});
const RECORDING_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']);
const REQUEST_FIELDS = new Set(['model', 'audioBase64', 'mimeType', 'durationMs']);

export class SpeechGatewayError extends Error {
  constructor(httpStatus, code, message, details = {}) {
    super(message);
    this.name = 'SpeechGatewayError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.details = details;
  }
}

function configurationVersionForSpeechModel(model) {
  if (typeof model !== 'string' || !Object.hasOwn(SPEECH_MODEL_CONFIGURATION_VERSIONS, model)) {
    throw new SpeechGatewayError(400, 'unsupported_model', 'Select the chirp_3 or short transcription model.');
  }
  return SPEECH_MODEL_CONFIGURATION_VERSIONS[model];
}

export function validateRecordingRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new SpeechGatewayError(400, 'invalid_recording', 'Send a JSON object containing the recording.');
  }
  if (Object.keys(request).some(field => !REQUEST_FIELDS.has(field))) {
    throw new SpeechGatewayError(400, 'unexpected_recording_fields', 'Only model, audioBase64, mimeType and durationMs are accepted.');
  }
  configurationVersionForSpeechModel(request.model);
  if (!Number.isFinite(request.durationMs) || request.durationMs <= 0 || request.durationMs >= 60_000) {
    throw new SpeechGatewayError(400, 'invalid_recording_duration', 'Recording duration must be positive and shorter than 60 seconds.');
  }
  if (typeof request.mimeType !== 'string' || request.mimeType.length > 100) {
    throw new SpeechGatewayError(400, 'unsupported_audio_format', 'Use WebM, Ogg, MP4 or WAV audio.');
  }
  const audioMimeType = request.mimeType.split(';', 1)[0].trim().toLowerCase();
  if (!RECORDING_MIME_TYPES.has(audioMimeType)) {
    throw new SpeechGatewayError(400, 'unsupported_audio_format', 'Use WebM, Ogg, MP4 or WAV audio.');
  }
  const audioBase64 = request.audioBase64;
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    throw new SpeechGatewayError(400, 'empty_recording', 'The recording contains no audio bytes.');
  }
  if (audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4) {
    throw new SpeechGatewayError(413, 'recording_too_large', 'Recordings may contain at most 10 MiB of audio.');
  }
  if (audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) {
    throw new SpeechGatewayError(400, 'invalid_audio_base64', 'Audio must be canonical base64 without a data URL prefix.');
  }
  const audioBytes = Buffer.from(audioBase64, 'base64');
  if (audioBytes.length === 0 || audioBytes.toString('base64') !== audioBase64) {
    throw new SpeechGatewayError(400, 'invalid_audio_base64', 'Audio must be canonical base64.');
  }
  if (audioBytes.length > MAX_AUDIO_BYTES) {
    throw new SpeechGatewayError(413, 'recording_too_large', 'Recordings may contain at most 10 MiB of audio.');
  }
  return {
    model: request.model,
    audioBase64,
    mimeType: request.mimeType,
    durationMs: request.durationMs,
    audioSha256: createHash('sha256').update(audioBytes).digest('hex'),
  };
}

function redactCredential(value, accessToken) {
  if (typeof value === 'string') return value.replaceAll(accessToken, '[credential removed]');
  if (Array.isArray(value)) return value.map(part => redactCredential(part, accessToken));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([field, part]) => [field, redactCredential(part, accessToken)]));
  }
  return value;
}

export function extractSpeechTranscript(providerResponse) {
  if (!providerResponse || typeof providerResponse !== 'object' || Array.isArray(providerResponse)) {
    throw new SpeechGatewayError(502, 'invalid_provider_response', 'Google returned an invalid transcription response.');
  }
  // Google protobuf JSON omits empty repeated fields: an absent results field
  // is a valid completed request with no transcript, as is results: [].
  if (!Object.hasOwn(providerResponse, 'results')) return '';
  if (!Array.isArray(providerResponse.results)) {
    throw new SpeechGatewayError(502, 'invalid_provider_response', 'Google transcription results must be an array.');
  }
  return providerResponse.results.map(speechSegment => {
    if (!Array.isArray(speechSegment?.alternatives) || speechSegment.alternatives.length === 0 ||
        typeof speechSegment.alternatives[0]?.transcript !== 'string') {
      throw new SpeechGatewayError(502, 'invalid_provider_response', 'A Google speech result is missing its transcript.');
    }
    return speechSegment.alternatives[0].transcript;
  }).join(' ');
}

export function createGoogleSpeechTranscriber({ projectId, fetchImplementation = fetch, getAccessToken, timeoutMs = 15_000, now = () => performance.now() }) {
  let googleAuth;
  const obtainAccessToken = getAccessToken || (async () => {
    const { GoogleAuth } = await import('google-auth-library');
    googleAuth ??= new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return googleAuth.getAccessToken();
  });
  return async function transcribeRecording(recording, { signal } = {}) {
    const model = recording?.model;
    const configurationVersion = configurationVersionForSpeechModel(model);
    if (!projectId || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) {
      throw new SpeechGatewayError(503, 'speech_project_unconfigured', 'Set GOOGLE_CLOUD_PROJECT to the Google Cloud project ID.');
    }
    const startedAt = now();
    const requestSignal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    let accessToken;
    try {
      accessToken = await new Promise((resolve, reject) => {
        const abort = () => reject(requestSignal.reason);
        requestSignal.addEventListener('abort', abort, { once: true });
        if (requestSignal.aborted) { abort(); return; }
        Promise.resolve().then(obtainAccessToken).then(resolve, reject)
          .finally(() => requestSignal.removeEventListener('abort', abort));
      });
    } catch {
      if (requestSignal.aborted) throw new SpeechGatewayError(504, 'speech_request_timeout', 'Google transcription did not finish within the request deadline.');
      throw new SpeechGatewayError(503, 'speech_credentials_unavailable', 'Google Cloud credentials are unavailable. Configure Application Default Credentials for this server.');
    }
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new SpeechGatewayError(503, 'speech_credentials_unavailable', 'Google Cloud credentials did not provide an access token.');
    }
    let response;
    let providerResponse;
    try {
      response = await fetchImplementation(`https://eu-speech.googleapis.com/v2/projects/${projectId}/locations/eu/recognizers/_:recognize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': projectId,
        },
        body: JSON.stringify({
          config: { autoDecodingConfig: {}, languageCodes: [SPEECH_LANGUAGE_CODE], model },
          content: recording.audioBase64,
        }),
        signal: requestSignal,
      });
      providerResponse = redactCredential(await response.json(), accessToken);
    } catch {
      if (requestSignal.aborted) throw new SpeechGatewayError(504, 'speech_request_timeout', 'Google transcription did not finish within the request deadline.');
      throw new SpeechGatewayError(502, 'speech_provider_unreachable', 'Google transcription could not be reached or returned invalid JSON.');
    }
    if (!response.ok) {
      throw new SpeechGatewayError(502, 'speech_provider_error', 'Google rejected the transcription request.', {
        provider: 'google-cloud-stt', model, configurationVersion, providerStatus: response.status, providerResponse,
      });
    }
    const transcript = extractSpeechTranscript(providerResponse);
    return {
      provider: 'google-cloud-stt',
      model,
      languageCode: SPEECH_LANGUAGE_CODE,
      configurationVersion,
      audioSha256: recording.audioSha256,
      transcript,
      // Google returns segment hypotheses. They are preserved in providerResponse;
      // they are not invented into competing whole-recording transcripts.
      alternatives: [],
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
      usage: providerResponse.metadata || {},
      providerResponse,
    };
  };
}
