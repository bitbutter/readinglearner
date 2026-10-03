import { createHash } from 'node:crypto';

export const SPEECH_CONFIGURATION_VERSION = 'recorded-word-en-GB-chirp3-v1';
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const MAX_REQUEST_BYTES = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4096;
export const SPEECH_LANGUAGE_CODE = 'en-GB';
export const SPEECH_MODEL = 'chirp_3';
export const SPEECH_MODEL_CONFIGURATION_VERSIONS = Object.freeze({
  chirp_3: SPEECH_CONFIGURATION_VERSION,
  short: 'recorded-word-en-GB-short-v1',
  latest_short: 'recorded-word-en-GB-v1-latest-short-opus-header-channel-count-v2',
});
const RECORDING_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']);
const V1_OPUS_SAMPLE_RATES_HERTZ = new Set([8000, 12000, 16000, 24000, 48000]);
const MAX_OPUS_HEAD_SEARCH_BYTES = 64 * 1024;
const OPUS_HEAD_SIGNATURE = Buffer.from('OpusHead', 'ascii');
const REQUEST_FIELDS = new Set(['model', 'audioBase64', 'mimeType', 'durationMs', 'sampleRateHertz']);

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
    throw new SpeechGatewayError(400, 'unsupported_model', 'Select the chirp_3, short or latest_short transcription model.');
  }
  return SPEECH_MODEL_CONFIGURATION_VERSIONS[model];
}

function opusChannelCountFromAudioHeader(audioBytes) {
  const opusAudioHeaderBytes = audioBytes.subarray(0, MAX_OPUS_HEAD_SEARCH_BYTES);
  const opusHeadOffset = opusAudioHeaderBytes.indexOf(OPUS_HEAD_SIGNATURE);
  if (opusHeadOffset < 0 || opusHeadOffset + 19 > opusAudioHeaderBytes.length) {
    throw new SpeechGatewayError(400, 'opus_channel_count_unavailable', 'Google latest_short (V1) needs a valid OpusHead channel count in the original recording.');
  }

  const opusHeadVersion = opusAudioHeaderBytes[opusHeadOffset + 8];
  const audioChannelCount = opusAudioHeaderBytes[opusHeadOffset + 9];
  const channelMappingFamily = opusAudioHeaderBytes[opusHeadOffset + 18];
  const requiredOpusHeadLength = channelMappingFamily === 0 ? 19 : 21 + audioChannelCount;
  if (opusHeadVersion > 15 || audioChannelCount < 1 || audioChannelCount > 8 ||
      (channelMappingFamily === 0 && audioChannelCount > 2) || opusHeadOffset + requiredOpusHeadLength > opusAudioHeaderBytes.length) {
    throw new SpeechGatewayError(400, 'opus_channel_count_unavailable', 'Google latest_short (V1) needs a valid OpusHead channel count in the original recording.');
  }
  return audioChannelCount;
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
  let sampleRateHertz;
  let audioChannelCount;
  if (request.model === 'latest_short') {
    if (!['audio/webm', 'audio/ogg'].includes(audioMimeType)) {
      throw new SpeechGatewayError(400, 'unsupported_audio_format_for_model', 'Google latest_short (V1) accepts WebM/Opus or Ogg/Opus recordings.');
    }
    sampleRateHertz = request.sampleRateHertz;
    if (!Number.isInteger(sampleRateHertz) || !V1_OPUS_SAMPLE_RATES_HERTZ.has(sampleRateHertz)) {
      throw new SpeechGatewayError(400, 'invalid_audio_sample_rate', 'Google latest_short (V1) needs the saved microphone sample rate: 8000, 12000, 16000, 24000 or 48000 Hz.');
    }
  } else if (Object.hasOwn(request, 'sampleRateHertz')) {
    throw new SpeechGatewayError(400, 'unexpected_recording_fields', 'sampleRateHertz is accepted only for the latest_short model.');
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
  if (request.model === 'latest_short') audioChannelCount = opusChannelCountFromAudioHeader(audioBytes);
  return {
    model: request.model,
    audioBase64,
    mimeType: request.mimeType,
    durationMs: request.durationMs,
    ...(sampleRateHertz === undefined ? {} : { sampleRateHertz }),
    ...(audioChannelCount === undefined ? {} : { audioChannelCount }),
    audioSha256: createHash('sha256').update(audioBytes).digest('hex'),
  };
}

function speechV1EncodingForRecording(recording) {
  const audioMimeType = recording.mimeType.split(';', 1)[0].trim().toLowerCase();
  if (audioMimeType === 'audio/webm') return 'WEBM_OPUS';
  if (audioMimeType === 'audio/ogg') return 'OGG_OPUS';
  throw new SpeechGatewayError(400, 'unsupported_audio_format_for_model', 'Google latest_short (V1) accepts WebM/Opus or Ogg/Opus recordings.');
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
      const googleSpeechUrl = model === 'latest_short'
        ? 'https://eu-speech.googleapis.com/v1/speech:recognize'
        : `https://eu-speech.googleapis.com/v2/projects/${projectId}/locations/eu/recognizers/_:recognize`;
      const googleSpeechRequest = model === 'latest_short'
        ? {
            config: {
              encoding: speechV1EncodingForRecording(recording),
              sampleRateHertz: recording.sampleRateHertz,
              audioChannelCount: recording.audioChannelCount,
              languageCode: SPEECH_LANGUAGE_CODE,
              model,
            },
            audio: { content: recording.audioBase64 },
          }
        : {
            config: { autoDecodingConfig: {}, languageCodes: [SPEECH_LANGUAGE_CODE], model },
            content: recording.audioBase64,
          };
      response = await fetchImplementation(googleSpeechUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'x-goog-user-project': projectId,
        },
        body: JSON.stringify(googleSpeechRequest),
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
      usage: providerResponse.metadata || (providerResponse.totalBilledTime ? { totalBilledTime: providerResponse.totalBilledTime } : {}),
      providerResponse,
    };
  };
}
