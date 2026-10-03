// Node harness for durable originals and standards-based, byte-for-byte ZIP export.
// No browser or package dependency: node logs/tools/test_asr_recordings.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const recordingStoreScript = readFileSync(new URL('../../asr_recordings.js', import.meta.url), 'utf8');
const sessionId = '10000000-0000-4000-8000-000000000001';
const otherSessionId = '10000000-0000-4000-8000-000000000002';
const attemptId = takeNumber => `20000000-0000-4000-8000-${String(takeNumber).padStart(12, '0')}`;

function recordingSession(overrides = {}) {
  return {
    id: sessionId, schemaVersion: 2, startedAt: '2026-10-03T12:00:00.000Z',
    device: 'Brave Android recording harness', order: ['mat', 'mad', 'café', 'cat'], currentTrialIndex: 0,
    ...overrides,
  };
}

function recordingAttempt(takeNumber, overrides = {}) {
  return {
    id: attemptId(takeNumber), prompt: 'mat', wordIndex: 0, takeNumber,
    startedAt: `2026-10-03T12:00:${String(takeNumber).padStart(2, '0')}.000Z`,
    durationMs: 1300, micLabel: 'Test original microphone', voided: false, modelRuns: [],
    ...overrides,
  };
}

// Transactions commit complete snapshots, serialize across reopened connections,
// and roll back all stores on request failures (including injected quota errors).
class FakeIndexedDB {
  databases = new Map();
  writeFailure = null;
  open(name, version) {
    const request = {};
    queueMicrotask(() => {
      let backing = this.databases.get(name);
      const initialDatabase = !backing;
      if (!backing) {
        backing = { version, stores: new Map(), transactionQueue: [], activeTransaction: null };
        this.databases.set(name, backing);
      }
      request.result = new FakeDatabase(this, backing);
      if (initialDatabase) request.onupgradeneeded?.();
      request.onsuccess?.();
    });
    return request;
  }
  failNextWrite(storeName, failure) { this.writeFailure = { storeName, failure }; }
  removeOriginal(attemptUuid) {
    this.databases.get('asrRecordings.v2').stores.get('originalAudio').records.delete(attemptUuid);
  }
  recordCounts() {
    const backing = this.databases.get('asrRecordings.v2');
    return Object.fromEntries([...backing.stores].map(([name, store]) => [name, store.records.size]));
  }
}

class FakeDatabase {
  constructor(factory, backing) { this.factory = factory; this.backing = backing; }
  createObjectStore(name, { keyPath }) {
    assert.ok(!this.backing.stores.has(name), `Duplicate object store ${name}`);
    const store = { keyPath, indexes: new Map(), records: new Map() };
    this.backing.stores.set(name, store);
    return { createIndex(indexName, indexPath) { store.indexes.set(indexName, indexPath); } };
  }
  transaction(names, mode) {
    const transaction = new FakeTransaction(this, names, mode);
    this.backing.transactionQueue.push(transaction);
    if (!this.backing.activeTransaction) transaction.activate();
    return transaction;
  }
  close() {}
}

class FakeTransaction {
  requests = [];
  finished = false;
  error = null;
  scheduled = false;
  constructor(database, storeNames, mode) {
    this.database = database;
    this.storeNames = storeNames;
    this.mode = mode;
    this.snapshots = new Map();
  }
  activate() {
    this.database.backing.activeTransaction = this;
    for (const name of this.storeNames) {
      const store = this.database.backing.stores.get(name);
      assert.ok(store, `Unknown object store ${name}`);
      this.snapshots.set(name, new Map([...store.records].map(([key, value]) => [key, structuredClone(value)])));
    }
    this.schedule();
  }
  enqueue(operation) {
    assert.equal(this.finished, false, 'A completed transaction cannot receive new requests');
    const request = {};
    this.requests.push({ request, operation });
    this.schedule();
    return request;
  }
  schedule() {
    if (this.scheduled || this.finished || this.database.backing.activeTransaction !== this) return;
    this.scheduled = true;
    queueMicrotask(() => this.drain());
  }
  drain() {
    this.scheduled = false;
    if (this.finished) return;
    const queued = this.requests.shift();
    if (!queued) {
      this.finished = true;
      if (this.mode === 'readwrite') {
        for (const [name, records] of this.snapshots) this.database.backing.stores.get(name).records = records;
      }
      this.oncomplete?.();
      this.release();
      return;
    }
    try {
      queued.request.result = queued.operation();
      queued.request.onsuccess?.();
    } catch (error) {
      queued.request.error = error;
      this.error = error;
      queued.request.onerror?.();
      if (!this.finished) this.abort();
    }
    this.schedule();
  }
  abort() {
    assert.equal(this.finished, false, 'A transaction must not abort twice');
    this.finished = true;
    queueMicrotask(() => { this.onabort?.(); this.release(); });
  }
  release() {
    const backing = this.database.backing;
    assert.equal(backing.activeTransaction, this);
    backing.transactionQueue.shift();
    backing.activeTransaction = null;
    backing.transactionQueue[0]?.activate();
  }
  objectStore(name) {
    assert.ok(this.storeNames.includes(name), `Object store ${name} is outside this transaction`);
    const definition = this.database.backing.stores.get(name);
    const records = () => this.snapshots.get(name);
    const write = operation => {
      assert.equal(this.mode, 'readwrite', 'Writes require a readwrite transaction');
      return this.enqueue(() => {
        const injected = this.database.factory.writeFailure;
        if (injected?.storeName === name) {
          this.database.factory.writeFailure = null;
          throw injected.failure;
        }
        return operation();
      });
    };
    return {
      get: key => this.enqueue(() => structuredClone(records().get(key))),
      getAll: () => this.enqueue(() => [...records().values()].map(value => structuredClone(value))),
      add: value => write(() => {
        const key = value[definition.keyPath];
        if (records().has(key)) throw new DOMException('Recording ID already exists', 'ConstraintError');
        records().set(key, structuredClone(value));
        return key;
      }),
      put: value => write(() => { const key = value[definition.keyPath]; records().set(key, structuredClone(value)); return key; }),
      delete: key => write(() => records().delete(key)),
      index: indexName => ({
        getAll: query => this.enqueue(() => {
          const indexPath = definition.indexes.get(indexName);
          assert.ok(indexPath, `Unknown index ${indexName}`);
          return [...records().values()].filter(value => value[indexPath] === query).map(value => structuredClone(value));
        }),
      }),
    };
  }
}

function loadRecordingStore(indexedDB = new FakeIndexedDB()) {
  const context = vm.createContext({ indexedDB, Blob, structuredClone, TextEncoder, Uint8Array, Uint32Array, DataView });
  vm.runInContext(recordingStoreScript, context, { filename: 'asr_recordings.js', timeout: 1000 });
  return { recordings: context.ASRRecordings, indexedDB };
}

function plainMetadata(metadata) { return JSON.parse(JSON.stringify(metadata)); }

// Independent CRC bit walk and ZIP decoding validate prescribed binary headers,
// rather than importing or exposing the module's ZIP implementation.
function expectedCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
assert.equal(expectedCrc32(Buffer.from('123456789')), 0xcbf43926, 'CRC check must match its published test vector');

async function decodeStoredZip(blob) {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const endOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(endOffset), 0x06054b50, 'ZIP must end with the central-directory footer');
  assert.equal(bytes.readUInt16LE(endOffset + 4), 0); assert.equal(bytes.readUInt16LE(endOffset + 6), 0);
  assert.equal(bytes.readUInt16LE(endOffset + 20), 0, 'ZIP must have no unexpected trailing comment');
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  assert.equal(bytes.readUInt16LE(endOffset + 8), entryCount);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  assert.equal(centralOffset + centralSize, endOffset);
  const files = new Map();
  let offset = centralOffset;
  for (let entry = 0; entry < entryCount; entry++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, 'ZIP central file header must be valid');
    assert.equal(bytes.readUInt16LE(offset + 8), 0x0800, 'ZIP names must be explicitly UTF-8');
    assert.equal(bytes.readUInt16LE(offset + 10), 0, 'ZIP originals must be stored without compression');
    const crc = bytes.readUInt32LE(offset + 16);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const originalSize = bytes.readUInt32LE(offset + 24);
    assert.equal(compressedSize, originalSize);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const filenameBytes = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const filename = filenameBytes.toString('utf8');
    const localOffset = bytes.readUInt32LE(offset + 42);
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50, 'ZIP directory must point to the correct local header');
    assert.equal(bytes.readUInt16LE(localOffset + 6), 0x0800);
    assert.equal(bytes.readUInt16LE(localOffset + 8), 0);
    assert.equal(bytes.readUInt32LE(localOffset + 14), crc);
    assert.equal(bytes.readUInt32LE(localOffset + 18), originalSize);
    assert.equal(bytes.readUInt32LE(localOffset + 22), originalSize);
    assert.equal(bytes.readUInt16LE(localOffset + 26), nameLength);
    const localName = bytes.subarray(localOffset + 30, localOffset + 30 + nameLength);
    assert.deepEqual(localName, filenameBytes);
    const audioOffset = localOffset + 30 + nameLength + bytes.readUInt16LE(localOffset + 28);
    const originalBytes = bytes.subarray(audioOffset, audioOffset + originalSize);
    assert.equal(originalBytes.length, originalSize);
    assert.equal(expectedCrc32(originalBytes), crc, `ZIP CRC must match actual bytes for ${filename}`);
    assert.equal(files.has(filename), false, 'ZIP file names must be unique');
    files.set(filename, originalBytes);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(offset, endOffset, 'ZIP central directory must decode exactly');
  return files;
}

const recordingTests = [
  ['Only real supported MIME types produce audio file extensions', async () => {
    const { recordings } = loadRecordingStore();
    for (const [mime, extension] of [['audio/webm;codecs=opus', 'webm'], ['audio/ogg', 'ogg'], ['audio/mp4', 'm4a'], ['audio/wav', 'wav']]) {
      assert.equal(recordings.audioExtension(mime), extension);
    }
    for (const mime of ['', 'audio/mpeg', 'application/octet-stream']) assert.throws(() => recordings.audioExtension(mime), /unsupported/i);
  }],
  ['Sessions and original audio survive a reopened browser connection', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.open();
    await recordings.createSession(recordingSession());
    const originalBytes = new Uint8Array([0, 255, 17, 3, 128, 0]);
    await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob([originalBytes], { type: 'audio/webm;codecs=opus' }));
    await recordings.saveSession(recordingSession({ currentTrialIndex: 2 }));
    await recordings.createSession(recordingSession({ id: otherSessionId, startedAt: '2026-10-03T13:00:00.000Z' }));
    const reopened = loadRecordingStore(indexedDB).recordings;
    const restored = await reopened.getSession(sessionId);
    assert.equal(restored.session.currentTrialIndex, 2);
    assert.equal(restored.attempts.length, 1);
    assert.deepEqual(new Uint8Array(await restored.attempts[0].audioBlob.arrayBuffer()), originalBytes);
    assert.deepEqual(Array.from(await reopened.listSessions(), session => session.id), [otherSessionId, sessionId]);
    assert.deepEqual(indexedDB.recordCounts(), { sessions: 2, attempts: 1, originalAudio: 1 });
  }],
  ['Empty and unsupported recordings fail without saving partial attempt metadata', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    await assert.rejects(recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob([], { type: 'audio/webm' })), /empty/i);
    await assert.rejects(recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['bad mime'], { type: 'audio/mpeg' })), /unsupported/i);
    await assert.rejects(recordings.saveAttempt(sessionId, recordingAttempt(1), null), /audio blob/i);
    assert.deepEqual(indexedDB.recordCounts(), { sessions: 1, attempts: 0, originalAudio: 0 });
  }],
  ['Metadata updates retain immutable original capture fields and model-run history', async () => {
    const { recordings } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const originalBytes = Buffer.from('123456789');
    const digest = createHash('sha256').update(originalBytes).digest('hex');
    const saved = await recordings.saveAttempt(sessionId, recordingAttempt(1, { audioSha256: digest }), new Blob([originalBytes], { type: 'audio/wav' }));
    const modelRuns = [{ id: 'provider-run-1', provider: 'test provider', model: 'test model', transcript: 'Matt', verdict: 'hit' }];
    await recordings.updateAttempt(sessionId, { ...saved, voided: true, modelRuns });
    const restored = (await recordings.getSession(sessionId)).attempts[0];
    assert.equal(restored.voided, true); assert.deepEqual(plainMetadata(restored.modelRuns), modelRuns);
    assert.equal(restored.audioSha256, digest);
    assert.deepEqual(Buffer.from(await restored.audioBlob.arrayBuffer()), originalBytes);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...restored, prompt: 'mad' }), /prompt cannot change/i);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...restored, takeNumber: 2 }), /takeNumber cannot change/i);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...restored, audioSha256: '0'.repeat(64) }), /audioSha256 cannot change/i);
    assert.equal((await recordings.getSession(sessionId)).attempts[0].voided, true);
  }],
  ['Rerecords retain all originals and derive selection from monotonically increasing take numbers', async () => {
    const { recordings } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    await recordings.saveAttempt(sessionId, recordingAttempt(1, { superseded: false }), new Blob(['first'], { type: 'audio/webm' }));
    await recordings.saveAttempt(sessionId, recordingAttempt(2, { superseded: true, voided: true }), new Blob(['second'], { type: 'audio/ogg' }));
    await recordings.saveAttempt(sessionId, recordingAttempt(3, { prompt: 'mad', wordIndex: 1 }), new Blob(['third'], { type: 'audio/mp4' }));
    const restored = await recordings.getSession(sessionId);
    assert.deepEqual(Array.from(restored.attempts, attempt => attempt.takeNumber), [1, 2, 3]);
    assert.deepEqual(Array.from(restored.attempts, attempt => attempt.superseded), [true, false, false]);
    assert.equal(restored.attempts[1].voided, true, 'Voiding does not silently select an older recording');
    const exported = await recordings.exportSession(sessionId);
    const files = await decodeStoredZip(exported.blob);
    const manifest = JSON.parse(files.get('manifest.json').toString('utf8'));
    assert.deepEqual(manifest.selectedAttemptIds, [attemptId(2), attemptId(3)]);
    assert.equal(manifest.attempts.length, 3);
    assert.equal(files.size, 4, 'ZIP retains every original, including voided and superseded recordings');
    for (let index = 0; index < 3; index++) assert.equal(files.get(manifest.attempts[index].audioFilename).toString(), ['first', 'second', 'third'][index]);
  }],
  ['Duplicate IDs cannot overwrite originals and stale preview numbers do not control saved take order', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['immutable original'], { type: 'audio/webm' }));
    await assert.rejects(recordings.saveAttempt(sessionId, recordingAttempt(2, { id: attemptId(1) }), new Blob(['replacement'], { type: 'audio/webm' })), /already exists/i);
    const second = await recordings.saveAttempt(sessionId, recordingAttempt(3), new Blob(['later original'], { type: 'audio/webm' }));
    assert.equal(second.takeNumber, 2, 'Archive must allocate the next take independently of caller previews');
    const restored = await recordings.getSession(sessionId);
    assert.equal(await restored.attempts[0].audioBlob.text(), 'immutable original');
    assert.deepEqual(indexedDB.recordCounts(), { sessions: 1, attempts: 2, originalAudio: 2 });
  }],
  ['An original-audio quota failure rolls back metadata in the same transaction', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    indexedDB.failNextWrite('originalAudio', new DOMException('Original audio quota exceeded', 'QuotaExceededError'));
    await assert.rejects(recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['recording'], { type: 'audio/webm' })), { name: 'QuotaExceededError' });
    assert.deepEqual(indexedDB.recordCounts(), { sessions: 1, attempts: 0, originalAudio: 0 });
    await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['retry after user handles quota'], { type: 'audio/webm' }));
    assert.equal((await recordings.getSession(sessionId)).attempts.length, 1);
  }],
  ['Missing originals fail on load and metadata update rather than fabricating audio', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const saved = await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['original'], { type: 'audio/webm' }));
    indexedDB.removeOriginal(saved.id);
    await assert.rejects(recordings.getSession(sessionId), /original audio is missing/i);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...saved, voided: true }), /original audio is missing/i);
    await assert.rejects(recordings.exportSession(sessionId), /original audio is missing/i);
  }],
  ['Concurrent tabs keep both originals and receive distinct archive-allocated take numbers', async () => {
    const { recordings } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const concurrent = await Promise.allSettled([
      recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['take A'], { type: 'audio/webm' })),
      recordings.saveAttempt(sessionId, recordingAttempt(1, { id: attemptId(2) }), new Blob(['take B'], { type: 'audio/webm' })),
    ]);
    assert.equal(concurrent.filter(take => take.status === 'fulfilled').length, 2);
    assert.deepEqual(concurrent.map(take => take.value.takeNumber).sort(), [1, 2]);
    const restored = await recordings.getSession(sessionId);
    assert.equal(restored.attempts.length, 2);
    assert.deepEqual(await Promise.all(restored.attempts.map(attempt => attempt.audioBlob.text())), ['take A', 'take B']);
  }],
  ['ZIP manifest, UTF-8 filenames, original bytes, MIME, sizes, and model runs survive export exactly', async () => {
    const { recordings } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const originals = [
      { prompt: 'mat', wordIndex: 0, mime: 'audio/webm;codecs=opus', bytes: Buffer.from([0, 255, 12, 1]) },
      { prompt: 'mad', wordIndex: 1, mime: 'audio/ogg', bytes: Buffer.from('Ogg original untouched') },
      { prompt: 'café', wordIndex: 2, mime: 'audio/mp4', bytes: Buffer.from('MP4 original untouched') },
      { prompt: 'cat', wordIndex: 3, mime: 'audio/wav', bytes: Buffer.from('123456789') },
    ];
    for (const [index, original] of originals.entries()) {
      await recordings.saveAttempt(sessionId, recordingAttempt(index + 1, {
        prompt: original.prompt, wordIndex: original.wordIndex,
        modelRuns: [{ id: 'zip-run-' + index, provider: 'model provider', transcript: index === 0 ? 'Matt' : original.prompt, alternatives: ['kept diagnostic'] }],
      }), new Blob([original.bytes], { type: original.mime }));
    }
    const exported = await recordings.exportSession(sessionId);
    assert.equal(exported.blob.type, 'application/zip');
    assert.equal(exported.filename, `asr-recordings-${sessionId}.zip`);
    const files = await decodeStoredZip(exported.blob);
    const manifestText = files.get('manifest.json').toString('utf8');
    assert.doesNotMatch(manifestText, /audioBlob|audioB64/, 'Manifest must contain recording metadata, not substitute audio encodings');
    const manifest = JSON.parse(manifestText);
    assert.equal(manifest.schemaVersion, 2);
    assert.deepEqual(manifest.session, recordingSession());
    assert.equal(files.size, originals.length + 1);
    for (const [index, original] of originals.entries()) {
      const recorded = manifest.attempts[index];
      assert.equal(recorded.audioMimeType, original.mime);
      assert.equal(recorded.audioByteLength, original.bytes.length);
      assert.equal(recorded.modelRuns[0].provider, 'model provider');
      assert.deepEqual(files.get(recorded.audioFilename), original.bytes);
    }
    assert.match(manifest.attempts[2].audioFilename, /-café\.m4a$/);
  }],
  ['Only explicit session deletion removes its recordings and leaves other sessions intact', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['first session'], { type: 'audio/webm' }));
    await recordings.createSession(recordingSession({ id: otherSessionId }));
    await recordings.saveAttempt(otherSessionId, recordingAttempt(1, { id: attemptId(2) }), new Blob(['other session'], { type: 'audio/ogg' }));
    await recordings.deleteSession(sessionId);
    await assert.rejects(recordings.getSession(sessionId), /session does not exist/i);
    assert.equal(await (await recordings.getSession(otherSessionId)).attempts[0].audioBlob.text(), 'other session');
    assert.deepEqual(indexedDB.recordCounts(), { sessions: 1, attempts: 1, originalAudio: 1 });
  }],
  ['A stale tab cannot remove another tab\'s paid model result while voiding an attempt', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const saved = await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['paid original'], { type: 'audio/webm' }));
    const otherTab = loadRecordingStore(indexedDB).recordings;
    const staleAttempt = (await otherTab.getSession(sessionId)).attempts[0];
    const modelRun = { id: 'paid-run-1', provider: 'google-cloud-stt', transcript: 'Matt', status: 'complete', details: { language: 'en-GB', scores: [0.9, 0.8] } };
    await recordings.updateAttempt(sessionId, { ...saved, modelRuns: [modelRun] });
    await assert.rejects(otherTab.updateAttempt(sessionId, { ...staleAttempt, voided: true }), /reload this session/i);
    const retained = (await recordings.getSession(sessionId)).attempts[0];
    assert.deepEqual(plainMetadata(retained.modelRuns), [modelRun]);
    assert.equal(retained.voided, false, 'Rejected stale updates must not change any recording metadata');
    assert.equal(await retained.audioBlob.text(), 'paid original');
  }],
  ['Saved model history is immutable and duplicate run IDs are rejected', async () => {
    const { recordings } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const saved = await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['original'], { type: 'audio/webm' }));
    const firstRun = { id: 'run-1', transcript: 'Matt', details: { language: 'en-GB', alternatives: ['mat'] } };
    const updated = await recordings.updateAttempt(sessionId, { ...saved, modelRuns: [firstRun] });
    await assert.rejects(recordings.updateAttempt(sessionId, { ...updated, modelRuns: [{ ...firstRun, transcript: 'mad' }] }), /cannot be removed or changed/i);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...updated, modelRuns: [firstRun, { ...firstRun }] }), /only once/i);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...updated, modelRuns: [{ ...firstRun, id: 'different-run-id' }] }), /cannot be removed or changed/i);
    const reorderedProperties = { details: { alternatives: ['mat'], language: 'en-GB' }, transcript: 'Matt', id: 'run-1' };
    const secondRun = { id: 'run-2', transcript: 'mat', status: 'complete' };
    await recordings.updateAttempt(sessionId, { ...updated, voided: true, modelRuns: [reorderedProperties, secondRun] });
    const retained = (await recordings.getSession(sessionId)).attempts[0];
    assert.equal(retained.voided, true);
    assert.deepEqual(plainMetadata(retained.modelRuns), [reorderedProperties, secondRun]);
  }],
  ['Microphone settings and capture interruption metadata remain immutable', async () => {
    const { recordings } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const saved = await recordings.saveAttempt(sessionId, recordingAttempt(1, {
      microphoneSettings: { sampleRate: 48000, channelCount: 1 }, captureError: 'microphone disconnected',
    }), new Blob(['interrupted original'], { type: 'audio/webm' }));
    await recordings.updateAttempt(sessionId, { ...saved, voided: true, microphoneSettings: { channelCount: 1, sampleRate: 48000 } });
    await assert.rejects(recordings.updateAttempt(sessionId, { ...saved, microphoneSettings: { channelCount: 2, sampleRate: 48000 } }), /microphoneSettings cannot change/i);
    await assert.rejects(recordings.updateAttempt(sessionId, { ...saved, captureError: undefined }), /captureError cannot change/i);
    assert.equal((await recordings.getSession(sessionId)).attempts[0].captureError, 'microphone disconnected');
  }],
  ['Atomic model append preserves a concurrent void decision and rejects duplicate result IDs', async () => {
    const { recordings, indexedDB } = loadRecordingStore();
    await recordings.createSession(recordingSession());
    const saved = await recordings.saveAttempt(sessionId, recordingAttempt(1), new Blob(['paid recording'], { type: 'audio/webm' }));
    const otherTab = loadRecordingStore(indexedDB).recordings;
    await otherTab.open();
    const firstRun = { id: 'paid-run-1', transcript: 'Matt', status: 'complete' };
    await Promise.all([
      recordings.updateAttempt(sessionId, { ...saved, voided: true }),
      otherTab.appendModelRun(sessionId, saved.id, firstRun),
    ]);
    const retained = (await recordings.getSession(sessionId)).attempts[0];
    assert.equal(retained.voided, true, 'Model append must preserve the current void decision');
    assert.deepEqual(plainMetadata(retained.modelRuns), [firstRun]);
    assert.equal(await retained.audioBlob.text(), 'paid recording');
    await assert.rejects(recordings.appendModelRun(sessionId, saved.id, firstRun), /only once/i);
    const nextRun = { id: 'paid-run-2', transcript: 'mat', status: 'complete' };
    await recordings.appendModelRun(sessionId, saved.id, nextRun);
    const updated = (await recordings.getSession(sessionId)).attempts[0];
    assert.equal(updated.voided, true);
    assert.deepEqual(plainMetadata(updated.modelRuns), [firstRun, nextRun]);
  }],
];

let failingRecordingTests = 0;
for (const [behavior, verify] of recordingTests) {
  try { await verify(); console.log(`PASS ${behavior}`); }
  catch (error) { failingRecordingTests++; console.error(`FAIL ${behavior}\n${error.stack}`); }
}
console.log(`${recordingTests.length - failingRecordingTests}/${recordingTests.length} durable recording regressions passed`);
if (failingRecordingTests) process.exitCode = 1;
