export const ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION = 'mono16k-mfcc12-delta-constrained-dtw-v1';

const SPEECH_SAMPLE_RATE_HERTZ = 16_000;
const MAX_AUDIO_DURATION_SECONDS = 10;
const MAX_PCM_SAMPLE_COUNT = SPEECH_SAMPLE_RATE_HERTZ * MAX_AUDIO_DURATION_SECONDS;
const FRAME_LENGTH_SAMPLES = 400; // 25 ms.
const FRAME_SHIFT_SAMPLES = 160; // 10 ms.
const FFT_LENGTH_SAMPLES = 512;
const MEL_FILTER_COUNT = 26;
const MFCC_COEFFICIENT_COUNT = 12;
const MFCC_FEATURE_DIMENSION_COUNT = MFCC_COEFFICIENT_COUNT * 2;
const PREEMPHASIS_FACTOR = 0.97;
const MEL_LOW_FREQUENCY_HERTZ = 80;
const MEL_HIGH_FREQUENCY_HERTZ = 7_600;
const DTW_BAND_FRACTION = 0.2;

const hammingWindow = Float64Array.from({ length: FRAME_LENGTH_SAMPLES }, (_, sampleIndex) => (
  0.54 - 0.46 * Math.cos(2 * Math.PI * sampleIndex / (FRAME_LENGTH_SAMPLES - 1))
));

function hzToMel(frequencyHertz) {
  return 2595 * Math.log10(1 + frequencyHertz / 700);
}

function createMelFilterBank() {
  const lowMel = hzToMel(MEL_LOW_FREQUENCY_HERTZ);
  const highMel = hzToMel(MEL_HIGH_FREQUENCY_HERTZ);
  const melPoints = Array.from({ length: MEL_FILTER_COUNT + 2 }, (_, pointIndex) => (
    lowMel + (highMel - lowMel) * pointIndex / (MEL_FILTER_COUNT + 1)
  ));
  const binFrequenciesHertz = Array.from({ length: FFT_LENGTH_SAMPLES / 2 + 1 }, (_, binIndex) => (
    binIndex * SPEECH_SAMPLE_RATE_HERTZ / FFT_LENGTH_SAMPLES
  ));

  return Array.from({ length: MEL_FILTER_COUNT }, (_, filterIndex) => {
    const leftMel = melPoints[filterIndex];
    const centerMel = melPoints[filterIndex + 1];
    const rightMel = melPoints[filterIndex + 2];
    return Float64Array.from(binFrequenciesHertz, frequencyHertz => {
      const frequencyMel = hzToMel(frequencyHertz);
      if (frequencyMel < leftMel || frequencyMel > rightMel) return 0;
      return frequencyMel <= centerMel
        ? (frequencyMel - leftMel) / (centerMel - leftMel)
        : (rightMel - frequencyMel) / (rightMel - centerMel);
    });
  });
}

const melFilterBank = createMelFilterBank();
const dctBasis = Array.from({ length: MFCC_COEFFICIENT_COUNT + 1 }, (_, coefficientIndex) => (
  Float64Array.from({ length: MEL_FILTER_COUNT }, (_, filterIndex) => (
    Math.cos(Math.PI * coefficientIndex * (filterIndex + 0.5) / MEL_FILTER_COUNT)
  ))
));

function parseMono16KhzPcmWav(preparedMonoPcmWavBuffer) {
  if (!Buffer.isBuffer(preparedMonoPcmWavBuffer)) {
    throw new TypeError('Prepared speech audio must be a Buffer containing a PCM WAV file.');
  }
  if (preparedMonoPcmWavBuffer.length < 44
    || preparedMonoPcmWavBuffer.toString('ascii', 0, 4) !== 'RIFF'
    || preparedMonoPcmWavBuffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new RangeError('Prepared speech audio must contain a valid RIFF/WAVE header.');
  }

  const declaredRiffLength = preparedMonoPcmWavBuffer.readUInt32LE(4);
  if (declaredRiffLength + 8 !== preparedMonoPcmWavBuffer.length) {
    throw new RangeError('The WAV RIFF length does not match its audio bytes.');
  }

  let audioFormat = null;
  let channelCount = null;
  let sampleRateHertz = null;
  let byteRate = null;
  let blockAlign = null;
  let bitsPerSample = null;
  let pcmAudioBytes = null;
  let chunkOffset = 12;

  while (chunkOffset + 8 <= preparedMonoPcmWavBuffer.length) {
    const chunkName = preparedMonoPcmWavBuffer.toString('ascii', chunkOffset, chunkOffset + 4);
    const chunkLength = preparedMonoPcmWavBuffer.readUInt32LE(chunkOffset + 4);
    const chunkDataOffset = chunkOffset + 8;
    const chunkEndOffset = chunkDataOffset + chunkLength;
    if (chunkEndOffset > preparedMonoPcmWavBuffer.length) {
      throw new RangeError(`The WAV ${chunkName} chunk extends past the end of the file.`);
    }

    if (chunkName === 'fmt ') {
      if (audioFormat !== null || chunkLength < 16) {
        throw new RangeError('The WAV must contain one complete PCM format chunk.');
      }
      audioFormat = preparedMonoPcmWavBuffer.readUInt16LE(chunkDataOffset);
      channelCount = preparedMonoPcmWavBuffer.readUInt16LE(chunkDataOffset + 2);
      sampleRateHertz = preparedMonoPcmWavBuffer.readUInt32LE(chunkDataOffset + 4);
      byteRate = preparedMonoPcmWavBuffer.readUInt32LE(chunkDataOffset + 8);
      blockAlign = preparedMonoPcmWavBuffer.readUInt16LE(chunkDataOffset + 12);
      bitsPerSample = preparedMonoPcmWavBuffer.readUInt16LE(chunkDataOffset + 14);
    } else if (chunkName === 'data') {
      if (pcmAudioBytes !== null) throw new RangeError('The WAV must contain one audio data chunk.');
      pcmAudioBytes = preparedMonoPcmWavBuffer.subarray(chunkDataOffset, chunkEndOffset);
    }

    chunkOffset = chunkEndOffset + (chunkLength % 2);
  }

  if (chunkOffset !== preparedMonoPcmWavBuffer.length) {
    throw new RangeError('The WAV contains an incomplete chunk header or padding byte.');
  }
  if (audioFormat !== 1 || channelCount !== 1 || sampleRateHertz !== SPEECH_SAMPLE_RATE_HERTZ
    || byteRate !== SPEECH_SAMPLE_RATE_HERTZ * 2 || blockAlign !== 2 || bitsPerSample !== 16) {
    throw new RangeError('Prepared speech audio must be mono, 16 kHz, signed 16-bit PCM WAV.');
  }
  if (!pcmAudioBytes || pcmAudioBytes.length === 0 || pcmAudioBytes.length % 2 !== 0) {
    throw new RangeError('The WAV audio data must contain complete 16-bit PCM samples.');
  }

  const pcmSampleCount = pcmAudioBytes.length / 2;
  if (pcmSampleCount > MAX_PCM_SAMPLE_COUNT) {
    throw new RangeError(`Prepared speech audio cannot exceed ${MAX_AUDIO_DURATION_SECONDS} seconds.`);
  }
  return { pcmAudioBytes, pcmSampleCount };
}

function fftInPlace(realParts, imaginaryParts) {
  const valueCount = realParts.length;
  for (let sourceIndex = 1, reversedIndex = 0; sourceIndex < valueCount; sourceIndex++) {
    let bit = valueCount >> 1;
    while (reversedIndex & bit) {
      reversedIndex ^= bit;
      bit >>= 1;
    }
    reversedIndex ^= bit;
    if (sourceIndex < reversedIndex) {
      [realParts[sourceIndex], realParts[reversedIndex]] = [realParts[reversedIndex], realParts[sourceIndex]];
      [imaginaryParts[sourceIndex], imaginaryParts[reversedIndex]] = [imaginaryParts[reversedIndex], imaginaryParts[sourceIndex]];
    }
  }

  for (let butterflyLength = 2; butterflyLength <= valueCount; butterflyLength <<= 1) {
    const halfLength = butterflyLength >> 1;
    const angleStep = -2 * Math.PI / butterflyLength;
    for (let sectionStart = 0; sectionStart < valueCount; sectionStart += butterflyLength) {
      for (let butterflyIndex = 0; butterflyIndex < halfLength; butterflyIndex++) {
        const angle = angleStep * butterflyIndex;
        const twiddleReal = Math.cos(angle);
        const twiddleImaginary = Math.sin(angle);
        const evenIndex = sectionStart + butterflyIndex;
        const oddIndex = evenIndex + halfLength;
        const oddReal = realParts[oddIndex] * twiddleReal - imaginaryParts[oddIndex] * twiddleImaginary;
        const oddImaginary = realParts[oddIndex] * twiddleImaginary + imaginaryParts[oddIndex] * twiddleReal;
        const evenReal = realParts[evenIndex];
        const evenImaginary = imaginaryParts[evenIndex];
        realParts[evenIndex] = evenReal + oddReal;
        imaginaryParts[evenIndex] = evenImaginary + oddImaginary;
        realParts[oddIndex] = evenReal - oddReal;
        imaginaryParts[oddIndex] = evenImaginary - oddImaginary;
      }
    }
  }
}

function mfccsForPcmFrame(pcmAudioBytes, frameStartSampleIndex, pcmSampleCount) {
  const realParts = new Float64Array(FFT_LENGTH_SAMPLES);
  const imaginaryParts = new Float64Array(FFT_LENGTH_SAMPLES);
  let windowedFrameEnergy = 0;
  let previousPcmSample = frameStartSampleIndex > 0
    ? pcmAudioBytes.readInt16LE((frameStartSampleIndex - 1) * 2) / 32768
    : 0;

  for (let frameSampleIndex = 0; frameSampleIndex < FRAME_LENGTH_SAMPLES; frameSampleIndex++) {
    const sourceSampleIndex = frameStartSampleIndex + frameSampleIndex;
    const pcmSample = sourceSampleIndex < pcmSampleCount
      ? pcmAudioBytes.readInt16LE(sourceSampleIndex * 2) / 32768
      : 0;
    const emphasizedSample = pcmSample - PREEMPHASIS_FACTOR * previousPcmSample;
    const windowedSample = emphasizedSample * hammingWindow[frameSampleIndex];
    realParts[frameSampleIndex] = windowedSample;
    windowedFrameEnergy += windowedSample * windowedSample;
    previousPcmSample = pcmSample;
  }
  if (windowedFrameEnergy > 0) {
    const frameVolumeNormalization = 1 / Math.sqrt(windowedFrameEnergy);
    for (let frameSampleIndex = 0; frameSampleIndex < FRAME_LENGTH_SAMPLES; frameSampleIndex++) {
      realParts[frameSampleIndex] *= frameVolumeNormalization;
    }
  }
  fftInPlace(realParts, imaginaryParts);

  const melEnergies = new Float64Array(MEL_FILTER_COUNT);
  let totalMelEnergy = 0;
  for (let filterIndex = 0; filterIndex < MEL_FILTER_COUNT; filterIndex++) {
    let filterEnergy = 0;
    const filterWeights = melFilterBank[filterIndex];
    for (let binIndex = 0; binIndex <= FFT_LENGTH_SAMPLES / 2; binIndex++) {
      const power = realParts[binIndex] ** 2 + imaginaryParts[binIndex] ** 2;
      filterEnergy += power * filterWeights[binIndex];
    }
    melEnergies[filterIndex] = filterEnergy;
    totalMelEnergy += filterEnergy;
  }

  const normalizedLogMelEnergies = Float64Array.from(melEnergies, filterEnergy => (
    Math.log(Math.max(filterEnergy / Math.max(totalMelEnergy, 1e-20), 1e-12))
  ));
  return Array.from({ length: MFCC_COEFFICIENT_COUNT }, (_, featureIndex) => {
    const coefficientIndex = featureIndex + 1; // C0 mostly describes energy, not word identity.
    let coefficient = 0;
    for (let filterIndex = 0; filterIndex < MEL_FILTER_COUNT; filterIndex++) {
      coefficient += normalizedLogMelEnergies[filterIndex] * dctBasis[coefficientIndex][filterIndex];
    }
    return coefficient * Math.sqrt(2 / MEL_FILTER_COUNT);
  });
}

function deltaFeatureAt(mfccFrames, frameIndex, coefficientIndex) {
  let weightedDifference = 0;
  for (let offset = 1; offset <= 2; offset++) {
    const previousFrame = mfccFrames[Math.max(0, frameIndex - offset)];
    const nextFrame = mfccFrames[Math.min(mfccFrames.length - 1, frameIndex + offset)];
    weightedDifference += offset * (nextFrame[coefficientIndex] - previousFrame[coefficientIndex]);
  }
  return weightedDifference / 10;
}

function validateFeatureFrames(featureFrames, argumentName) {
  if (!Array.isArray(featureFrames) || featureFrames.length === 0) {
    throw new TypeError(`${argumentName} must be a non-empty array of speech feature frames.`);
  }
  if (featureFrames.length > MAX_PCM_SAMPLE_COUNT / FRAME_SHIFT_SAMPLES + 1) {
    throw new RangeError(`${argumentName} contains more frames than a ${MAX_AUDIO_DURATION_SECONDS}-second recording.`);
  }
  for (let frameIndex = 0; frameIndex < featureFrames.length; frameIndex++) {
    const featureFrame = featureFrames[frameIndex];
    if (!Array.isArray(featureFrame) || featureFrame.length !== MFCC_FEATURE_DIMENSION_COUNT) {
      throw new TypeError(`${argumentName}[${frameIndex}] must contain ${MFCC_FEATURE_DIMENSION_COUNT} numeric features.`);
    }
    for (let featureIndex = 0; featureIndex < featureFrame.length; featureIndex++) {
      if (!Number.isFinite(featureFrame[featureIndex]) || Math.abs(featureFrame[featureIndex]) > 1_000_000) {
        throw new TypeError(`${argumentName}[${frameIndex}][${featureIndex}] must be a finite speech feature value.`);
      }
    }
  }
  return featureFrames;
}

export function extractIsolatedWordSpeechFeatures(preparedMonoPcmWavBuffer) {
  const { pcmAudioBytes, pcmSampleCount } = parseMono16KhzPcmWav(preparedMonoPcmWavBuffer);
  const frameCount = Math.ceil(pcmSampleCount / FRAME_SHIFT_SAMPLES);
  const mfccFrames = Array.from({ length: frameCount }, (_, frameIndex) => (
    mfccsForPcmFrame(pcmAudioBytes, frameIndex * FRAME_SHIFT_SAMPLES, pcmSampleCount)
  ));
  const featureFrames = mfccFrames.map((mfccFrame, frameIndex) => ([
    ...mfccFrame,
    ...mfccFrame.map((_, coefficientIndex) => deltaFeatureAt(mfccFrames, frameIndex, coefficientIndex)),
  ]));
  return validateFeatureFrames(featureFrames, 'Extracted speech features');
}

function constrainedDtwAverageDistance(candidateFeatureFrames, referenceFeatureFrames) {
  const candidateFrameCount = candidateFeatureFrames.length;
  const referenceFrameCount = referenceFeatureFrames.length;
  const bandWidth = Math.max(
    2,
    Math.abs(candidateFrameCount - referenceFrameCount),
    Math.ceil(Math.max(candidateFrameCount, referenceFrameCount) * DTW_BAND_FRACTION),
  );
  let previousCosts = new Float64Array(referenceFrameCount + 1).fill(Number.POSITIVE_INFINITY);
  let previousPathLengths = new Uint32Array(referenceFrameCount + 1);
  previousCosts[0] = 0;

  for (let candidateIndex = 1; candidateIndex <= candidateFrameCount; candidateIndex++) {
    const currentCosts = new Float64Array(referenceFrameCount + 1).fill(Number.POSITIVE_INFINITY);
    const currentPathLengths = new Uint32Array(referenceFrameCount + 1);
    const progressCenter = candidateFrameCount === 1
      ? 1
      : 1 + (candidateIndex - 1) * (referenceFrameCount - 1) / (candidateFrameCount - 1);
    const firstReferenceIndex = Math.max(1, Math.floor(progressCenter - bandWidth));
    const lastReferenceIndex = Math.min(referenceFrameCount, Math.ceil(progressCenter + bandWidth));

    for (let referenceIndex = firstReferenceIndex; referenceIndex <= lastReferenceIndex; referenceIndex++) {
      let squaredFeatureDifference = 0;
      const candidateFrame = candidateFeatureFrames[candidateIndex - 1];
      const referenceFrame = referenceFeatureFrames[referenceIndex - 1];
      for (let featureIndex = 0; featureIndex < MFCC_FEATURE_DIMENSION_COUNT; featureIndex++) {
        const difference = candidateFrame[featureIndex] - referenceFrame[featureIndex];
        squaredFeatureDifference += difference * difference;
      }
      const localDistance = Math.sqrt(squaredFeatureDifference / MFCC_FEATURE_DIMENSION_COUNT);

      let predecessorCost = previousCosts[referenceIndex - 1];
      let predecessorPathLength = previousPathLengths[referenceIndex - 1];
      if (previousCosts[referenceIndex] < predecessorCost) {
        predecessorCost = previousCosts[referenceIndex];
        predecessorPathLength = previousPathLengths[referenceIndex];
      }
      if (currentCosts[referenceIndex - 1] < predecessorCost) {
        predecessorCost = currentCosts[referenceIndex - 1];
        predecessorPathLength = currentPathLengths[referenceIndex - 1];
      }
      if (Number.isFinite(predecessorCost)) {
        currentCosts[referenceIndex] = predecessorCost + localDistance;
        currentPathLengths[referenceIndex] = predecessorPathLength + 1;
      }
    }

    previousCosts = currentCosts;
    previousPathLengths = currentPathLengths;
  }

  const totalPathDistance = previousCosts[referenceFrameCount];
  const alignedFrameCount = previousPathLengths[referenceFrameCount];
  if (!Number.isFinite(totalPathDistance) || alignedFrameCount === 0) {
    throw new RangeError('The constrained DTW path could not align these speech recordings.');
  }
  return totalPathDistance / alignedFrameCount;
}

export function rankApprovedWordReferences(candidateFeatureFrames, approvedWordReferences) {
  validateFeatureFrames(candidateFeatureFrames, 'Candidate speech features');
  if (!Array.isArray(approvedWordReferences)) {
    throw new TypeError('Approved word references must be an array.');
  }

  const distancesByWord = new Map();
  approvedWordReferences.forEach((approvedWordReference, referenceIndex) => {
    if (!approvedWordReference || typeof approvedWordReference.word !== 'string' || !approvedWordReference.word.trim()) {
      throw new TypeError(`Approved word reference ${referenceIndex} must have a non-empty word.`);
    }
    if (typeof approvedWordReference.referenceId !== 'string' || !approvedWordReference.referenceId.trim()) {
      throw new TypeError(`Approved word reference ${referenceIndex} must have a non-empty referenceId.`);
    }
    const referenceFeatureFrames = validateFeatureFrames(
      approvedWordReference.featureFrames,
      `Approved word reference ${approvedWordReference.referenceId} features`,
    );
    const distance = constrainedDtwAverageDistance(candidateFeatureFrames, referenceFeatureFrames);
    const wordReferences = distancesByWord.get(approvedWordReference.word) ?? [];
    wordReferences.push(distance);
    distancesByWord.set(approvedWordReference.word, wordReferences);
  });

  return Array.from(distancesByWord, ([word, referenceDistances]) => ({
    word,
    referenceCount: referenceDistances.length,
    averageDistance: referenceDistances.reduce((distanceTotal, distance) => distanceTotal + distance, 0) / referenceDistances.length,
    minimumDistance: referenceDistances.reduce((minimum, distance) => Math.min(minimum, distance), Number.POSITIVE_INFINITY),
  })).sort((left, right) => (
    left.averageDistance - right.averageDistance
    || left.minimumDistance - right.minimumDistance
    || left.word.localeCompare(right.word)
  ));
}
