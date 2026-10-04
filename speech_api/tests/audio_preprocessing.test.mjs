import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  prepareSpeechAudio,
  SPEECH_AUDIO_LEAD_IN_MS,
  SPEECH_AUDIO_PREPROCESSING_VERSION,
  SPEECH_AUDIO_SAMPLE_RATE_HERTZ,
} from '../audio_preprocessing.mjs';

const sampleRateHertz = SPEECH_AUDIO_SAMPLE_RATE_HERTZ;

function waveFromPcm(pcmBytes) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHertz, 24);
  header.writeUInt32LE(sampleRateHertz * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBytes.length, 40);
  return Buffer.concat([header, pcmBytes]);
}

function speechFixturePcm({ speechStartsAtMs = 1080 } = {}) {
  const pcmBytes = Buffer.alloc(sampleRateHertz * 2 * 2);
  const writeTone = (fromMs, toMs, amplitude, frequencyHertz) => {
    const startSample = Math.max(0, Math.floor(fromMs * sampleRateHertz / 1000));
    const endSample = Math.floor(toMs * sampleRateHertz / 1000);
    for (let sampleIndex = startSample; sampleIndex < endSample; sampleIndex++) {
      const sample = amplitude * Math.sin(2 * Math.PI * frequencyHertz * sampleIndex / sampleRateHertz);
      pcmBytes.writeInt16LE(Math.round(sample * 32767), sampleIndex * 2);
    }
  };
  writeTone(speechStartsAtMs - 80, speechStartsAtMs, 0.001, 2400); // Quiet consonant below the speech threshold.
  writeTone(speechStartsAtMs, 1700, 0.12, 220);
  return pcmBytes;
}

function ffmpeg(args, input) {
  const result = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', args, {
    input,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout;
}

test('WebM originals are decoded once into a trimmed, mono 16 kHz WAV and remain byte-for-byte unchanged', async () => {
  const originalPcmBytes = speechFixturePcm();
  const originalAudioBytes = waveFromPcm(originalPcmBytes);
  const webmAudioBytes = ffmpeg([
    '-hide_banner', '-loglevel', 'error', '-f', 'wav', '-i', 'pipe:0', '-map', '0:a:0',
    '-c:a', 'libopus', '-f', 'webm', 'pipe:1',
  ], originalAudioBytes);
  const originalCopy = Buffer.from(webmAudioBytes);
  const preparedAudio = await prepareSpeechAudio({
    audioBytes: webmAudioBytes,
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 2000,
  });

  assert.deepEqual(webmAudioBytes, originalCopy);
  assert.equal(preparedAudio.mimeType, 'audio/wav');
  assert.equal(preparedAudio.audioBytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(preparedAudio.audioBytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(preparedAudio.audioBytes.readUInt32LE(24), sampleRateHertz);
  assert.equal(preparedAudio.audioBytes.readUInt16LE(22), 1);
  assert.equal(preparedAudio.preprocessing.version, SPEECH_AUDIO_PREPROCESSING_VERSION);
  assert.ok(preparedAudio.preprocessing.trimmedLeadingSilenceMs > 600);
  assert.ok(preparedAudio.preprocessing.trimmedLeadingSilenceMs < 900);
  assert.ok(preparedAudio.preprocessing.trimmedLeadingSilenceMs <= 1080 - SPEECH_AUDIO_LEAD_IN_MS);
  assert.ok(preparedAudio.durationMs < 1500);
  assert.equal(preparedAudio.preprocessing.outputDurationMs, preparedAudio.durationMs);
  assert.equal(
    preparedAudio.preprocessing.preparedAudioSha256,
    createHash('sha256').update(preparedAudio.audioBytes).digest('hex'),
  );

  const outputPcmBytes = preparedAudio.audioBytes.subarray(44);
  const quietConsonantSample = Math.floor((1080 - preparedAudio.preprocessing.trimmedLeadingSilenceMs + 20) * sampleRateHertz / 1000);
  assert.ok(Math.abs(outputPcmBytes.readInt16LE(quietConsonantSample * 2)) > 0, 'the 300 ms lead-in keeps the quiet first sound');
});

test('audio that starts with speech keeps its beginning and silence-only audio is left untrimmed', async () => {
  const speechAtStart = await prepareSpeechAudio({
    audioBytes: waveFromPcm(speechFixturePcm({ speechStartsAtMs: 20 })),
    mimeType: 'audio/wav', durationMs: 2000,
  });
  assert.equal(speechAtStart.preprocessing.trimmedLeadingSilenceMs, 0);

  const silenceBytes = Buffer.alloc(sampleRateHertz * 2 * 1.4);
  const silenceOnly = await prepareSpeechAudio({ audioBytes: waveFromPcm(silenceBytes), mimeType: 'audio/wav', durationMs: 1400 });
  assert.equal(silenceOnly.preprocessing.trimmedLeadingSilenceMs, 0);
  assert.equal(silenceOnly.durationMs, 1400);
});

test('malformed audio fails before a Google request can be prepared', async () => {
  await assert.rejects(
    prepareSpeechAudio({ audioBytes: Buffer.from('not a WAV file'), mimeType: 'audio/wav', durationMs: 1000 }),
    error => error.code === 'speech_audio_decode_failed' && error.httpStatus === 422,
  );
});
