import { createHash, randomUUID } from 'node:crypto';
import { GoogleAuth } from 'google-auth-library';
import { prepareSpeechAudio, SPEECH_AUDIO_PREPROCESSING_VERSION } from './audio_preprocessing.mjs';
import { extractIsolatedWordSpeechFeatures, rankApprovedWordReferences, ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION } from './reference_matcher.mjs';
import { MAX_AUDIO_BYTES } from './providers.mjs';

export const REFERENCE_LIBRARY_SCHEMA_VERSION = 1;
export const REFERENCE_MATCHER_VERSION = ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION;
export const MAX_APPROVED_REFERENCES = 100;
export const MAX_REFERENCES_PER_WORD = 10;
export const MAX_REFERENCE_REQUEST_BYTES = Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 2 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECORDING_MIME_TYPES = new Set(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']);
const REFERENCE_OBJECT_PREFIX = 'reference-recordings/v1/';
const GOOGLE_STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write';

export class ReferenceLibraryError extends Error {
  constructor(httpStatus, code, message) {
    super(message);
    this.name = 'ReferenceLibraryError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

function normalizedWord(value) {
  if (typeof value !== 'string') throw new ReferenceLibraryError(400, 'invalid_reference_word', 'Select a single word for this reference.');
  const word = value.normalize('NFKC').trim().toLocaleLowerCase('en-GB');
  if (!/^[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)*$/u.test(word) || [...word].length > 32) {
    throw new ReferenceLibraryError(400, 'invalid_reference_word', 'Reference labels must be a single word of at most 32 letters.');
  }
  return word;
}

function recordingFields(request, purpose) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new ReferenceLibraryError(400, 'invalid_reference_recording', 'Send a JSON object containing the saved recording.');
  }
  const allowedFields = new Set(['attemptId', 'word', 'expectedWord', 'mimeType', 'durationMs', 'audioBase64']);
  if (Object.keys(request).some(field => !allowedFields.has(field))) {
    throw new ReferenceLibraryError(400, 'unexpected_reference_fields', 'The reference request contains unsupported fields.');
  }
  const attemptId = request.attemptId;
  if (typeof attemptId !== 'string' || !UUID_PATTERN.test(attemptId)) {
    throw new ReferenceLibraryError(400, 'invalid_attempt_id', 'The recording attempt must have a valid ID.');
  }
  const word = normalizedWord(purpose === 'approval' ? request.word : request.expectedWord);
  if (!Number.isFinite(request.durationMs) || request.durationMs <= 0 || request.durationMs > 10_000) {
    throw new ReferenceLibraryError(400, 'invalid_recording_duration', 'Reference recordings must be positive and no longer than 10 seconds.');
  }
  if (typeof request.mimeType !== 'string' || request.mimeType.length > 100) {
    throw new ReferenceLibraryError(400, 'unsupported_audio_format', 'Use WebM, Ogg, MP4 or WAV audio.');
  }
  const mimeType = request.mimeType.split(';', 1)[0].trim().toLowerCase();
  if (!RECORDING_MIME_TYPES.has(mimeType)) {
    throw new ReferenceLibraryError(400, 'unsupported_audio_format', 'Use WebM, Ogg, MP4 or WAV audio.');
  }
  const audioBase64 = request.audioBase64;
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0 || audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 ||
      audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audioBase64)) {
    throw new ReferenceLibraryError(400, 'invalid_audio_base64', 'Audio must be canonical base64 no larger than 10 MiB.');
  }
  const audioBytes = Buffer.from(audioBase64, 'base64');
  if (audioBytes.length === 0 || audioBytes.length > MAX_AUDIO_BYTES || audioBytes.toString('base64') !== audioBase64) {
    throw new ReferenceLibraryError(audioBytes.length > MAX_AUDIO_BYTES ? 413 : 400, 'invalid_audio_base64', 'Audio must be canonical base64 no larger than 10 MiB.');
  }
  return {
    attemptId: attemptId.toLowerCase(), word, mimeType, durationMs: request.durationMs,
    audioBytes, audioSha256: createHash('sha256').update(audioBytes).digest('hex'),
  };
}

function validateBucketName(bucketName) {
  if (typeof bucketName !== 'string' || bucketName.length < 3 || bucketName.length > 222 ||
      !/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(bucketName) || bucketName.includes('..')) {
    throw new Error('SPEECH_REFERENCE_BUCKET must be a valid Cloud Storage bucket name.');
  }
  return bucketName;
}

function objectMetadata(reference) {
  return {
    referenceId: reference.referenceId,
    attemptId: reference.attemptId,
    word: reference.word,
    mimeType: reference.mimeType,
    durationMs: String(reference.durationMs),
    audioSha256: reference.audioSha256,
    schemaVersion: String(REFERENCE_LIBRARY_SCHEMA_VERSION),
    preprocessingVersion: reference.preprocessing.version,
    matcherVersion: reference.matcherVersion,
  };
}

function referenceSummary(reference) {
  return {
    referenceId: reference.referenceId,
    attemptId: reference.attemptId,
    word: reference.word,
    mimeType: reference.mimeType,
    durationMs: reference.durationMs,
    audioSha256: reference.audioSha256,
    createdAt: reference.createdAt || null,
    preprocessingVersion: reference.preprocessingVersion || reference.preprocessing?.version,
    matcherVersion: reference.matcherVersion,
  };
}

function referenceSummaryFromObject(object) {
  const metadata = object.metadata || {};
  let word;
  try { word = normalizedWord(metadata.word); }
  catch { throw new ReferenceLibraryError(502, 'invalid_reference_record', 'The reference library contains an invalid word label.'); }
  const expectedName = `${REFERENCE_OBJECT_PREFIX}${metadata.referenceId}.json`;
  const durationMs = Number(metadata.durationMs);
  if (!UUID_PATTERN.test(metadata.referenceId || '') || object.name !== expectedName ||
      !UUID_PATTERN.test(metadata.attemptId || '') || !RECORDING_MIME_TYPES.has(metadata.mimeType) ||
      !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 10_000 ||
      !/^[a-f0-9]{64}$/.test(metadata.audioSha256 || '') ||
      metadata.schemaVersion !== String(REFERENCE_LIBRARY_SCHEMA_VERSION) ||
      metadata.preprocessingVersion !== SPEECH_AUDIO_PREPROCESSING_VERSION || metadata.matcherVersion !== REFERENCE_MATCHER_VERSION) {
    throw new ReferenceLibraryError(502, 'invalid_reference_record', 'The reference library contains an unsupported recording.');
  }
  return {
    referenceId: metadata.referenceId,
    attemptId: metadata.attemptId,
    word,
    mimeType: metadata.mimeType,
    durationMs,
    audioSha256: metadata.audioSha256,
    createdAt: object.timeCreated || null,
    preprocessingVersion: metadata.preprocessingVersion,
    matcherVersion: metadata.matcherVersion,
  };
}

export function createGoogleCloudReferenceLibrary({
  bucketName, auth = new GoogleAuth({ scopes: [GOOGLE_STORAGE_SCOPE] }),
  fetchImplementation = fetch, prepareAudio = prepareSpeechAudio,
  extractFeatures = extractIsolatedWordSpeechFeatures,
  rankReferences = rankApprovedWordReferences,
  reportStorageRejection = details => console.warn(JSON.stringify(details)),
  now = () => new Date().toISOString(),
}) {
  const bucket = validateBucketName(bucketName);
  async function authorizedFetch(url, options = {}) {
    const client = await auth.getClient();
    const accessTokenResult = await client.getAccessToken();
    const accessToken = typeof accessTokenResult === 'string' ? accessTokenResult : accessTokenResult?.token;
    if (!accessToken) throw new ReferenceLibraryError(503, 'reference_storage_credentials_unavailable', 'The speech server cannot access the reference library.');
    const { allowMissing = false, conflictCode = null, ...fetchOptions } = options;
    let response;
    try {
      response = await fetchImplementation(url, {
        ...fetchOptions,
        headers: { ...(fetchOptions.headers || {}), Authorization: `Bearer ${accessToken}` },
        signal: fetchOptions.signal ? AbortSignal.any([fetchOptions.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ReferenceLibraryError(503, 'reference_storage_unavailable', 'The reference library could not be reached.');
    }
    if (!response.ok) {
      if (response.status === 404 && allowMissing) return null;
      if (response.status === 412 && conflictCode) {
        throw new ReferenceLibraryError(409, conflictCode, 'This saved take is already approved as a reference.');
      }
      const storageError = await response.clone().json().catch(() => null);
      const storageErrorReason = storageError?.error?.errors?.find(error =>
        typeof error?.reason === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(error.reason))?.reason || null;
      const storageErrorStatus = typeof storageError?.error?.status === 'string' &&
        /^[A-Za-z0-9_.-]{1,64}$/.test(storageError.error.status) ? storageError.error.status : null;
      reportStorageRejection({
        event: 'reference_storage_request_rejected',
        method: fetchOptions.method || 'GET',
        upstreamStatus: response.status,
        reason: storageErrorReason,
        status: storageErrorStatus,
      });
      const status = response.status === 429 || response.status >= 500 ? 503 : 502;
      const diagnostic = storageErrorReason || storageErrorStatus;
      const message = `Cloud Storage rejected the request (HTTP ${response.status}${diagnostic ? `, ${diagnostic}` : ''}).`;
      throw new ReferenceLibraryError(status, 'reference_storage_error', message);
    }
    return response;
  }

  async function uploadReference(reference, signal) {
    const objectName = `${REFERENCE_OBJECT_PREFIX}${reference.referenceId}.json`;
    const metadataDocument = { name: objectName, contentType: 'application/json', metadata: objectMetadata(reference) };
    const boundary = `readinglearner-${randomUUID()}`;
    const content = JSON.stringify(reference);
    const body = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadataDocument)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`,
    );
    const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
    url.searchParams.set('uploadType', 'multipart');
    url.searchParams.set('name', objectName);
    url.searchParams.set('ifGenerationMatch', '0');
    await authorizedFetch(url, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}`, 'Content-Length': String(body.length) }, body, signal, conflictCode: 'attempt_already_a_reference' });
  }

  async function listReferenceObjects(signal) {
    const objectMetadataList = [];
    let pageToken;
    for (let page = 0; page < 100; page++) {
      const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set('prefix', REFERENCE_OBJECT_PREFIX);
      url.searchParams.set('maxResults', '1000');
      url.searchParams.set('fields', 'items(name,metadata,timeCreated),nextPageToken');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await authorizedFetch(url, { signal });
      const pageResult = await response.json();
      objectMetadataList.push(...(pageResult.items || []));
      if (objectMetadataList.length > MAX_APPROVED_REFERENCES) {
        throw new ReferenceLibraryError(413, 'reference_library_too_large', `The reference library is limited to ${MAX_APPROVED_REFERENCES} recordings.`);
      }
      pageToken = pageResult.nextPageToken;
      if (!pageToken) break;
      if (page === 99) throw new ReferenceLibraryError(413, 'reference_library_too_large', 'The reference library contains too many recordings.');
    }
    for (const object of objectMetadataList) referenceSummaryFromObject(object);
    return objectMetadataList;
  }

  async function readReferenceFeatureRecords(objectMetadataList, signal) {
      const objects = objectMetadataList || await listReferenceObjects(signal);
      const referenceRows = [];
      for (let offset = 0; offset < objects.length; offset += 8) {
        const batch = objects.slice(offset, offset + 8);
        const references = await Promise.all(batch.map(async object => {
          const metadata = object.metadata || {};
          const mediaUrl = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(object.name)}`);
          mediaUrl.searchParams.set('alt', 'media');
          const response = await authorizedFetch(mediaUrl, { signal });
          let reference;
          try { reference = await response.json(); }
          catch { throw new ReferenceLibraryError(502, 'invalid_reference_record', 'A reference recording could not be read.'); }
          if (reference.schemaVersion !== REFERENCE_LIBRARY_SCHEMA_VERSION || reference.referenceId !== metadata.referenceId ||
              reference.attemptId !== metadata.attemptId || reference.word !== normalizedWord(metadata.word) ||
              reference.mimeType !== metadata.mimeType || String(reference.durationMs) !== metadata.durationMs ||
              reference.audioSha256 !== metadata.audioSha256 || reference.preprocessing?.version !== metadata.preprocessingVersion ||
              reference.matcherVersion !== REFERENCE_MATCHER_VERSION || !Array.isArray(reference.featureFrames) ||
              !UUID_PATTERN.test(reference.attemptId || '') || !Number.isFinite(reference.durationMs) || reference.durationMs <= 0 || reference.durationMs > 10_000 ||
              typeof reference.audioBase64 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.audioSha256 || '') ||
              !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(reference.audioBase64) ||
              Buffer.from(reference.audioBase64, 'base64').toString('base64') !== reference.audioBase64 ||
              createHash('sha256').update(Buffer.from(reference.audioBase64, 'base64')).digest('hex') !== reference.audioSha256 ||
              !reference.preprocessing || reference.preprocessing.version !== SPEECH_AUDIO_PREPROCESSING_VERSION ||
              reference.preprocessing.sampleRateHertz !== 16000 || reference.preprocessing.audioChannelCount !== 1 ||
              !reference.featureFrames.length || reference.featureFrames.length > 1000 ||
              reference.featureFrames.some(frame => !Array.isArray(frame) || frame.length !== 24 || frame.some(value => !Number.isFinite(value)))) {
            throw new ReferenceLibraryError(502, 'invalid_reference_record', 'The reference library metadata did not match its saved recording.');
          }
          reference.createdAt = object.timeCreated || null;
          return reference;
        }));
        referenceRows.push(...references);
      }
      return referenceRows;
  }

  async function listReferences({ signal } = {}) {
    const referenceSummaries = (await listReferenceObjects(signal)).map(referenceSummaryFromObject);
    return referenceSummaries.sort((left, right) => left.word.localeCompare(right.word) || (left.createdAt || '').localeCompare(right.createdAt || '') || left.referenceId.localeCompare(right.referenceId));
  }

  function extractPreparedFeatures(preparedAudio, purpose) {
    try { return extractFeatures(preparedAudio.audioBytes); }
    catch {
      const label = purpose === 'reference' ? 'reference' : 'comparison';
      throw new ReferenceLibraryError(422, `${label}_audio_not_isolated_word`, 'Use a short, clear recording of one word, no longer than 10 seconds.');
    }
  }

  async function approveReference(request, { signal } = {}) {
    const recording = recordingFields(request, 'approval');
    const references = (await listReferenceObjects(signal)).map(referenceSummaryFromObject);
    if (references.some(reference => reference.attemptId === recording.attemptId)) {
      throw new ReferenceLibraryError(409, 'attempt_already_a_reference', 'This take is already in the reference library.');
    }
    if (references.length >= MAX_APPROVED_REFERENCES) {
      throw new ReferenceLibraryError(409, 'reference_library_full', `The reference library is limited to ${MAX_APPROVED_REFERENCES} recordings.`);
    }
    if (references.filter(reference => reference.word === recording.word).length >= MAX_REFERENCES_PER_WORD) {
      throw new ReferenceLibraryError(409, 'word_reference_limit_reached', `Keep no more than ${MAX_REFERENCES_PER_WORD} references for “${recording.word}”.`);
    }
    const preparedAudio = await prepareAudio({ audioBytes: recording.audioBytes, mimeType: recording.mimeType, durationMs: recording.durationMs, signal });
    if (preparedAudio.preprocessing?.version !== SPEECH_AUDIO_PREPROCESSING_VERSION ||
        preparedAudio.preprocessing.sampleRateHertz !== 16000 || preparedAudio.preprocessing.audioChannelCount !== 1) {
      throw new ReferenceLibraryError(500, 'reference_audio_preparation_failed', 'The reference recording could not be prepared consistently.');
    }
    const featureFrames = extractPreparedFeatures(preparedAudio, 'reference');
    const reference = {
      schemaVersion: REFERENCE_LIBRARY_SCHEMA_VERSION,
      referenceId: recording.attemptId, attemptId: recording.attemptId, word: recording.word,
      mimeType: recording.mimeType, durationMs: recording.durationMs, audioSha256: recording.audioSha256,
      audioBase64: recording.audioBytes.toString('base64'),
      preprocessing: preparedAudio.preprocessing,
      matcherVersion: REFERENCE_MATCHER_VERSION,
      featureFrames,
      createdAt: now(),
    };
    await uploadReference(reference, signal);
    return referenceSummary(reference);
  }

  async function deleteReference(referenceId, { signal } = {}) {
    if (typeof referenceId !== 'string' || !UUID_PATTERN.test(referenceId)) {
      throw new ReferenceLibraryError(400, 'invalid_reference_id', 'Select a valid reference recording.');
    }
    const objectName = `${REFERENCE_OBJECT_PREFIX}${referenceId.toLowerCase()}.json`;
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}`);
    const response = await authorizedFetch(url, { method: 'DELETE', signal, allowMissing: true });
    if (!response) throw new ReferenceLibraryError(404, 'reference_not_found', 'That reference recording is not in the library.');
    return { referenceId: referenceId.toLowerCase(), deleted: true };
  }

  async function compareRecording(request, { signal } = {}) {
    const recording = recordingFields(request, 'comparison');
    const referenceObjects = await listReferenceObjects(signal);
    const referenceSummaries = referenceObjects.map(referenceSummaryFromObject);
    if (referenceSummaries.some(reference => reference.attemptId === recording.attemptId)) {
      throw new ReferenceLibraryError(409, 'reference_cannot_be_tested', 'A reference take cannot also be used as a test recording.');
    }
    const references = await readReferenceFeatureRecords(referenceObjects, signal);
    const wordReferences = references.filter(reference => reference.word === recording.word);
    if (!wordReferences.length) throw new ReferenceLibraryError(409, 'word_has_no_references', `There are no approved reference recordings for “${recording.word}” yet.`);
    const preparedAudio = await prepareAudio({ audioBytes: recording.audioBytes, mimeType: recording.mimeType, durationMs: recording.durationMs, signal });
    if (preparedAudio.preprocessing?.version !== SPEECH_AUDIO_PREPROCESSING_VERSION ||
        preparedAudio.preprocessing.sampleRateHertz !== 16000 || preparedAudio.preprocessing.audioChannelCount !== 1) {
      throw new ReferenceLibraryError(500, 'test_audio_preparation_failed', 'The test recording could not be prepared consistently.');
    }
    const candidateFeatures = extractPreparedFeatures(preparedAudio, 'comparison');
    const rankedWords = rankReferences(candidateFeatures, references.map(reference => ({
      word: reference.word, referenceId: reference.referenceId, featureFrames: reference.featureFrames,
    })));
    const targetPosition = rankedWords.findIndex(result => result.word === recording.word);
    return {
      matcherVersion: REFERENCE_MATCHER_VERSION,
      scoringStatus: 'experimental-uncalibrated',
      attemptId: recording.attemptId,
      targetWord: recording.word,
      closestWord: rankedWords[0]?.word || null,
      targetRank: targetPosition < 0 ? null : targetPosition + 1,
      rankedWords,
      referenceCountForTarget: wordReferences.length,
      preprocessing: preparedAudio.preprocessing,
      audioSha256: recording.audioSha256,
    };
  }

  return Object.freeze({ listReferences, approveReference, deleteReference, compareRecording });
}
