import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export const SPEECH_AUDIO_PREPROCESSING_VERSION = 'leading-silence-preroll-300ms-mono16k-v1';
export const SPEECH_AUDIO_SAMPLE_RATE_HERTZ = 16_000;
export const SPEECH_AUDIO_LEAD_IN_MS = 300;
const MAX_ALLOWED_DECODED_AUDIO_BYTES = Math.floor(SPEECH_AUDIO_SAMPLE_RATE_HERTZ * 2 * 59_999 / 1000);
const MAX_DECODED_AUDIO_BYTES = SPEECH_AUDIO_SAMPLE_RATE_HERTZ * 2 * 61;
const MAX_PREPARATION_TIME_MS = 8_000;
const SPEECH_ACTIVITY_RMS_THRESHOLD = 0.0031622776601683794; // -50 dBFS.
const SPEECH_ACTIVITY_FRAME_MS = 10;
const REQUIRED_ACTIVE_FRAME_COUNT = 5;
const SUPPORTED_INPUT_FORMATS = Object.freeze({
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
});

export class SpeechAudioPreparationError extends Error {
  constructor(httpStatus, code, message) {
    super(message);
    this.name = 'SpeechAudioPreparationError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function inputFormatForRecordingMimeType(mimeType) {
  if (typeof mimeType !== 'string') {
    throw new SpeechAudioPreparationError(400, 'unsupported_audio_format', 'The saved recording must specify its audio format.');
  }
  const baseMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
  const inputFormat = SUPPORTED_INPUT_FORMATS[baseMimeType];
  if (!inputFormat) {
    throw new SpeechAudioPreparationError(400, 'unsupported_audio_format', 'Use WebM, Ogg, MP4 or WAV audio.');
  }
  return inputFormat;
}

function decodeRecordingToMonoPcm(recording, {
  signal,
  ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg',
  spawnImplementation = spawn,
  timeoutMs = MAX_PREPARATION_TIME_MS,
} = {}) {
  if (!Buffer.isBuffer(recording?.audioBytes) || recording.audioBytes.length === 0) {
    throw new SpeechAudioPreparationError(400, 'empty_recording', 'The recording contains no audio bytes.');
  }
  const inputFormat = inputFormatForRecordingMimeType(recording.mimeType);
  const argumentsList = [
    '-hide_banner', '-loglevel', 'error', '-threads', '1', '-max_alloc', '134217728',
    '-protocol_whitelist', 'pipe', '-f', inputFormat, '-i', 'pipe:0',
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(SPEECH_AUDIO_SAMPLE_RATE_HERTZ),
    '-t', '61', '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1',
  ];

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let timedOut = false;
    let exceededOutputLimit = false;
    let decodedByteCount = 0;
    const decodedChunks = [];
    let deadlineTimer;
    const cleanUp = () => {
      clearTimeout(deadlineTimer);
      signal?.removeEventListener('abort', abortDecoder);
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanUp();
      reject(error);
    };
    const abortDecoder = () => {
      child?.kill('SIGKILL');
    };
    try {
      child = spawnImplementation(ffmpegPath, argumentsList, {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      fail(new SpeechAudioPreparationError(503, 'speech_audio_decoder_unavailable', 'The speech server audio decoder is unavailable.'));
      return;
    }
    signal?.addEventListener('abort', abortDecoder, { once: true });
    if (signal?.aborted) abortDecoder();
    deadlineTimer = setTimeout(() => {
      timedOut = true;
      abortDecoder();
    }, timeoutMs);
    child.once('error', error => {
      if (error?.code === 'ENOENT') {
        fail(new SpeechAudioPreparationError(503, 'speech_audio_decoder_unavailable', 'The speech server audio decoder is unavailable.'));
      } else {
        fail(new SpeechAudioPreparationError(422, 'speech_audio_decode_failed', 'The saved recording could not be decoded for silence trimming.'));
      }
    });
    child.stdout.on('data', chunk => {
      decodedByteCount += chunk.length;
      if (decodedByteCount > MAX_DECODED_AUDIO_BYTES) {
        exceededOutputLimit = true;
        child.kill('SIGKILL');
        return;
      }
      decodedChunks.push(chunk);
    });
    child.once('close', exitCode => {
      if (settled) return;
      if (signal?.aborted || timedOut) {
        fail(new SpeechAudioPreparationError(504, 'speech_audio_preparation_timeout', 'Preparing this recording exceeded the speech server time limit.'));
      } else if (exceededOutputLimit) {
        fail(new SpeechAudioPreparationError(413, 'speech_audio_too_long', 'The decoded recording exceeds the 60-second speech limit.'));
      } else if (decodedByteCount > MAX_ALLOWED_DECODED_AUDIO_BYTES) {
        fail(new SpeechAudioPreparationError(413, 'speech_audio_too_long', 'The decoded recording exceeds the 60-second speech limit.'));
      } else if (exitCode !== 0 || decodedByteCount === 0 || decodedByteCount % 2 !== 0) {
        fail(new SpeechAudioPreparationError(422, 'speech_audio_decode_failed', 'The saved recording could not be decoded for silence trimming.'));
      } else {
        settled = true;
        cleanUp();
        resolve(Buffer.concat(decodedChunks, decodedByteCount));
      }
    });
    child.stdin.once('error', () => {});
    child.stdin.end(recording.audioBytes);
  });
}

function rmsForPcmWindow(pcmBytes, startSample, sampleCount) {
  let squaredSampleTotal = 0;
  for (let sampleOffset = 0; sampleOffset < sampleCount; sampleOffset++) {
    const sample = pcmBytes.readInt16LE((startSample + sampleOffset) * 2) / 32768;
    squaredSampleTotal += sample * sample;
  }
  return Math.sqrt(squaredSampleTotal / sampleCount);
}

function firstSustainedActiveAudioSample(pcmBytes) {
  const samplesPerFrame = SPEECH_AUDIO_SAMPLE_RATE_HERTZ * SPEECH_ACTIVITY_FRAME_MS / 1000;
  const completeFrameCount = Math.floor(pcmBytes.length / (samplesPerFrame * 2));
  let firstActiveFrame = -1;
  let consecutiveActiveFrames = 0;
  for (let frameIndex = 0; frameIndex < completeFrameCount; frameIndex++) {
    const frameStartSample = frameIndex * samplesPerFrame;
    const rms = rmsForPcmWindow(pcmBytes, frameStartSample, samplesPerFrame);
    if (rms >= SPEECH_ACTIVITY_RMS_THRESHOLD) {
      if (consecutiveActiveFrames === 0) firstActiveFrame = frameIndex;
      consecutiveActiveFrames++;
      if (consecutiveActiveFrames >= REQUIRED_ACTIVE_FRAME_COUNT) return firstActiveFrame * samplesPerFrame;
    } else {
      firstActiveFrame = -1;
      consecutiveActiveFrames = 0;
    }
  }
  return null;
}

function wavHeader(pcmBytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM.
  header.writeUInt16LE(1, 22); // Mono.
  header.writeUInt32LE(SPEECH_AUDIO_SAMPLE_RATE_HERTZ, 24);
  header.writeUInt32LE(SPEECH_AUDIO_SAMPLE_RATE_HERTZ * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes.length, 40);
  return header;
}

export function prepareSpeechAudio(recording, options = {}) {
  return decodeRecordingToMonoPcm(recording, options).then(pcmBytes => {
    const inputSampleCount = pcmBytes.length / 2;
    const firstSpeechSampleIndex = firstSustainedActiveAudioSample(pcmBytes);
    const leadInSamples = SPEECH_AUDIO_SAMPLE_RATE_HERTZ * SPEECH_AUDIO_LEAD_IN_MS / 1000;
    const trimStartSample = firstSpeechSampleIndex === null
      ? 0
      : Math.max(0, firstSpeechSampleIndex - leadInSamples);
    const trimmedPcmBytes = pcmBytes.subarray(trimStartSample * 2);
    const wavBytes = Buffer.concat([wavHeader(trimmedPcmBytes), trimmedPcmBytes]);
    const trimmedLeadingSilenceMs = Math.round(trimStartSample * 1000 / SPEECH_AUDIO_SAMPLE_RATE_HERTZ);
    const inputDurationMs = Math.round(inputSampleCount * 1000 / SPEECH_AUDIO_SAMPLE_RATE_HERTZ);
    const outputDurationMs = Math.round(trimmedPcmBytes.length * 500 / SPEECH_AUDIO_SAMPLE_RATE_HERTZ);
    return {
      audioBytes: wavBytes,
      mimeType: 'audio/wav',
      durationMs: outputDurationMs,
      preprocessing: {
        version: SPEECH_AUDIO_PREPROCESSING_VERSION,
        sampleRateHertz: SPEECH_AUDIO_SAMPLE_RATE_HERTZ,
        audioChannelCount: 1,
        inputDurationMs,
        trimmedLeadingSilenceMs,
        outputDurationMs,
        preparedAudioSha256: createHash('sha256').update(wavBytes).digest('hex'),
      },
    };
  });
}
