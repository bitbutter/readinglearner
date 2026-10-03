'use strict';

// Original recordings are durable artifacts. Recognition runs only add metadata.
(() => {
  const DATABASE_NAME = 'asrRecordings.v2';
  const DATABASE_VERSION = 1;
  const SESSION_STORE = 'sessions';
  const ATTEMPT_STORE = 'attempts';
  const AUDIO_STORE = 'originalAudio';
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const AUDIO_EXTENSIONS = Object.freeze({
    'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  });
  const CAPTURE_FIELDS = ['id', 'sessionId', 'prompt', 'wordIndex', 'takeNumber', 'startedAt', 'durationMs', 'micLabel', 'microphoneSettings', 'captureError', 'audioSha256'];
  let databaseOpening = null;

  function requireUUID(value, label) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new Error(`${label} must be a stable UUID.`);
  }

  function audioExtension(mimeType) {
    if (typeof mimeType !== 'string') throw new Error('Original audio must specify its MIME type.');
    const baseMimeType = mimeType.split(';', 1)[0].trim().toLowerCase();
    const extension = AUDIO_EXTENSIONS[baseMimeType];
    if (!extension) throw new Error(`Unsupported original audio MIME type: ${mimeType || '(empty)'}.`);
    return extension;
  }

  function audioFilename(attempt, blob) {
    const promptFilename = attempt.prompt.normalize('NFKC').toLowerCase()
      .replace(/[^\p{L}\p{N}-]+/gu, '-').replace(/^-+|-+$/g, '');
    if (!promptFilename) throw new Error('Recording prompt has no filename-safe letters or digits.');
    return `audio/${attempt.id}-${promptFilename}.${audioExtension(blob.type)}`;
  }

  function requireOriginalAudio(blob) {
    if (!(blob instanceof Blob)) throw new Error('An original audio Blob is required for every recording attempt.');
    if (!blob.size) throw new Error('Original audio is empty; the recording attempt was not saved.');
    audioExtension(blob.type);
  }

  function stableModelRunJson(value, ancestors = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      return JSON.stringify(value);
    }
    if (!value || typeof value !== 'object' || (!Array.isArray(value) && Object.prototype.toString.call(value) !== '[object Object]')) {
      throw new Error('Model run metadata must contain JSON values only.');
    }
    if (ancestors.has(value)) throw new Error('Model run metadata cannot contain circular references.');
    ancestors.add(value);
    const serialized = Array.isArray(value)
      ? '[' + value.map(entry => stableModelRunJson(entry, ancestors)).join(',') + ']'
      : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableModelRunJson(value[key], ancestors)).join(',') + '}';
    ancestors.delete(value);
    return serialized;
  }

  function requireModelRunHistory(modelRuns) {
    const runIds = new Set();
    for (const run of modelRuns) {
      if (!run || typeof run.id !== 'string' || !run.id) throw new Error('Each model run must have a stable ID.');
      if (runIds.has(run.id)) throw new Error('Each model run ID may appear only once in the saved history.');
      runIds.add(run.id);
      stableModelRunJson(run);
    }
  }

  function requirePreservedModelRuns(previousRuns, updatedRuns) {
    if (updatedRuns.length < previousRuns.length || previousRuns.some((run, index) => stableModelRunJson(run) !== stableModelRunJson(updatedRuns[index]))) {
      throw new Error('Saved model result history is newer or different. Reload this session before saving; existing model runs cannot be removed or changed.');
    }
  }

  function sessionMetadata(session) {
    if (!session || typeof session !== 'object') throw new Error('Recording session metadata is required.');
    requireUUID(session.id, 'Recording session ID');
    if (session.schemaVersion !== 2) throw new Error('Recording session schemaVersion must be 2.');
    if (!Array.isArray(session.order) || !session.order.length || session.order.some(word => typeof word !== 'string' || !word)) {
      throw new Error('Recording session order must contain its word prompts.');
    }
    if (!Number.isInteger(session.currentTrialIndex) || session.currentTrialIndex < 0 || session.currentTrialIndex > session.order.length) {
      throw new Error('Recording session currentTrialIndex must identify a word or the completed session.');
    }
    if (typeof session.startedAt !== 'string' || !Number.isFinite(Date.parse(session.startedAt))) {
      throw new Error('Recording session startedAt must be a valid timestamp.');
    }
    return structuredClone(session);
  }

  function attemptMetadata(sessionId, attempt, allocatingTakeNumber = false) {
    requireUUID(sessionId, 'Recording session ID');
    if (!attempt || typeof attempt !== 'object') throw new Error('Recording attempt metadata is required.');
    requireUUID(attempt.id, 'Recording attempt ID');
    if (attempt.sessionId !== undefined && attempt.sessionId !== sessionId) throw new Error('Recording attempt belongs to a different session.');
    if (typeof attempt.prompt !== 'string' || !attempt.prompt) throw new Error('Recording attempt prompt is required.');
    if (!Number.isInteger(attempt.wordIndex) || attempt.wordIndex < 0) throw new Error('Recording attempt wordIndex must identify its prompt.');
    if (!(allocatingTakeNumber && attempt.takeNumber === undefined) && (!Number.isInteger(attempt.takeNumber) || attempt.takeNumber < 1)) {
      throw new Error('Recording attempt takeNumber must be a positive integer.');
    }
    if (typeof attempt.startedAt !== 'string' || !Number.isFinite(Date.parse(attempt.startedAt))) throw new Error('Recording attempt startedAt must be a valid timestamp.');
    if (!Number.isFinite(attempt.durationMs) || attempt.durationMs < 0) throw new Error('Recording attempt durationMs must be a nonnegative duration in milliseconds.');
    if (typeof attempt.micLabel !== 'string') throw new Error('Recording attempt micLabel is required.');
    if (typeof attempt.voided !== 'boolean') throw new Error('Recording attempt voided flag must be a boolean.');
    if (!Array.isArray(attempt.modelRuns)) throw new Error('Recording attempt modelRuns must be an array.');
    requireModelRunHistory(attempt.modelRuns);
    if (attempt.audioSha256 !== undefined && !/^[0-9a-f]{64}$/.test(attempt.audioSha256)) throw new Error('Recording attempt audioSha256 must be a lowercase SHA-256 hex digest.');
    const metadata = { ...attempt, sessionId };
    delete metadata.audioBlob;
    delete metadata.superseded;
    return structuredClone(metadata);
  }

  function withOriginalAudioMetadata(attempt, blob) {
    requireOriginalAudio(blob);
    return {
      ...attempt, audioMimeType: blob.type, audioByteLength: blob.size,
      audioFilename: audioFilename(attempt, blob),
    };
  }

  function open() {
    if (databaseOpening) return databaseOpening;
    databaseOpening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error('IndexedDB is unavailable; original recordings cannot be saved in this browser.'));
        return;
      }
      const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let openingBlocked = false;
      opening.onupgradeneeded = () => {
        const database = opening.result;
        database.createObjectStore(SESSION_STORE, { keyPath: 'id' });
        const attempts = database.createObjectStore(ATTEMPT_STORE, { keyPath: 'id' });
        attempts.createIndex('sessionId', 'sessionId', { unique: false });
        database.createObjectStore(AUDIO_STORE, { keyPath: 'attemptId' });
      };
      opening.onerror = () => reject(opening.error || new Error('Opening original recording storage failed.'));
      opening.onblocked = () => {
        openingBlocked = true;
        reject(new Error('Opening recording storage is blocked by another tab. Close the other recording tabs and reload.'));
      };
      opening.onsuccess = () => {
        const database = opening.result;
        if (openingBlocked) { database.close(); return; }
        database.onversionchange = () => { database.close(); databaseOpening = null; };
        resolve(database);
      };
    });
    return databaseOpening;
  }

  async function transact(storeNames, mode, operation) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(storeNames, mode);
      let completedValue;
      let explicitFailure = null;
      const fail = error => { explicitFailure = error; transaction.abort(); };
      const remember = value => { completedValue = value; };
      transaction.oncomplete = () => resolve(completedValue);
      transaction.onabort = () => reject(explicitFailure || transaction.error || new Error('Original recording storage transaction was aborted.'));
      try { operation(transaction, remember, fail); }
      catch (error) { fail(error); }
    });
  }

  function afterRead(request, callback, fail) {
    request.onsuccess = () => {
      try { callback(request.result); }
      catch (error) { fail(error); }
    };
  }

  async function listSessions() {
    return transact([SESSION_STORE], 'readonly', (transaction, remember, fail) => {
      afterRead(transaction.objectStore(SESSION_STORE).getAll(), sessions => {
        remember(sessions.sort((left, right) => right.startedAt.localeCompare(left.startedAt)));
      }, fail);
    });
  }

  async function createSession(session) {
    const metadata = sessionMetadata(session);
    return transact([SESSION_STORE], 'readwrite', (transaction, remember) => {
      transaction.objectStore(SESSION_STORE).add(metadata);
      remember(metadata);
    });
  }

  async function saveSession(session) {
    const metadata = sessionMetadata(session);
    return transact([SESSION_STORE], 'readwrite', (transaction, remember, fail) => {
      const sessions = transaction.objectStore(SESSION_STORE);
      afterRead(sessions.get(metadata.id), previousSession => {
        if (!previousSession) throw new Error(`Recording session does not exist: ${metadata.id}.`);
        sessions.put(metadata);
        remember(metadata);
      }, fail);
    });
  }

  async function saveAttempt(sessionId, attempt, originalAudio) {
    const metadata = withOriginalAudioMetadata(attemptMetadata(sessionId, attempt, true), originalAudio);
    return transact([SESSION_STORE, ATTEMPT_STORE, AUDIO_STORE], 'readwrite', (transaction, remember, fail) => {
      afterRead(transaction.objectStore(SESSION_STORE).get(sessionId), session => {
        if (!session) throw new Error(`Recording session does not exist: ${sessionId}.`);
        if (session.order[metadata.wordIndex] !== metadata.prompt) throw new Error('Recording attempt prompt does not match its session wordIndex.');
        const attempts = transaction.objectStore(ATTEMPT_STORE);
        afterRead(attempts.index('sessionId').getAll(sessionId), existingAttempts => {
          // The archive owns the order. Another tab may have saved since capture began.
          const savedMetadata = { ...metadata, takeNumber: existingAttempts.length + 1 };
          attempts.add(savedMetadata);
          transaction.objectStore(AUDIO_STORE).add({ attemptId: savedMetadata.id, audioBlob: originalAudio });
          remember(savedMetadata);
        }, fail);
      }, fail);
    });
  }

  async function updateAttempt(sessionId, attempt) {
    const metadata = attemptMetadata(sessionId, attempt);
    return transact([SESSION_STORE, ATTEMPT_STORE, AUDIO_STORE], 'readwrite', (transaction, remember, fail) => {
      const attempts = transaction.objectStore(ATTEMPT_STORE);
      afterRead(transaction.objectStore(SESSION_STORE).get(sessionId), session => {
        if (!session) throw new Error(`Recording session does not exist: ${sessionId}.`);
        afterRead(attempts.get(metadata.id), previousAttempt => {
          if (!previousAttempt || previousAttempt.sessionId !== sessionId) throw new Error(`Recording attempt does not exist in this session: ${metadata.id}.`);
          requirePreservedModelRuns(previousAttempt.modelRuns, metadata.modelRuns);
          for (const field of CAPTURE_FIELDS) {
            const previousValue = previousAttempt[field], updatedValue = metadata[field];
            const identical = Object.is(previousValue, updatedValue) ||
              (previousValue !== undefined && updatedValue !== undefined && stableModelRunJson(previousValue) === stableModelRunJson(updatedValue));
            if (!identical) throw new Error(`Original recording ${field} cannot change when updating attempt metadata.`);
          }
          afterRead(transaction.objectStore(AUDIO_STORE).get(metadata.id), original => {
            if (!original?.audioBlob) throw new Error(`Original audio is missing for recording attempt: ${metadata.id}.`);
            const updatedAttempt = withOriginalAudioMetadata(metadata, original.audioBlob);
            attempts.put(updatedAttempt);
            remember(updatedAttempt);
          }, fail);
        }, fail);
      }, fail);
    });
  }

  async function appendModelRun(sessionId, attemptId, modelRun) {
    requireUUID(sessionId, 'Recording session ID');
    requireUUID(attemptId, 'Recording attempt ID');
    requireModelRunHistory([modelRun]);
    const savedRun = structuredClone(modelRun);
    return transact([SESSION_STORE, ATTEMPT_STORE, AUDIO_STORE], 'readwrite', (transaction, remember, fail) => {
      const attempts = transaction.objectStore(ATTEMPT_STORE);
      afterRead(transaction.objectStore(SESSION_STORE).get(sessionId), session => {
        if (!session) throw new Error(`Recording session does not exist: ${sessionId}.`);
        afterRead(attempts.get(attemptId), currentAttempt => {
          if (!currentAttempt || currentAttempt.sessionId !== sessionId) throw new Error(`Recording attempt does not exist in this session: ${attemptId}.`);
          if (currentAttempt.modelRuns.some(run => run.id === savedRun.id)) throw new Error('Each model run ID may appear only once in the saved history.');
          afterRead(transaction.objectStore(AUDIO_STORE).get(attemptId), original => {
            if (!original?.audioBlob) throw new Error(`Original audio is missing for recording attempt: ${attemptId}.`);
            const updatedAttempt = withOriginalAudioMetadata({ ...currentAttempt, modelRuns: [...currentAttempt.modelRuns, savedRun] }, original.audioBlob);
            attempts.put(updatedAttempt);
            remember(updatedAttempt);
          }, fail);
        }, fail);
      }, fail);
    });
  }

  async function getSession(sessionId) {
    requireUUID(sessionId, 'Recording session ID');
    return transact([SESSION_STORE, ATTEMPT_STORE, AUDIO_STORE], 'readonly', (transaction, remember, fail) => {
      afterRead(transaction.objectStore(SESSION_STORE).get(sessionId), session => {
        if (!session) throw new Error(`Recording session does not exist: ${sessionId}.`);
        afterRead(transaction.objectStore(ATTEMPT_STORE).index('sessionId').getAll(sessionId), attempts => {
          attempts.sort((left, right) => left.takeNumber - right.takeNumber);
          const selectedAttempts = new Map();
          for (const attempt of attempts) selectedAttempts.set(attempt.wordIndex, attempt.id);
          const restored = { session, attempts };
          for (const attempt of attempts) {
            attempt.superseded = selectedAttempts.get(attempt.wordIndex) !== attempt.id;
            afterRead(transaction.objectStore(AUDIO_STORE).get(attempt.id), original => {
              if (!original?.audioBlob) throw new Error(`Original audio is missing for recording attempt: ${attempt.id}.`);
              requireOriginalAudio(original.audioBlob);
              if (attempt.audioMimeType !== original.audioBlob.type || attempt.audioByteLength !== original.audioBlob.size) {
                throw new Error(`Original audio does not match its saved MIME/size metadata: ${attempt.id}.`);
              }
              attempt.audioBlob = original.audioBlob;
            }, fail);
          }
          remember(restored);
        }, fail);
      }, fail);
    });
  }

  async function deleteSession(sessionId) {
    requireUUID(sessionId, 'Recording session ID');
    return transact([SESSION_STORE, ATTEMPT_STORE, AUDIO_STORE], 'readwrite', (transaction, remember, fail) => {
      afterRead(transaction.objectStore(SESSION_STORE).get(sessionId), session => {
        if (!session) throw new Error(`Recording session does not exist: ${sessionId}.`);
        afterRead(transaction.objectStore(ATTEMPT_STORE).index('sessionId').getAll(sessionId), attempts => {
          for (const attempt of attempts) {
            transaction.objectStore(ATTEMPT_STORE).delete(attempt.id);
            transaction.objectStore(AUDIO_STORE).delete(attempt.id);
          }
          transaction.objectStore(SESSION_STORE).delete(sessionId);
          remember(undefined);
        }, fail);
      }, fail);
    });
  }

  const crc32Table = Uint32Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });

  function crc32(bytes) {
    let checksum = 0xffffffff;
    for (const byte of bytes) checksum = crc32Table[(checksum ^ byte) & 255] ^ (checksum >>> 8);
    return (checksum ^ 0xffffffff) >>> 0;
  }

  function zipTimestamp(timestamp) {
    const date = new Date(timestamp);
    const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
    return {
      time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
    };
  }

  function createZip(entries, timestamp) {
    if (entries.length > 65535) throw new Error('Too many original audio files for a standard ZIP archive.');
    const encoder = new TextEncoder();
    const modified = zipTimestamp(timestamp);
    const localChunks = [];
    const centralChunks = [];
    let localByteLength = 0;
    let centralByteLength = 0;
    for (const entry of entries) {
      const filenameBytes = encoder.encode(entry.filename);
      const bytes = entry.bytes;
      if (filenameBytes.length > 65535 || bytes.length > 0xffffffff) throw new Error('An original audio file exceeds standard ZIP limits.');
      const checksum = crc32(bytes);
      const localHeader = new Uint8Array(30);
      const local = new DataView(localHeader.buffer);
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 filenames, stored bytes.
      local.setUint16(10, modified.time, true); local.setUint16(12, modified.date, true);
      local.setUint32(14, checksum, true);
      local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true);
      local.setUint16(26, filenameBytes.length, true);
      localChunks.push(localHeader, filenameBytes, bytes);

      const centralHeader = new Uint8Array(46);
      const central = new DataView(centralHeader.buffer);
      central.setUint32(0, 0x02014b50, true);
      central.setUint16(4, 20, true); central.setUint16(6, 20, true); central.setUint16(8, 0x0800, true);
      central.setUint16(12, modified.time, true); central.setUint16(14, modified.date, true);
      central.setUint32(16, checksum, true);
      central.setUint32(20, bytes.length, true); central.setUint32(24, bytes.length, true);
      central.setUint16(28, filenameBytes.length, true); central.setUint32(42, localByteLength, true);
      centralChunks.push(centralHeader, filenameBytes);
      localByteLength += localHeader.length + filenameBytes.length + bytes.length;
      centralByteLength += centralHeader.length + filenameBytes.length;
      if (localByteLength + centralByteLength > 0xffffffff) throw new Error('Original recordings exceed standard ZIP archive size limits.');
    }
    const endHeader = new Uint8Array(22);
    const end = new DataView(endHeader.buffer);
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, centralByteLength, true); end.setUint32(16, localByteLength, true);
    return new Blob([...localChunks, ...centralChunks, endHeader], { type: 'application/zip' });
  }

  async function exportSession(sessionId) {
    const restored = await getSession(sessionId);
    const manifestAttempts = [];
    const audioEntries = [];
    for (const restoredAttempt of restored.attempts) {
      const { audioBlob, ...metadata } = restoredAttempt;
      const manifestAttempt = withOriginalAudioMetadata(metadata, audioBlob);
      manifestAttempts.push(manifestAttempt);
      audioEntries.push({ filename: manifestAttempt.audioFilename, bytes: new Uint8Array(await audioBlob.arrayBuffer()) });
    }
    const selectedAttemptIds = manifestAttempts.filter(attempt => !attempt.superseded)
      .sort((left, right) => left.wordIndex - right.wordIndex).map(attempt => attempt.id);
    const manifest = { schemaVersion: 2, session: restored.session, selectedAttemptIds, attempts: manifestAttempts };
    const entries = [{ filename: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, ...audioEntries];
    return {
      blob: createZip(entries, restored.session.startedAt), filename: `asr-recordings-${sessionId}.zip`,
    };
  }

  globalThis.ASRRecordings = Object.freeze({
    open, listSessions, createSession, saveSession, saveAttempt, updateAttempt, appendModelRun, getSession, deleteSession, exportSession, audioExtension,
  });
})();
