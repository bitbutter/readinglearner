import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractIsolatedWordSpeechFeatures,
  ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION,
  rankApprovedWordReferences,
} from '../reference_matcher.mjs';

const SAMPLE_RATE_HERTZ = 16_000;

function monoPcmWav(pcmBytes, { sampleRateHertz = SAMPLE_RATE_HERTZ } = {}) {
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

function wordLikeRecording(phoneticSegments, durationScale = 1, volume = 0.22) {
  const sampleCount = Math.round(phoneticSegments.reduce((durationTotal, segment) => (
    durationTotal + segment.durationMs * durationScale
  ), 0) * SAMPLE_RATE_HERTZ / 1000);
  const pcmBytes = Buffer.alloc(sampleCount * 2);
  let writeSampleIndex = 0;

  for (const segment of phoneticSegments) {
    const segmentSampleCount = Math.round(segment.durationMs * durationScale * SAMPLE_RATE_HERTZ / 1000);
    for (let segmentSampleIndex = 0; segmentSampleIndex < segmentSampleCount; segmentSampleIndex++, writeSampleIndex++) {
      const phase = 2 * Math.PI * segmentSampleIndex / SAMPLE_RATE_HERTZ;
      const edgeFadeSamples = Math.round(0.015 * SAMPLE_RATE_HERTZ);
      const edgeFade = Math.min(1, segmentSampleIndex / edgeFadeSamples, (segmentSampleCount - segmentSampleIndex) / edgeFadeSamples);
      const harmonicSignal = segment.frequenciesHertz.reduce((signalTotal, frequencyHertz, harmonicIndex) => (
        signalTotal + Math.sin(phase * frequencyHertz) / (harmonicIndex + 1)
      ), 0);
      const sample = Math.max(-0.95, Math.min(0.95, volume * edgeFade * harmonicSignal));
      pcmBytes.writeInt16LE(Math.round(sample * 32767), writeSampleIndex * 2);
    }
  }
  return monoPcmWav(pcmBytes);
}

const matLikeSegments = [
  { durationMs: 120, frequenciesHertz: [310, 620, 930, 1_240] },
  { durationMs: 110, frequenciesHertz: [1_450, 2_200, 2_900, 3_600] },
  { durationMs: 220, frequenciesHertz: [190, 570, 950, 1_330, 1_710] },
  { durationMs: 110, frequenciesHertz: [1_900, 2_600, 3_300, 4_000] },
  { durationMs: 220, frequenciesHertz: [420, 840, 1_260, 1_680] },
];

const differentWordLikeSegments = [
  { durationMs: 120, frequenciesHertz: [420, 840, 1_260, 1_680] },
  { durationMs: 110, frequenciesHertz: [1_900, 2_600, 3_300, 4_000] },
  { durationMs: 220, frequenciesHertz: [310, 620, 930, 1_240] },
  { durationMs: 110, frequenciesHertz: [1_450, 2_200, 2_900, 3_600] },
  { durationMs: 220, frequenciesHertz: [190, 570, 950, 1_330, 1_710] },
];

test('isolated-word feature extraction is deterministic and returns JSON-safe frame vectors', () => {
  const preparedMonoPcmWavBuffer = wordLikeRecording(matLikeSegments);
  const extractedSpeechFeatureFrames = extractIsolatedWordSpeechFeatures(preparedMonoPcmWavBuffer);
  const repeatedSpeechFeatureFrames = extractIsolatedWordSpeechFeatures(preparedMonoPcmWavBuffer);

  assert.equal(ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION, 'mono16k-mfcc12-delta-constrained-dtw-v1');
  assert.deepEqual(repeatedSpeechFeatureFrames, extractedSpeechFeatureFrames);
  assert.ok(extractedSpeechFeatureFrames.length > 50);
  assert.ok(extractedSpeechFeatureFrames.every(featureFrame => (
    featureFrame.length === 24 && featureFrame.every(Number.isFinite)
  )));
  assert.doesNotThrow(() => JSON.stringify(extractedSpeechFeatureFrames));
});

test('the reference for the identical prepared word has zero DTW distance', () => {
  const wordSpeechFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments));
  const rankedWordMatches = rankApprovedWordReferences(wordSpeechFeatureFrames, [
    { word: 'mat', referenceId: 'mat-reference-1', featureFrames: wordSpeechFeatureFrames },
  ]);

  assert.deepEqual(rankedWordMatches, [{
    word: 'mat',
    referenceCount: 1,
    averageDistance: 0,
    minimumDistance: 0,
  }]);
});

test('constrained DTW ranks a time-stretched same word ahead of a different word', () => {
  const candidateFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments, 1.35));
  const matReferenceFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments));
  const differentWordFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(differentWordLikeSegments));
  const rankedWordMatches = rankApprovedWordReferences(candidateFeatureFrames, [
    { word: 'mat', referenceId: 'mat-reference-1', featureFrames: matReferenceFeatureFrames },
    { word: 'sat', referenceId: 'sat-reference-1', featureFrames: differentWordFeatureFrames },
  ]);

  assert.equal(rankedWordMatches[0].word, 'mat');
  assert.ok(rankedWordMatches[0].averageDistance < rankedWordMatches[1].averageDistance);
  assert.ok(rankedWordMatches.every(wordMatch => (
    wordMatch.averageDistance >= 0 && wordMatch.minimumDistance >= 0 && wordMatch.referenceCount === 1
  )));
});

test('per-word ranking reports the average and closest reference distances', () => {
  const candidateFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments));
  const closerReferenceFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments, 1.1));
  const fartherReferenceFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(differentWordLikeSegments));
  const rankedWordMatches = rankApprovedWordReferences(candidateFeatureFrames, [
    { word: 'mat', referenceId: 'mat-reference-1', featureFrames: candidateFeatureFrames },
    { word: 'mat', referenceId: 'mat-reference-2', featureFrames: fartherReferenceFeatureFrames },
    { word: 'sat', referenceId: 'sat-reference-1', featureFrames: fartherReferenceFeatureFrames },
  ]);

  const matWordMatch = rankedWordMatches.find(wordMatch => wordMatch.word === 'mat');
  assert.equal(matWordMatch.referenceCount, 2);
  assert.equal(matWordMatch.minimumDistance, 0);
  assert.ok(matWordMatch.averageDistance > matWordMatch.minimumDistance);
  assert.ok(matWordMatch.averageDistance < rankedWordMatches.find(wordMatch => wordMatch.word === 'sat').averageDistance);
});

test('per-frame spectral normalization makes features insensitive to recording volume', () => {
  const quietSpeechFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments, 1, 0.08));
  const loudSpeechFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(matLikeSegments, 1, 0.42));
  const differentWordFeatureFrames = extractIsolatedWordSpeechFeatures(wordLikeRecording(differentWordLikeSegments));
  const loudAgainstQuiet = rankApprovedWordReferences(loudSpeechFeatureFrames, [
    { word: 'mat', referenceId: 'mat-quiet-reference', featureFrames: quietSpeechFeatureFrames },
  ]);
  const differentWordAgainstQuiet = rankApprovedWordReferences(quietSpeechFeatureFrames, [
    { word: 'sat', referenceId: 'sat-reference', featureFrames: differentWordFeatureFrames },
  ]);

  assert.ok(loudAgainstQuiet[0].averageDistance < 0.1);
  assert.ok(loudAgainstQuiet[0].averageDistance < differentWordAgainstQuiet[0].averageDistance);
});

test('malformed or incompatible WAV audio is rejected before feature extraction', () => {
  assert.throws(() => extractIsolatedWordSpeechFeatures(Buffer.from('not a WAV file')), /valid RIFF\/WAVE header/);

  const malformedWav = wordLikeRecording(matLikeSegments);
  malformedWav.writeUInt32LE(malformedWav.length, 4);
  assert.throws(() => extractIsolatedWordSpeechFeatures(malformedWav), /RIFF length/);

  const wrongSampleRateWav = wordLikeRecording(matLikeSegments);
  wrongSampleRateWav.writeUInt32LE(8_000, 24);
  assert.throws(() => extractIsolatedWordSpeechFeatures(wrongSampleRateWav), /mono, 16 kHz/);
});

test('feature ranking rejects invalid frame vectors without silently coercing them', () => {
  assert.throws(() => rankApprovedWordReferences([[1, 2]], []), /must contain 24 numeric features/);
  assert.throws(() => rankApprovedWordReferences([[...Array(23).fill(0), Number.NaN]], []), /finite speech feature value/);
  assert.throws(() => rankApprovedWordReferences([], []), /non-empty array/);
});
