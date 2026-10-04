import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGoogleCloudReferenceLibrary, ReferenceLibraryError } from '../reference_library.mjs';
import { SPEECH_AUDIO_PREPROCESSING_VERSION } from '../audio_preprocessing.mjs';
import { ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION } from '../reference_matcher.mjs';

const firstAttemptId = '30000000-0000-4000-8000-000000000001';
const secondAttemptId = '30000000-0000-4000-8000-000000000002';
const originalAudio = Buffer.from('parent-approved isolated word audio');
const audioSha256 = createHash('sha256').update(originalAudio).digest('hex');
const preparedWav = Buffer.from('prepared mono wav');
const preprocessing = { version: SPEECH_AUDIO_PREPROCESSING_VERSION, sampleRateHertz: 16000, audioChannelCount: 1,
  inputDurationMs: 900, trimmedLeadingSilenceMs: 100, outputDurationMs: 800 };
const featureFrames = [Array.from({ length: 24 }, (_, index) => index / 10), Array.from({ length: 24 }, (_, index) => index / 20)];

function createStorageFixture({ uploadResponse, reportStorageRejection = () => {} } = {}) {
  const objects = new Map();
  const requests = [];
  const auth = { async getClient() { return { async getAccessToken() { return 'fake-storage-access-token'; } }; } };
  const fetchImplementation = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, options });
    assert.equal(options.headers.Authorization, 'Bearer fake-storage-access-token');
    assert.equal(url.hostname, 'storage.googleapis.com');
    if (url.pathname.includes('/upload/storage/v1/')) {
      if (uploadResponse) return uploadResponse(url, options);
      assert.equal(url.searchParams.get('ifGenerationMatch'), '0');
      const boundary = options.headers['Content-Type'].match(/boundary=([^;]+)/)[1];
      const content = options.body.toString('utf8');
      const firstStart = content.indexOf('\r\n\r\n') + 4;
      const firstEnd = content.indexOf(`\r\n--${boundary}`, firstStart);
      const secondStart = content.indexOf('\r\n\r\n', firstEnd) + 4;
      const secondEnd = content.lastIndexOf(`\r\n--${boundary}--`);
      const objectMetadata = JSON.parse(content.slice(firstStart, firstEnd));
      const reference = JSON.parse(content.slice(secondStart, secondEnd));
      if (objects.has(objectMetadata.name)) return new Response(null, { status: 412 });
      objects.set(objectMetadata.name, { metadata: objectMetadata.metadata, reference, timeCreated: reference.createdAt });
      return Response.json({ name: objectMetadata.name });
    }
    const mediaPath = url.pathname.match(/^\/storage\/v1\/b\/[^/]+\/o\/(.+)$/);
    if (mediaPath && url.searchParams.get('alt') === 'media') {
      const objectName = decodeURIComponent(mediaPath[1]);
      const stored = objects.get(objectName);
      return stored ? Response.json(stored.reference) : new Response(null, { status: 404 });
    }
    if (mediaPath && options.method === 'DELETE') {
      const objectName = decodeURIComponent(mediaPath[1]);
      if (!objects.has(objectName)) return new Response(null, { status: 404 });
      objects.delete(objectName);
      return new Response(null, { status: 204 });
    }
    if (url.pathname === '/storage/v1/b/reading-learner-private/o') {
      const items = [...objects.entries()].filter(([name]) => name.startsWith(url.searchParams.get('prefix'))).map(([name, stored]) => ({
        name, metadata: stored.metadata, timeCreated: stored.timeCreated,
      }));
      return Response.json({ items });
    }
    throw new Error(`Unexpected fake Cloud Storage request: ${options.method || 'GET'} ${url}`);
  };
  const library = createGoogleCloudReferenceLibrary({
    bucketName: 'reading-learner-private', auth, fetchImplementation, reportStorageRejection,
    prepareAudio: async ({ audioBytes, mimeType, durationMs }) => {
      assert.ok(audioBytes.length > 0); assert.equal(mimeType, 'audio/wav'); assert.equal(durationMs, 900);
      return { audioBytes: preparedWav, mimeType: 'audio/wav', preprocessing };
    },
    extractFeatures: bytes => { assert.deepEqual(bytes, preparedWav); return featureFrames; },
    rankReferences: (candidate, references) => {
      assert.deepEqual(candidate, featureFrames);
      return [{ word: 'mat', referenceCount: references.length, averageDistance: 0.2, minimumDistance: 0.1 }];
    },
    now: () => '2026-10-04T10:00:00.000Z',
  });
  return { library, objects, requests };
}

function recording(attemptId, overrides = {}) {
  return { attemptId, mimeType: 'audio/wav', durationMs: 900,
    audioBase64: originalAudio.toString('base64'), ...overrides };
}

test('approved references are private Cloud Storage objects and the list returns metadata only', async () => {
  const { library, objects, requests } = createStorageFixture();
  const saved = await library.approveReference(recording(firstAttemptId, { word: ' Mat ' }));
  assert.equal(saved.word, 'mat');
  assert.equal(saved.referenceId, firstAttemptId);
  assert.equal(saved.preprocessingVersion, SPEECH_AUDIO_PREPROCESSING_VERSION);
  assert.equal(saved.matcherVersion, ISOLATED_WORD_SPEECH_FEATURE_FORMAT_VERSION);
  assert.equal(objects.size, 1);
  const listed = await library.listReferences();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].word, 'mat');
  assert.equal(listed[0].createdAt, '2026-10-04T10:00:00.000Z');
  assert.equal(Object.hasOwn(listed[0], 'audioBase64'), false);
  assert.equal(Object.hasOwn(listed[0], 'featureFrames'), false);
  assert.ok(requests.every(request => request.url.protocol === 'https:'));
  assert.ok(requests.every(request => request.options.headers.Authorization !== 'fake-gateway-token'));
});

test('a separate take is ranked against approved references, and reference takes cannot be tested', async () => {
  const { library } = createStorageFixture();
  await library.approveReference(recording(firstAttemptId, { word: 'mat' }));
  const comparison = await library.compareRecording(recording(secondAttemptId, { expectedWord: 'mat' }));
  assert.equal(comparison.scoringStatus, 'experimental-uncalibrated');
  assert.equal(comparison.attemptId, secondAttemptId);
  assert.equal(comparison.targetWord, 'mat');
  assert.equal(comparison.targetRank, 1);
  assert.equal(comparison.closestWord, 'mat');
  assert.equal(comparison.referenceCountForTarget, 1);
  assert.equal(comparison.audioSha256, audioSha256);
  await assert.rejects(library.compareRecording(recording(firstAttemptId, { expectedWord: 'mat' })), {
    name: 'ReferenceLibraryError', code: 'reference_cannot_be_tested', httpStatus: 409,
  });
});

test('reference approval is unique per take and requires one expected-word label', async () => {
  const { library } = createStorageFixture();
  await library.approveReference(recording(firstAttemptId, { word: 'mat' }));
  await assert.rejects(library.approveReference(recording(firstAttemptId, { word: 'mat' })), {
    name: 'ReferenceLibraryError', code: 'attempt_already_a_reference', httpStatus: 409,
  });
  await assert.rejects(library.approveReference(recording(secondAttemptId, { word: 'mat again' })), {
    name: 'ReferenceLibraryError', code: 'invalid_reference_word', httpStatus: 400,
  });
  await assert.rejects(library.approveReference({ ...recording(secondAttemptId, { word: 'mat' }), childId: 'unexpected' }), {
    name: 'ReferenceLibraryError', code: 'unexpected_reference_fields', httpStatus: 400,
  });
});

test('Cloud Storage rejection reports safe status details without exposing its raw message', async () => {
  const reportedRejections = [];
  const { library } = createStorageFixture({
    uploadResponse: async () => Response.json({ error: {
      status: 'PERMISSION_DENIED', message: 'private bucket and request details',
      errors: [{ reason: 'forbidden', message: 'private object details' }],
    } }, { status: 403 }),
    reportStorageRejection: details => reportedRejections.push(details),
  });
  await assert.rejects(library.approveReference(recording(firstAttemptId, { word: 'do' })), error => {
    assert.equal(error.name, 'ReferenceLibraryError');
    assert.equal(error.code, 'reference_storage_error');
    assert.equal(error.httpStatus, 502);
    assert.equal(error.message, 'Cloud Storage rejected the request (HTTP 403, forbidden).');
    assert.doesNotMatch(error.message, /private bucket|private object/);
    return true;
  });
  assert.deepEqual(reportedRejections, [{
    event: 'reference_storage_request_rejected', method: 'POST', upstreamStatus: 403,
    reason: 'forbidden', status: 'PERMISSION_DENIED',
  }]);
});

test('a confirmed reference can be removed and a missing one reports a clear error', async () => {
  const { library, objects } = createStorageFixture();
  await library.approveReference(recording(firstAttemptId, { word: 'mat' }));
  assert.deepEqual(await library.deleteReference(firstAttemptId), { referenceId: firstAttemptId, deleted: true });
  assert.equal(objects.size, 0);
  assert.deepEqual(await library.listReferences(), []);
  await assert.rejects(library.deleteReference(firstAttemptId), {
    name: 'ReferenceLibraryError', code: 'reference_not_found', httpStatus: 404,
  });
});
