// Exercises the real page script with deterministic browser events, without packages.
// Run from any directory: node logs/tools/test_asr_eval.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash, randomUUID, webcrypto } from 'node:crypto';

const pageHtml = readFileSync(new URL('../../asr_eval.html', import.meta.url), 'utf8');
const pageScript = readFileSync(new URL('../../asr_eval.js', import.meta.url), 'utf8');
const minimumSpeechBatchRequestGapMs = 3200;
assert.match(pageHtml, /src="asr_eval\.js"/, 'HTML must load the tested evaluator script');
const appScript = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');

function extractAppSection(startMarker, endMarker) {
  const sectionStart = appScript.indexOf(startMarker);
  const sectionEnd = appScript.indexOf(endMarker, sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart, `App test section markers missing: ${startMarker} / ${endMarker}`);
  return appScript.slice(sectionStart, sectionEnd);
}

// Keep restoration and matching real; omit unrelated app UI/audio startup.
const appWordRestorationScript = [
  extractAppSection('const NUMBERS_CONTENT = [', 'const PRAISE = ['),
  extractAppSection('const STORAGE_KEY = ', '// SPEECH SYNTHESIS'),
  extractAppSection('function normText(s)', '// Single mutation path for accepted terms'),
].join('\n');

function createAppWordRestoration() {
  const savedProgress = new Map();
  const document = { body: { innerHTML: '' } };
  const context = vm.createContext({
    window: {}, document, console,
    localStorage: {
      getItem: key => savedProgress.get(key) ?? null,
      setItem: (key, value) => savedProgress.set(key, value),
    },
  });
  vm.runInContext(appWordRestorationScript, context, { filename: 'app.js word restoration and matching', timeout: 1000 });
  const appSnapshot = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, context));
  return {
    canonicalMat: () => appSnapshot("WORDS_CONTENT.find(word => word.id === 'word:mat')"),
    freshProgress: () => appSnapshot('freshState()'),
    restore(progress) {
      if (progress) savedProgress.set('readingLearner.v1', JSON.stringify(progress));
      vm.runInContext('loadStored()', context, { timeout: 1000 });
      assert.equal(document.body.innerHTML, '', 'Real app restoration must not report a storage error');
      assert.ok(vm.runInContext('stored !== null', context), 'Real app restoration must populate saved progress');
      return appSnapshot('stored');
    },
    save() { vm.runInContext('saveStored()', context); },
    matchMat(transcript) {
      context.recognizedMatTranscript = transcript;
      return vm.runInContext("matchAnswer([recognizedMatTranscript], stored.items['word:mat'])", context);
    },
  };
}

function existingChildProgress(app, { acceptedPruned = true } = {}) {
  const progress = app.freshProgress();
  progress.acceptedPruned = acceptedPruned;
  progress.cvcLevels = true;
  progress.forwardLevels = true;
  progress.rulesHeard = { 'letter-a': '2026-10-03T10:00:00.000Z' };
  progress.settings.wordLevel = 4;
  progress.settings.numberLevel = 3;
  progress.rounds = [{ round: 7, words: ['word:mat'], correct: 8, attempts: 10 }];
  Object.assign(progress.items['word:mat'], {
    accepted: ['mat'], successStreak: 4, unaidedStreak: 3, silentCorrect: 5,
    totalCorrect: 17, totalAttempts: 23, decoded: true, mastered: true, flawless: true,
    lastSeenRound: 7, lastRecapRound: 6, lastResult: 'correct', auditionConfs: [0.91],
  });
  return progress;
}

function progressWithoutMatSpellings(progress) {
  const progressSnapshot = structuredClone(progress);
  delete progressSnapshot.items['word:mat'].accepted;
  return progressSnapshot;
}

function exerciseAppNoTranscript({ heldMilliseconds, awaitingResult = false }) {
  const currentWord = {
    id: 'word:mat', display: 'mat', totalCorrect: 17, totalAttempts: 23,
    successStreak: 4, unaidedStreak: 3, decoded: true, mastered: true, flawless: true,
  };
  const originalWordProgress = structuredClone(currentWord);
  const acceptedAnswers = [];
  const displayedTranscripts = [];
  const microphoneStatuses = [];
  const spokenRetries = [];
  const context = vm.createContext({
    gs: { currentItem: currentWord, awaitingResult },
    micHoldStart: 10000 - heldMilliseconds, Date: { now: () => 10000 },
    DBG() {},
    handleAnswer: correct => acceptedAnswers.push(correct),
    setHeardDisplay: transcript => displayedTranscripts.push(transcript),
    setMicState: status => microphoneStatuses.push(status),
    speak: text => spokenRetries.push(text),
  });
  vm.runInContext(extractAppSection('function handleNoTranscript()', 'function normText(s)'), context,
    { filename: 'app.js empty recognition attempt', timeout: 1000 });
  vm.runInContext('handleNoTranscript()', context, { timeout: 1000 });
  return { currentWord, originalWordProgress, acceptedAnswers, displayedTranscripts, microphoneStatuses, spokenRetries };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

class BrowserEvents {
  listeners = new Map();
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || [];
    callbacks.push(callback); this.listeners.set(type, callbacks);
  }
  dispatch(type, fields = {}) {
    const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...fields };
    return (this.listeners.get(type) || []).map(callback => callback(event));
  }
}

class PageElement extends BrowserEvents {
  constructor(tagName, downloadedLinks) {
    super(); this.tagName = tagName.toUpperCase(); this.children = []; this.style = {};
    this.className = ''; this.disabled = false; this.hidden = false; this.value = '';
    this.downloadedLinks = downloadedLinks; this._textContent = ''; this._innerHTML = ''; this.htmlWrites = [];
  }
  get textContent() { return this._textContent + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._textContent = String(value); this._innerHTML = ''; this.children = []; }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(value) { this.htmlWrites.push(String(value)); this._innerHTML = String(value); this._textContent = ''; this.children = []; }
  get classList() {
    return {
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, enabled) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        const add = enabled === undefined ? !classes.has(name) : enabled;
        if (add) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(' '); return add;
      },
    };
  }
  appendChild(child) { this.children.push(child); child.parentElement = this; return child; }
  replaceChildren(...children) { this._textContent = ''; this._innerHTML = ''; this.children = []; children.forEach(child => this.appendChild(child)); }
  setAttribute(name, value) { this[name] = String(value); }
  setPointerCapture(pointerId) { this.capturedPointerId = pointerId; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  click() {
    if (this.disabled) return [];
    if (this.tagName === 'A' && this.download) this.downloadedLinks.push(this);
    return this.dispatch('click');
  }
}

const existingSessionId = '10000000-0000-4000-8000-000000000001';
function archiveSession() {
  return { id: existingSessionId, schemaVersion: 2, startedAt: '2026-10-03T10:00:00.000Z',
    device: 'Brave Android test browser', order: ['mat', 'mad', 'cat', 'cut'], currentTrialIndex: 0 };
}

class RecordingArchive {
  constructor() {
    this.sessions = new Map([[existingSessionId, archiveSession()]]); this.attempts = new Map();
    this.audioSaves = 0; this.modelSaves = 0; this.failAudioSaves = 0; this.failModelSaves = 0;
    this.saveGate = null; this.lastManifest = null;
  }
  async open() {}
  async listSessions() { return [...this.sessions.values()].map(session => structuredClone(session)).reverse(); }
  async createSession(session) { this.sessions.set(session.id, structuredClone(session)); return structuredClone(session); }
  async saveSession(session) { this.sessions.set(session.id, structuredClone(session)); return structuredClone(session); }
  audioExtension(mime) {
    const extension = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/wav': 'wav' }[mime.split(';')[0]];
    if (!extension) throw new Error('Unsupported original audio MIME type: ' + mime);
    return extension;
  }
  async saveAttempt(sessionId, attempt, audioBlob) {
    this.audioSaves++;
    if (this.saveGate) await this.saveGate.promise;
    if (this.failAudioSaves > 0) { this.failAudioSaves--; throw new Error('Original audio quota exceeded'); }
    if (!audioBlob.size) throw new Error('Empty recording');
    if (this.attempts.has(attempt.id)) throw new Error('Attempt already saved');
    const saved = { ...structuredClone(attempt), sessionId, takeNumber: [...this.attempts.values()].filter(saved => saved.sessionId === sessionId).length + 1, audioMimeType: audioBlob.type, audioByteLength: audioBlob.size,
      audioFilename: 'audio/' + attempt.id + '-' + attempt.prompt + '.' + this.audioExtension(audioBlob.type) };
    this.attempts.set(attempt.id, { ...saved, audioBlob });
    return structuredClone(saved);
  }
  async updateAttempt(sessionId, attempt) {
    this.modelSaves++;
    if (this.failModelSaves > 0) { this.failModelSaves--; throw new Error('Model result quota exceeded'); }
    const original = this.attempts.get(attempt.id);
    assert.ok(original?.audioBlob, 'Metadata updates require the original recording');
    const { audioBlob, ...metadata } = attempt;
    this.attempts.set(attempt.id, { ...structuredClone(metadata), audioBlob: original.audioBlob });
    return structuredClone(metadata);
  }
  async appendModelRun(sessionId, attemptId, modelRun) {
    const current = this.attempts.get(attemptId);
    if (current.modelRuns.some(run => run.id === modelRun.id)) throw new Error('Duplicate model run ID');
    return this.updateAttempt(sessionId, { ...current, modelRuns: [...current.modelRuns, modelRun] });
  }
  async getSession(sessionId) {
    const attempts = [...this.attempts.values()].filter(attempt => attempt.sessionId === sessionId).sort((left, right) => left.takeNumber - right.takeNumber);
    const selected = new Map(attempts.map(attempt => [attempt.wordIndex, attempt.id]));
    return { session: structuredClone(this.sessions.get(sessionId)),
      attempts: attempts.map(attempt => ({ ...structuredClone(attempt), superseded: selected.get(attempt.wordIndex) !== attempt.id })) };
  }
  async exportSession(sessionId) {
    const restored = await this.getSession(sessionId);
    this.lastManifest = { schemaVersion: 2, session: restored.session,
      attempts: restored.attempts.map(({ audioBlob, ...metadata }) => metadata) };
    return { blob: new Blob([JSON.stringify(this.lastManifest)], { type: 'application/zip' }), filename: 'test-original-recordings.zip' };
  }
}

async function flushBrowserPromises() {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  await new Promise(resolve => setImmediate(resolve));
}

function createPage({ archive = new RecordingArchive(), manualRecorderDelivery = false, responseFactory, recorderBytes = Buffer.from([0, 255, 17, 128, 1]), audioEncodingDelaysMs = [] } = {}) {
  const downloadedLinks = [], elements = new Map(), blobUrls = new Map(), recorders = [], fetchRequests = [];
  const remainingAudioEncodingDelaysMs = [...audioEncodingDelaysMs];
  for (const match of pageHtml.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
    const element = new PageElement(match[1], downloadedLinks);
    element.id = match[3]; element.disabled = /\bdisabled\b/.test(match[2]); element.hidden = /\bhidden\b/.test(match[2]);
    elements.set(element.id, element);
  }
  const document = new BrowserEvents();
  document.body = new PageElement('body', downloadedLinks);
  document.getElementById = id => { assert.ok(elements.has(id), 'Missing DOM element ' + id); return elements.get(id); };
  document.createElement = tag => new PageElement(tag, downloadedLinks);
  elements.get('recognition-mode').value = 'record-only';
  elements.get('summary').style.display = 'none';
  const browserWindow = new BrowserEvents();
  let microphoneRequests = 0, microphoneStops = 0, recorderStarts = 0;
  const track = new BrowserEvents();
  Object.assign(track, { label: 'Test default microphone', stop() { microphoneStops++; }, getSettings: () => ({ sampleRate: 48000, channelCount: 1 }) });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const navigator = { userAgent: 'Brave Android test browser', brave: { isBrave: async () => true },
    mediaDevices: { async getUserMedia() { microphoneRequests++; return stream; } },
    storage: { async persist() { return true; } } };
  class AudioContext {
    state = 'running';
    async resume() { this.state = 'running'; }
    createAnalyser() { return { fftSize: 512, getByteTimeDomainData(buffer) { buffer.fill(132); } }; }
    createMediaStreamSource() { return { connect() {} }; }
  }
  class MediaRecorder {
    state = 'inactive';
    // A native unconstrained recorder has no MIME selection before start.
    mimeType = '';
    constructor(stream, options = {}) { this.mimeType = options.mimeType || ''; recorders.push(this); }
    static isTypeSupported(mimeType) { return mimeType === 'audio/webm;codecs=opus'; }
    start() {
      recorderStarts++; this.state = 'recording';
      queueMicrotask(() => { this.mimeType = 'audio/webm;codecs=opus'; this.onstart?.(); });
    }
    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive'; this.mimeType = '';
      if (!manualRecorderDelivery) queueMicrotask(() => this.deliverStoppedAudio());
    }
    deliverStoppedAudio() {
      if (this.delivered) return;
      this.delivered = true;
      this.ondataavailable?.({ data: new Blob([recorderBytes], { type: 'audio/webm;codecs=opus' }) });
      this.onstop?.();
    }
  }
  class FileReader {
    readAsDataURL(blob) {
      clockMilliseconds += remainingAudioEncodingDelaysMs.shift() || 0;
      blob.arrayBuffer().then(bytes => {
        this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64');
        this.onload?.();
      }).catch(error => { this.error = error; this.onerror?.(); });
    }
  }
  const storedValues = new Map();
  let clockMilliseconds = Date.parse('2026-10-03T10:00:00.000Z'), nextTimerId = 0;
  let fastForwardSpeechBatchTimers = false;
  const timers = new Map();
  class BrowserDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clockMilliseconds])); }
    static now() { return clockMilliseconds; }
  }
  class BrowserURL extends URL {
    static createObjectURL(blob) { const url = 'blob:test-' + blobUrls.size; blobUrls.set(url, blob); return url; }
    static revokeObjectURL() {}
  }
  Object.assign(browserWindow, { AudioContext, MediaRecorder, isSecureContext: true });
  for (const name of ['SpeechRecognition', 'webkitSpeechRecognition']) {
    Object.defineProperty(browserWindow, name, { get() { throw new Error('Recording must not access the browser speech constructor'); } });
  }
  const context = vm.createContext({
    window: browserWindow, document, navigator, Blob, FileReader, MediaRecorder, Uint8Array, Date: BrowserDate,
    URL: BrowserURL, ASRRecordings: archive, crypto: { randomUUID, subtle: webcrypto.subtle }, AbortSignal,
    structuredClone, location: { protocol: 'https:', reload() {} }, console,
    localStorage: { getItem: key => storedValues.get(key) ?? null, setItem: (key, value) => storedValues.set(key, value), removeItem: key => storedValues.delete(key) },
    speechSynthesis: { cancel() {}, speak() {} }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    requestAnimationFrame() { return 1; }, cancelAnimationFrame() {},
    setTimeout(callback, delay = 0) {
      const id = ++nextTimerId;
      if (fastForwardSpeechBatchTimers && (delay === minimumSpeechBatchRequestGapMs || (delay > 10_000 && delay < 60_000))) {
        clockMilliseconds += delay;
        queueMicrotask(callback);
      } else timers.set(id, { callback, due: clockMilliseconds + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    async fetch(endpoint, options) {
      const request = { endpoint, options, body: JSON.parse(options.body), submittedAt: clockMilliseconds }; fetchRequests.push(request);
      const originalBytes = Buffer.from(request.body.audioBase64, 'base64');
      const transcription = { transcript: 'Matt', provider: 'google-cloud-stt', model: request.body.model,
        languageCode: 'en-GB', configurationVersion: ({ chirp_3: 'recorded-word-en-GB-chirp3-v1', short: 'recorded-word-en-GB-short-v1', latest_short: 'recorded-word-en-GB-v1-latest-short-opus-header-channel-count-v2' })[request.body.model], latencyMs: 123,
        audioSha256: createHash('sha256').update(originalBytes).digest('hex') };
      return responseFactory ? responseFactory(request, transcription) : { ok: true, status: 200, async json() { return transcription; } };
    },
  });
  vm.runInContext(pageScript, context, { filename: 'asr_eval.js', timeout: 1000 });
  const page = {
    archive, fetchRequests, recorders, recorderBytes, storedValues,
    element: id => document.getElementById(id),
    evaluate: expression => vm.runInContext(expression, context),
    counts: () => ({ microphoneRequests, microphoneStops, recorderStarts }),
    get fastForwardSpeechBatchTimers() { return fastForwardSpeechBatchTimers; },
    set fastForwardSpeechBatchTimers(value) { fastForwardSpeechBatchTimers = value; },
    beginHold() { return elements.get('mic').dispatch('pointerdown', { pointerId: 1 }); },
    endHold() { return elements.get('mic').dispatch('pointerup', { pointerId: 1 }); },
    deliverStoppedAudio() { recorders.at(-1).deliverStoppedAudio(); },
    async idle() {
      for (let turn = 0; turn < 1000; turn++) {
        await flushBrowserPromises();
        if (!vm.runInContext('operationPending', context)) return;
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      throw new Error('Frontend operation did not complete');
    },
    async click(id) { const operations = elements.get(id).click(); await Promise.all(operations || []); await this.idle(); },
    async enableMicrophone() { await this.click('enable-mic'); assert.equal(elements.get('mic').disabled, false, elements.get('problem').textContent); },
    configureTranscription(model = 'chirp_3') {
      elements.get('recognition-mode').value = model; elements.get('recognition-mode').dispatch('change');
      elements.get('gateway-url').value = 'https://speech.example/transcribe';
      elements.get('gateway-token').value = 'tab-only-secret-token';
    },
    async record() { this.beginHold(); await flushBrowserPromises(); clockMilliseconds += 1200; this.endHold(); await this.idle(); },
    latestAttempt() { return vm.runInContext('currentAttempt()', context); },
    downloadBlob(index = downloadedLinks.length - 1) { return blobUrls.get(downloadedLinks[index].href); },
    downloadedLinks,
  };
  return page;
}

function expectScore(page, hits, denominator, errors = 0) {
  assert.match(page.element('stats').textContent, new RegExp(hits + '/' + denominator + ' matches'));
  if (errors) assert.match(page.element('stats').textContent, new RegExp(errors + ' errors'));
  else assert.match(page.element('stats').textContent, /0 errors/);
}

async function seedSavedTake(archive, wordIndex, { modelRuns = [], voided = false, captureError = null } = {}) {
  const savedSession = archive.sessions.get(existingSessionId);
  const prompt = savedSession.order[wordIndex];
  const audioBytes = Buffer.from([0x40 + wordIndex, 0xff, 0x00, 0x31]);
  const audioBlob = new Blob([audioBytes], { type: 'audio/webm;codecs=opus' });
  const attempt = {
    id: randomUUID(), prompt, wordIndex, durationMs: 820,
    startedAt: '2026-10-03T10:00:00.000Z', micLabel: 'Test microphone', microphoneSettings: { sampleRate: 48000 },
    audioSha256: createHash('sha256').update(audioBytes).digest('hex'), voided, captureError, modelRuns,
  };
  await archive.saveAttempt(existingSessionId, attempt, audioBlob);
  return { audioBytes, attempt };
}

function savedCompletedRun(model, transcript) {
  return {
    id: randomUUID(), model, status: 'complete', transcript, latencyMs: 100,
    provider: 'google-cloud-stt', languageCode: 'en-GB',
    configurationVersion: ({ chirp_3: 'recorded-word-en-GB-chirp3-v1', short: 'recorded-word-en-GB-short-v1', latest_short: 'recorded-word-en-GB-v1-latest-short-opus-header-channel-count-v2' })[model],
  };
}

const browserBehaviorTests = [
  ['The main app canonical and fresh accepted spellings match Matt as a whole token', async () => {
    const app = createAppWordRestoration();
    assert.deepEqual(app.canonicalMat().accepted, ['mat', 'matt']);
    assert.deepEqual(app.restore().items['word:mat'].accepted, ['mat', 'matt']);
    assert.equal(app.matchMat('Matt'), true); assert.equal(app.matchMat('[unk] Matt [unk]'), true);
    for (const word of ['mad', 'Matthew', 'matter', 'bat']) assert.equal(app.matchMat(word), false);
  }],
  ['The main app adds Matt to existing saves without changing progress or duplicating spellings', async () => {
    const app = createAppWordRestoration(), original = existingChildProgress(app);
    const restored = app.restore(original);
    assert.deepEqual(restored.items['word:mat'].accepted, ['mat', 'matt']);
    assert.deepEqual(progressWithoutMatSpellings(restored), progressWithoutMatSpellings(original));
    app.save(); assert.deepEqual(app.restore(), restored);
  }],
  ['The first canonical pruning retains Matt and all saved progress', async () => {
    const app = createAppWordRestoration(), original = existingChildProgress(app, { acceptedPruned: false });
    original.items['word:mat'].accepted.push('matt', 'Matthew');
    const restored = app.restore(original), expected = structuredClone(original); expected.acceptedPruned = true;
    assert.deepEqual(restored.items['word:mat'].accepted, ['mat', 'matt']);
    assert.deepEqual(progressWithoutMatSpellings(restored), progressWithoutMatSpellings(expected));
    assert.equal(app.matchMat('Matthew'), false); app.save(); assert.deepEqual(app.restore(), restored);
  }],
  ['Empty main-app recognition never fabricates correctness or a transcript at any hold duration', async () => {
    for (const heldMilliseconds of [0, 500, 5000]) {
      const attempt = exerciseAppNoTranscript({ heldMilliseconds });
      assert.deepEqual(attempt.acceptedAnswers, []); assert.deepEqual(attempt.displayedTranscripts, []);
      assert.deepEqual(attempt.currentWord, attempt.originalWordProgress);
      assert.deepEqual(attempt.microphoneStatuses, ['ready']); assert.equal(attempt.spokenRetries.length, 1);
    }
    assert.deepEqual(exerciseAppNoTranscript({ heldMilliseconds: 5000, awaitingResult: true }).spokenRetries, []);
  }],
  ['Brave records without reading any browser speech constructor and supports native MIME lifecycle', async () => {
    const page = createPage(); await page.idle();
    assert.equal(page.counts().microphoneRequests, 0, 'Microphone must wait for explicit user action');
    await page.enableMicrophone(); await page.record();
    assert.equal(page.counts().recorderStarts, 1, page.element('problem').textContent);
    assert.equal(page.archive.attempts.size, 1, page.element('problem').textContent);
    assert.equal(page.latestAttempt().audioMimeType, 'audio/webm;codecs=opus');
    assert.deepEqual(Buffer.from(await page.latestAttempt().audioBlob.arrayBuffer()), page.recorderBytes);
    assert.equal(page.fetchRequests.length, 0, 'Save audio only must not contact a recognizer');
  }],
  ['Record release waits for delayed audio and durable commit before permitting navigation', async () => {
    const archive = new RecordingArchive(); archive.saveGate = deferred();
    const page = createPage({ archive, manualRecorderDelivery: true }); await page.idle(); await page.enableMicrophone();
    page.beginHold(); await flushBrowserPromises();
    assert.equal(page.element('mic').disabled, false, 'Pressed record button must remain enabled for pointerup');
    assert.equal(page.element('next').disabled, true);
    page.endHold(); await flushBrowserPromises();
    assert.equal(archive.audioSaves, 0, 'Recorder.stop must not be treated as the final dataavailable event');
    page.element('next').click(); assert.equal(page.evaluate('recordingSession.currentTrialIndex'), 0);
    page.deliverStoppedAudio();
    for (let turn = 0; turn < 100 && !archive.audioSaves; turn++) { await flushBrowserPromises(); await new Promise(resolve => setTimeout(resolve, 1)); }
    assert.equal(archive.audioSaves, 1); assert.equal(archive.attempts.size, 0);
    assert.equal(page.element('next').disabled, true, 'Saving remains locked until durable completion');
    archive.saveGate.resolve(); await page.idle(); await page.click('next');
    assert.equal(page.evaluate('recordingSession.currentTrialIndex'), 1);
  }],
  ['Rerecording and voiding retain every original take', async () => {
    const page = createPage(); await page.idle(); await page.enableMicrophone(); await page.record();
    const originalId = page.latestAttempt().id; await page.click('redo'); await page.record();
    assert.equal(page.archive.attempts.size, 2); assert.notEqual(page.latestAttempt().id, originalId);
    assert.equal(page.latestAttempt().takeNumber, 2); await page.click('void');
    assert.equal(page.latestAttempt().voided, true); assert.equal(page.archive.attempts.size, 2);
    assert.deepEqual(Buffer.from(await page.archive.attempts.get(originalId).audioBlob.arrayBuffer()), page.recorderBytes);
  }],
  ['Reload restores the saved original for replay without enabling microphone access', async () => {
    const page = createPage(); await page.idle(); await page.enableMicrophone(); await page.record();
    const reopened = createPage({ archive: page.archive }); await reopened.idle();
    assert.equal(reopened.counts().microphoneRequests, 0); assert.equal(reopened.element('replay').children[0].tagName, 'AUDIO');
    const player = reopened.element('replay').children[0];
    assert.match(player.src, /^blob:/); assert.equal(reopened.latestAttempt().id, page.latestAttempt().id);
    assert.deepEqual(Buffer.from(await reopened.latestAttempt().audioBlob.arrayBuffer()), page.recorderBytes);
  }],
  ['An API error leaves original audio durable and excludes the attempt from scored totals', async () => {
    const page = createPage({ responseFactory: async () => { throw new Error('speech network unavailable'); } });
    await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    assert.equal(page.archive.attempts.size, 1); assert.equal(page.latestAttempt().modelRuns[0].status, 'error');
    assert.match(page.element('verdict').textContent, /audio saved.*not scored/i);
    await page.click('finish'); expectScore(page, 0, 0, 1);
    assert.deepEqual(Buffer.from(await page.latestAttempt().audioBlob.arrayBuffer()), page.recorderBytes);
  }],
  ['Raw Matt returned by the API scores correctly without rewriting its displayed or exported transcript', async () => {
    const page = createPage(); await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    const run = page.latestAttempt().modelRuns[0];
    assert.equal(run.transcript, 'Matt'); assert.equal(run.verdict, 'hit');
    assert.match(page.element('heard').textContent, /“Matt”/);
    await page.click('finish'); expectScore(page, 1, 1); await page.click('export');
    assert.equal(page.archive.lastManifest.attempts[0].modelRuns[0].transcript, 'Matt');
  }],
  ['Chirp 3, V2 short and V1 latest_short compare the same saved bytes and saved sample rate', async () => {
    const page = createPage({ responseFactory: async (request, response) => ({
      ok: true, status: 200, async json() {
        return { ...response, transcript: request.body.model === 'chirp_3' ? 'math' : 'mat' };
      },
    }) });
    await page.idle(); await page.enableMicrophone(); page.configureTranscription('chirp_3'); await page.record();
    const original = Buffer.from(await page.latestAttempt().audioBlob.arrayBuffer());
    page.element('recognition-mode').value = 'short'; page.element('recognition-mode').dispatch('change');
    await page.click('transcribe');
    page.element('recognition-mode').value = 'latest_short'; page.element('recognition-mode').dispatch('change');
    await page.click('transcribe');
    assert.deepEqual(page.fetchRequests.map(request => request.body.model), ['chirp_3', 'short', 'latest_short']);
    for (const request of page.fetchRequests) assert.deepEqual(Buffer.from(request.body.audioBase64, 'base64'), original);
    assert.equal(page.fetchRequests[2].body.sampleRateHertz, 48000);
    const savedRuns = page.latestAttempt().modelRuns;
    assert.deepEqual(savedRuns.map(run => run.model), ['chirp_3', 'short', 'latest_short']);
    assert.deepEqual(savedRuns.map(run => run.transcript), ['math', 'mat', 'mat']);
    assert.equal(page.element('alts').textContent.includes('Chirp 3 (V2): “math” — miss'), true);
    assert.equal(page.element('alts').textContent.includes('short (V2): “mat” — hit'), true);
    assert.equal(page.element('alts').textContent.includes('latest_short (V1): “mat” — hit'), true);
    await page.click('finish');
    assert.match(page.element('stats').textContent, /Chirp 3 \(V2\): 0\/1 matches/);
    assert.match(page.element('stats').textContent, /short \(V2\): 1\/1 matches/);
    assert.match(page.element('stats').textContent, /latest_short \(V1\): 1\/1 matches/);
    assert.match(page.element('trials').textContent, /math — miss/);
    assert.match(page.element('trials').textContent, /mat — hit/);
    await page.click('export');
    assert.deepEqual(page.archive.lastManifest.attempts[0].modelRuns.map(run => run.transcript), ['math', 'mat', 'mat']);
  }],
  ['V1 latest_short refuses a saved recording without a supported sample rate before sending audio', async () => {
    const archive = new RecordingArchive();
    const { attempt } = await seedSavedTake(archive, 0);
    archive.attempts.set(attempt.id, { ...archive.attempts.get(attempt.id), microphoneSettings: {} });
    const page = createPage({ archive }); await page.idle(); page.configureTranscription('latest_short');
    await page.click('transcribe');
    assert.equal(page.fetchRequests.length, 0);
    assert.match(page.latestAttempt().modelRuns[0].error, /saved microphone sample rate/);
  }],
  ['The selected model batch sends each eligible current take once and skips completed, voided, and interrupted takes', async () => {
    const archive = new RecordingArchive();
    const first = await seedSavedTake(archive, 0, { modelRuns: [savedCompletedRun('chirp_3', 'math')] });
    const second = await seedSavedTake(archive, 1, { modelRuns: [savedCompletedRun('short', 'mad')] });
    await seedSavedTake(archive, 2, { captureError: 'microphone disconnected' });
    await seedSavedTake(archive, 3, { voided: true });
    const page = createPage({ archive }); await page.idle(); page.configureTranscription('short');
    assert.equal(page.element('transcribe-all').disabled, false);
    assert.match(page.element('strip').children[0].className, /\bmiss\b/);
    await page.click('transcribe-all');
    assert.equal(page.fetchRequests.length, 1);
    assert.equal(page.fetchRequests[0].body.model, 'short');
    assert.deepEqual(Buffer.from(page.fetchRequests[0].body.audioBase64, 'base64'), first.audioBytes);
    assert.equal(page.archive.attempts.get(first.attempt.id).modelRuns.length, 2);
    assert.deepEqual(page.archive.attempts.get(second.attempt.id).modelRuns.map(run => run.transcript), ['mad']);
    assert.match(page.element('strip').children[0].className, /\bhit\b/);
    assert.match(page.element('strip').children[0].title, /short \(V2\)/);
    assert.match(page.element('batch-status').textContent, /1\/1 remaining takes transcribed and saved/);
    assert.equal(page.element('transcribe-all').disabled, true);
    await page.click('finish');
    assert.match(page.element('stats').textContent, /Chirp 3 \(V2\): 0\/1 matches/);
    assert.match(page.element('stats').textContent, /short \(V2\): 2\/2 matches/);
  }],
  ['A failed batch stops before later takes and a retry skips successes already saved', async () => {
    const archive = new RecordingArchive();
    const takes = [];
    for (let wordIndex = 0; wordIndex < 3; wordIndex++) takes.push(await seedSavedTake(archive, wordIndex));
    let requestNumber = 0;
    const page = createPage({ archive, responseFactory: async (_request, transcription) => {
      requestNumber++;
      if (requestNumber === 2) return { ok: false, status: 502, async json() { return { error: {
        code: 'speech_provider_error', message: 'Google rejected the transcription request.', providerStatus: 400,
        providerResponse: { error: { status: 'INVALID_ARGUMENT', message: 'Invalid sampleRateHertz.' } },
      } }; } };
      return { ok: true, status: 200, async json() { return transcription; } };
    } });
    await page.idle(); page.configureTranscription('short');
    page.fastForwardSpeechBatchTimers = true;
    await page.click('transcribe-all');
    assert.equal(page.fetchRequests.length, 2, 'The third take must wait after the second take fails');
    assert.match(page.element('batch-status').textContent, /stopped at “mad” after 2\/3/);
    assert.match(page.element('batch-status').textContent, /Google HTTP 400.*INVALID_ARGUMENT.*Invalid sampleRateHertz/);
    assert.match(page.element('strip').children[1].title, /short \(V2\).*Transcription failed/);
    assert.doesNotMatch(page.element('strip').children[1].title, /undefined/);
    assert.equal(archive.attempts.get(takes[0].attempt.id).modelRuns.length, 1);
    assert.equal(archive.attempts.get(takes[1].attempt.id).modelRuns[0].status, 'error');
    await page.click('next');
    assert.match(page.element('verdict').textContent, /Google HTTP 400.*INVALID_ARGUMENT.*Invalid sampleRateHertz/);
    assert.equal(archive.attempts.get(takes[2].attempt.id).modelRuns.length, 0);
    await page.click('finish');
    assert.match(page.element('trials').textContent, /request error — Google rejected.*Google HTTP 400.*INVALID_ARGUMENT.*Invalid sampleRateHertz/);
    await page.click('back2');
    await page.click('transcribe-all');
    assert.equal(page.fetchRequests.length, 4, 'The retry must send only the failed and not-yet-run takes');
    assert.equal(archive.attempts.get(takes[0].attempt.id).modelRuns.length, 1, 'The completed take must not be billed twice');
    assert.equal(archive.attempts.get(takes[1].attempt.id).modelRuns.at(-1).status, 'complete');
    assert.equal(archive.attempts.get(takes[2].attempt.id).modelRuns.length, 1);
    assert.match(page.element('batch-status').textContent, /2\/2 remaining takes transcribed and saved/);
  }],
  ['A batch longer than the server rate window spaces requests below its 20-per-minute ceiling', async () => {
    const archive = new RecordingArchive();
    archive.sessions.set(existingSessionId, { ...archive.sessions.get(existingSessionId), order: [
      'mat', 'mad', 'cat', 'cut', 'pen', 'pin', 'bed', 'bad', 'sit', 'six', 'hop',
      'hot', 'bus', 'but', 'was', 'wash', 'so', 'no', 'go', 'he', 'we',
    ] });
    for (let wordIndex = 0; wordIndex < 21; wordIndex++) await seedSavedTake(archive, wordIndex);
    const page = createPage({ archive, audioEncodingDelaysMs: [5000] }); await page.idle(); page.configureTranscription('short');
    page.fastForwardSpeechBatchTimers = true;
    await page.click('transcribe-all');
    const submittedAt = page.fetchRequests.map(request => request.submittedAt);
    assert.equal(submittedAt.length, 21);
    assert.ok(submittedAt.slice(1).every((timestamp, index) => timestamp - submittedAt[index] >= minimumSpeechBatchRequestGapMs));
    for (const start of submittedAt) {
      assert.ok(submittedAt.filter(timestamp => timestamp >= start && timestamp - start < 60_000).length <= 20);
    }
    assert.match(page.element('batch-status').textContent, /21\/21 remaining takes transcribed and saved/);
  }],
  ['A resumed batch waits out a saved speech rate-limit response before sending audio', async () => {
    const archive = new RecordingArchive();
    const currentTime = Date.parse('2026-10-03T10:00:00.000Z');
    const rateLimitedAt = currentTime - 30_000;
    const first = await seedSavedTake(archive, 0, { modelRuns: [{
      id: randomUUID(), startedAt: new Date(rateLimitedAt).toISOString(), requestedModel: 'short', status: 'error',
      error: 'Too many recording requests.', serverError: { code: 'transcription_rate_limit' },
    }] });
    await seedSavedTake(archive, 1);
    const page = createPage({ archive }); await page.idle(); page.configureTranscription('short');
    page.fastForwardSpeechBatchTimers = true;
    await page.click('transcribe-all');
    assert.equal(page.fetchRequests.length, 2);
    assert.ok(page.fetchRequests[0].submittedAt >= rateLimitedAt + 61_000);
    assert.equal(page.archive.attempts.get(first.attempt.id).modelRuns.at(-1).status, 'complete');
    assert.match(page.element('batch-status').textContent, /2\/2 remaining takes transcribed and saved/);
  }],
  ['A successful empty API transcript is a scored miss', async () => {
    const page = createPage({ responseFactory: async (request, response) => ({ ok: true, status: 200, async json() { return { ...response, transcript: '' }; } }) });
    await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    assert.equal(page.latestAttempt().modelRuns[0].status, 'complete'); assert.equal(page.latestAttempt().modelRuns[0].verdict, 'miss');
    assert.match(page.element('heard').textContent, /Google returned no transcript/);
    assert.match(page.element('verdict').textContent, /audio is saved/);
    await page.click('finish'); expectScore(page, 0, 1);
    assert.match(page.element('trials').textContent, /No transcript returned — miss/);
  }],
  ['An audio save failure preserves unsaved bytes and locks session controls until an explicit retry', async () => {
    const archive = new RecordingArchive(); archive.failAudioSaves = 1;
    const page = createPage({ archive }); await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    assert.equal(archive.attempts.size, 0); assert.equal(page.fetchRequests.length, 0);
    assert.equal(page.element('retry-save').hidden, false); assert.equal(page.element('download-unsaved').hidden, false);
    for (const id of ['mic', 'next', 'new-session', 'saved-session', 'export']) assert.equal(page.element(id).disabled, true);
    await page.click('download-unsaved');
    assert.deepEqual(Buffer.from(await page.downloadBlob().arrayBuffer()), page.recorderBytes);
    assert.match(page.downloadedLinks[0].download, /\.webm$/);
    await page.click('retry-save');
    assert.equal(archive.audioSaves, 2); assert.equal(archive.attempts.size, 1); assert.equal(page.fetchRequests.length, 1);
    assert.equal(page.element('next').disabled, false);
  }],
  ['Retrying model-result storage does not make a second paid transcription request', async () => {
    const archive = new RecordingArchive(); archive.failModelSaves = 1;
    const page = createPage({ archive }); await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    assert.equal(archive.attempts.size, 1); assert.equal(page.fetchRequests.length, 1);
    assert.equal(page.element('next').disabled, true); assert.match(page.element('retry-save').textContent, /model result/);
    await page.click('retry-save');
    assert.equal(page.fetchRequests.length, 1); assert.equal(archive.modelSaves, 2);
    assert.equal(page.latestAttempt().modelRuns.length, 1); assert.equal(page.latestAttempt().modelRuns[0].status, 'complete');
  }],
  ['A model response preserves a void decision saved by another tab during transcription', async () => {
    const responseGate = deferred();
    let transcriptionResponse;
    const page = createPage({ responseFactory: async (request, response) => { transcriptionResponse = response; return responseGate.promise; } });
    await page.idle(); await page.enableMicrophone(); page.configureTranscription();
    page.beginHold(); await flushBrowserPromises(); page.endHold();
    for (let turn = 0; turn < 100 && !page.fetchRequests.length; turn++) { await flushBrowserPromises(); await new Promise(resolve => setTimeout(resolve, 1)); }
    assert.equal(page.fetchRequests.length, 1);
    const saved = [...page.archive.attempts.values()][0];
    await page.archive.updateAttempt(saved.sessionId, { ...saved, voided: true });
    responseGate.resolve({ ok: true, status: 200, async json() { return transcriptionResponse; } });
    await page.idle();
    assert.equal(page.latestAttempt().voided, true, 'Saving a paid model result must preserve the current archived void flag');
    assert.equal(page.latestAttempt().modelRuns.length, 1);
    assert.equal(page.latestAttempt().modelRuns[0].transcript, 'Matt');
    assert.equal(page.fetchRequests.length, 1);
  }],
  ['API error markup is rendered as text in trial and summary cells', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    const page = createPage({ responseFactory: async () => ({ ok: false, status: 502, async json() { return { error: {
      code: 'speech_provider_error', message: 'Google rejected the transcription request.', providerStatus: 400,
      providerResponse: { error: { status: 'INVALID_ARGUMENT', message: markup } },
    } }; } }) });
    await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    assert.match(page.element('verdict').textContent, /INVALID_ARGUMENT.*<img src=x onerror=alert\(1\)>/);
    assert.deepEqual(page.element('verdict').htmlWrites, []); await page.click('finish');
    assert.match(page.element('trials').textContent, /<img src=x onerror=alert\(1\)>/);
    const walk = element => [element, ...element.children.flatMap(walk)];
    assert.ok(walk(page.element('trials')).every(element => element.htmlWrites.length === 0));
  }],
  ['Creating a new session preserves all earlier original recordings', async () => {
    const page = createPage(); await page.idle(); await page.enableMicrophone(); await page.record();
    const savedId = page.latestAttempt().id; await page.click('new-session');
    assert.equal(page.archive.sessions.size, 2); assert.ok(page.archive.attempts.has(savedId));
    assert.equal(page.evaluate('recordedAttempts.length'), 0);
    assert.notEqual(page.evaluate('recordingSession.id'), existingSessionId);
  }],
  ['API request contains the same saved audio and no expected word, while credentials stay out of storage/export', async () => {
    const page = createPage(); await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    const request = page.fetchRequests[0];
    assert.deepEqual(Object.keys(request.body).sort(), ['audioBase64', 'durationMs', 'mimeType', 'model']);
    assert.deepEqual(Buffer.from(request.body.audioBase64, 'base64'), page.recorderBytes);
    assert.equal(request.options.headers.Authorization, 'Bearer tab-only-secret-token');
    assert.ok([...page.storedValues.values()].every(value => !value.includes('tab-only-secret-token')));
    await page.click('finish'); await page.click('export');
    assert.doesNotMatch(JSON.stringify(page.archive.lastManifest), /tab-only-secret-token/);
    assert.equal(page.latestAttempt().audioSha256, createHash('sha256').update(page.recorderBytes).digest('hex'));
  }],
  ['An unrecognized model selection is rejected before a request is sent', async () => {
    const page = createPage(); await page.idle(); await page.enableMicrophone();
    page.configureTranscription('chirp_3'); await page.record();
    page.element('recognition-mode').value = 'unapproved-model'; page.element('recognition-mode').dispatch('change');
    await page.click('transcribe');
    assert.equal(page.fetchRequests.length, 1);
    assert.match(page.element('problem').textContent, /Unknown transcription model/);
  }],
  ['A response for different audio is retained as an unscored model error', async () => {
    const page = createPage({ responseFactory: async (request, response) => ({ ok: true, status: 200, async json() { return { ...response, audioSha256: '0'.repeat(64) }; } }) });
    await page.idle(); await page.enableMicrophone(); page.configureTranscription(); await page.record();
    const run = page.latestAttempt().modelRuns[0];
    assert.equal(run.status, 'error'); assert.match(run.error, /does not match this recording/i);
    assert.equal(page.archive.attempts.size, 1); await page.click('finish'); expectScore(page, 0, 0, 1);
  }],
  ['Evaluator homophones retain pair discrimination and reject similar substrings', async () => {
    const page = createPage(); await page.idle();
    assert.equal(page.evaluate("scoreTranscript('Matt', 'mat').verdict"), 'hit');
    assert.equal(page.evaluate("scoreTranscript('mad', 'mat').verdict"), 'pair-confusion');
    for (const transcript of ['Matthew', 'matter', 'bat']) assert.equal(page.evaluate("scoreTranscript('" + transcript + "', 'mat').verdict"), 'miss');
  }],
];

let failingBehaviorCount = 0;
for (const [behavior, verifyBehavior] of browserBehaviorTests) {
  try { await verifyBehavior(); console.log('PASS ' + behavior); }
  catch (error) { failingBehaviorCount++; console.error('FAIL ' + behavior + '\n' + error.stack); }
}
console.log((browserBehaviorTests.length - failingBehaviorCount) + '/' + browserBehaviorTests.length + ' evaluator and app regressions passed');
if (failingBehaviorCount) process.exitCode = 1;
