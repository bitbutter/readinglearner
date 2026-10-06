// Runs the reading app's real microphone, self-check progress and grown-up tuning without packages.
// Run from any directory: node logs/tools/test_reading_voice.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const readingAppSource = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const wordCourseSource = readFileSync(new URL('../../word-course.js', import.meta.url), 'utf8');
const wordPracticeSource = readFileSync(new URL('../../word-practice.js', import.meta.url), 'utf8');

function readingAppSection(startMarker, endMarker) {
  const sectionStart = readingAppSource.indexOf(startMarker);
  const sectionEnd = readingAppSource.indexOf(endMarker, sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart,
    `Reading app test section missing: ${startMarker} / ${endMarker}`);
  return readingAppSource.slice(sectionStart, sectionEnd);
}

const testedReadingAppSource = [
  wordCourseSource,
  wordPracticeSource,
  readingAppSection('const NUMBER_LEVEL_COUNT =', 'function makeItem(c, kind)'),
  readingAppSection('function numberToWords(n)', '// Isolated phonetic letter sounds'),
  readingAppSection('// MICROPHONE CAPTURE AND TUNING RECOGNITION', '// AUDITION (grown-up tuning)'),
  readingAppSection('async function armAudition(itemId)', '// ROUND BUILDING'),
  readingAppSection('async function openTuning()', 'function setTuneTab(tab)'),
  readingAppSection('function presentItem(item)', 'function beginWordEncounter(item)'),
  readingAppSection('function beginWordEncounter(item)', 'function endRound()'),
  readingAppSection('function checkLevelComplete()', '// UI'),
  readingAppSection('function showScreen(name)', 'function playPling()'),
  readingAppSection('function rulePraise()', 'function showLevelUp(result)'),
  readingAppSection('async function init()', '// Parse a level deep link'),
  readingAppSection('  // Hear button',
    "  document.getElementById('tomorrow-text').addEventListener"),
].join('\n');

const wordCatalogDeclaration = readingAppSource.match(/const WORDS_CONTENT\s*=\s*(\[[\s\S]*?^\]);/m);
assert.ok(wordCatalogDeclaration, 'The actual word catalog must be present.');
const wordItemFixtureSource = [
  wordCourseSource,
  'const WORDS_CONTENT = ' + wordCatalogDeclaration[1] + ';',
  readingAppSection('function makeItem(c, kind)', 'function freshState()'),
  "Object.fromEntries([...WORDS_CONTENT, ...WORD_COURSE.additionalWords].map(word => [word.id, makeItem(word, 'word')]))",
].join('\n');

function createWordItemFixtures() {
  return JSON.parse(JSON.stringify(vm.runInNewContext(wordItemFixtureSource, {}, { timeout: 1000 })));
}

function deferredPermission() {
  let resolve, reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

function createReadingVoiceHarness(options = {}) {
  const timerCallbacks = new Map();
  let nextTimerId = 1;
  const wordItems = createWordItemFixtures();
  const word = Object.values(wordItems).find(item => item.display === (options.wordDisplay || 'mat'));
  assert.ok(word, 'The test word must belong to the real catalog.');
  const practice = {
    currentSet: 'words', currentLevel: 1, currentItem: word, awaitingResult: false,
    currentEncounterRole: options.encounterRole || 'familiar', ruleFocusId: 'short-a',
    spokenWordEncounter: null,
    recapId: null, hearPressed: false, letterTaps: 0,
    completedCount: 0, roundCorrect: 0, roundSilentCorrect: 0,
    newTrophies: 0, ruleIds: [], ruleMissed: false, queue: [],
  };
  const observations = {
    contexts: [], recognizers: [], microphoneRequests: [], microphoneStatuses: [],
    speech: [], displayedTranscripts: [], savedProgress: 0, browserRecognizerStarts: 0,
    modelLoads: 0, pickerRenders: 0, imageManifestLoads: 0,
    presentedWords: [], nextWordCount: 0, auditMessages: [],
    tuningListeningRows: [], tuningResults: [], tuningErrorRows: [],
    speechCancelCount: 0, recordedSounds: [],
  };
  let currentTime = 10000;
  class ReadingCaptureClock extends Date { static now() { return currentTime; } }
  let microphoneTrack;
  let microphoneStream;
  function freshMicrophoneStream() {
    const liveTrack = { stopped: false, readyState: 'live', stop() { this.stopped = true; this.readyState = 'ended'; } };
    microphoneTrack = liveTrack;
    microphoneStream = { getTracks: () => [liveTrack] };
    return microphoneStream;
  }
  freshMicrophoneStream();

  class LocalWordRecognizer {
    constructor(sampleRate, grammar) {
      this.sampleRate = sampleRate;
      this.grammar = grammar;
      this.listeners = new Map();
      this.acceptedAudio = [];
      this.finalRequests = 0;
      this.removed = false;
      observations.recognizers.push(this);
    }
    on(eventName, callback) { this.listeners.set(eventName, callback); }
    acceptWaveform(audioBuffer) { this.acceptedAudio.push(audioBuffer); }
    retrieveFinalResult() { this.finalRequests++; }
    remove() { this.removed = true; }
    emitResult(text) { this.listeners.get('result')?.({ result: { text } }); }
    emitPartialResult(partial) { this.listeners.get('partialresult')?.({ result: { partial } }); }
    emitFinalResult(text) { this.listeners.get('finalresult')?.({ result: { text } }); }
    emitError(message) { this.listeners.get('error')?.({ error: message }); }
  }

  class MicrophoneAudioContext {
    constructor(configuration = {}) {
      if (options.audioContextCreationError) throw options.audioContextCreationError;
      this.sampleRate = configuration.sampleRate || 16000;
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = {};
      this.resumeCount = 0;
      this.closed = false;
      observations.contexts.push(this);
    }
    async resume() {
      this.resumeCount++;
      options.audioContextResumeStarted?.resolve();
      if (options.audioContextResumeError) throw options.audioContextResumeError;
      if (options.audioContextResumePermission) await options.audioContextResumePermission.promise;
      this.state = 'running';
    }
    createMediaStreamSource(stream) {
      this.sourceStream = stream;
      return { connect() {}, disconnect() {} };
    }
    createScriptProcessor() {
      if (options.audioProcessorCreationError) throw options.audioProcessorCreationError;
      this.processor = { connect() {}, disconnect() {}, onaudioprocess: null };
      return this.processor;
    }
    async close() { this.closed = true; this.state = 'closed'; }
  }

  function BrowserSpeechRecognizer() {
    observations.browserRecognizerStarts++;
    throw new Error('Network recognition must never be used by the reading app');
  }

  let activeSpokenUtterance = null;
  class ReadingSpeechUtterance {
    constructor(text) { this.text = text; this.active = false; }
  }
  const speechSynthesis = {
    speak(utterance) {
      activeSpokenUtterance = utterance;
      utterance.active = true;
      observations.speech.push({ text: utterance.text, rate: utterance.rate, utterance });
    },
    cancel() {
      observations.speechCancelCount++;
      const cancelledUtterance = activeSpokenUtterance;
      activeSpokenUtterance = null;
      if (!cancelledUtterance) return;
      cancelledUtterance.active = false;
      if (options.cancelDispatchesError !== false) cancelledUtterance.onerror?.({ error: 'canceled' });
    },
  };

  class ReadingRuleSound {
    constructor(url) { this.url = url; this.paused = false; observations.recordedSounds.push(this); }
    play() { this.paused = false; return Promise.resolve(); }
    pause() { this.paused = true; }
  }

  const localSpeechModel = { KaldiRecognizer: LocalWordRecognizer, setLogLevel() {} };
  const modelApi = { async createModel() {
    observations.modelLoads++;
    if (options.localModelPermission) await options.localModelPermission.promise;
    if (options.localModelLoadError) throw options.localModelLoadError;
    return localSpeechModel;
  } };
  const pageElements = new Map();
  function pageElement(elementId) {
    if (!pageElements.has(elementId)) {
      const listeners = new Map();
      const classes = new Set();
      pageElements.set(elementId, {
        textContent: '',
        style: { setProperty() {} }, disabled: false, hidden: false,
        children: [],
        set innerHTML(value) { this.markup = value; this.children = []; },
        get innerHTML() { return this.markup || ''; },
        appendChild(child) { this.children.push(child); },
        append(...children) { this.children.push(...children); },
        setAttribute(name, value) { this[name] = String(value); },
        classList: {
          add: (...names) => names.forEach(name => classes.add(name)),
          remove: (...names) => names.forEach(name => classes.delete(name)),
          toggle(name, enabled) {
            if (enabled === undefined) enabled = !classes.has(name);
            if (enabled) classes.add(name); else classes.delete(name);
            return enabled;
          },
          contains: name => classes.has(name),
        },
        addEventListener: (eventName, callback) => listeners.set(eventName, callback),
        setPointerCapture() {},
        dispatch: eventName => listeners.get(eventName)?.({ preventDefault() {}, pointerId: 1, pointerType: 'touch' }),
      });
    }
    return pageElements.get(elementId);
  }
  const context = vm.createContext({
    console, URL, Promise, Date: ReadingCaptureClock,
    document: { getElementById: pageElement, querySelectorAll: () => [],
      querySelector: pageElement, createElement: tag => pageElement(Symbol(tag)), body: pageElement('body') },
    window: {
      Vosk: options.localRecognizerLibraryMissing ? undefined : modelApi, AudioContext: MicrophoneAudioContext,
      speechSynthesis,
      SpeechRecognition: BrowserSpeechRecognizer, webkitSpeechRecognition: BrowserSpeechRecognizer,
      location: { href: 'https://example.invalid/readinglearner/index.html' },
    },
    AudioContext: MicrophoneAudioContext, Vosk: modelApi, Audio: ReadingRuleSound, AUDIO_VERSION: 4,
    speechSynthesis, SpeechSynthesisUtterance: ReadingSpeechUtterance, getVoice: () => null,
    navigator: { mediaDevices: { async getUserMedia(configuration) {
      observations.microphoneRequests.push(configuration);
      if (options.microphonePermissionError) throw options.microphonePermissionError;
      return options.microphonePermission ? options.microphonePermission.promise : freshMicrophoneStream();
    } } },
    gs: practice,
    spokenWordEncounterSequence: 0,
    currentlyDisplayedScreenSequence: 0, currentlyDisplayedScreenName: 'practice',
    tuneSearch: '', renderTuneList() {},
    stored: { items: wordItems, rounds: [], wordCourse: null,
      settings: { wordLevel: 1, numberLevel: 1, knownStarterWordIds: ['word:mat'] } },
    DBG: (...message) => observations.auditMessages.push(message),
    setTimeout(callback, milliseconds) {
      const timerId = nextTimerId++;
      timerCallbacks.set(timerId, {
        callback, milliseconds, scheduledForTimestamp: currentTime + milliseconds,
        cancelled: false, fired: false,
      });
      return timerId;
    },
    clearTimeout(timerId) {
      const timer = timerCallbacks.get(timerId);
      if (timer) timer.cancelled = true;
    },
    setHeardDisplay: text => observations.displayedTranscripts.push(text),
    saveStored: () => observations.savedProgress++,
    speak: (text, rate, finished) => observations.speech.push({ text, rate, finished }),
    speakWord: (text, finished) => observations.speech.push({ text, finished }),
    nextItem: () => observations.nextWordCount++,
    buildSoundUnitSpans: () => ({}), stopLetterSoundPlayback() {},
    loadStored() {}, loadVoices() {}, setupEvents() {}, levelFromHash: () => null,
    loadImageManifest: async () => { observations.imageManifestLoads++; },
    renderPicker: () => { observations.pickerRenders++; },
    location: { protocol: 'https:', hash: '' },
    setRowListening: (wordId, listening) => observations.tuningListeningRows.push({ wordId, listening }),
    setRowResult: (wordId, status, message) => observations.tuningErrorRows.push({ wordId, status, message }),
    renderAuditionResult: (wordId, transcript, matched) => observations.tuningResults.push({ wordId, transcript, matched }),
    openGrownUp() {},
    flashScreen() {}, renderTrophyRow() {}, renderConfirmationProgress() {}, playTrophyChime() {}, burstStars() {},
    playPling() {}, renderDots() {},
    PRAISE: ['Good'], TROPHY_PALETTES: { silver: [], gold: [], purple: [] },
  });

  const speechCompletionSource = options.useRealSpeechCompletion ?
    readingAppSection('let currentUtterance = null;', '// MICROPHONE CAPTURE AND TUNING RECOGNITION') : '';
  vm.runInContext(speechCompletionSource + testedReadingAppSource + '\nstored.wordCourse = createWordCourseProgress();', context,
    { filename: 'app.js local reading voice', timeout: 1000 });

  const run = expression => vm.runInContext(expression, context, { timeout: 1000 });
  return {
    run, word, practice, observations, timerCallbacks,
    get microphoneTrack() { return microphoneTrack; },
    get microphoneStream() { return microphoneStream; },
    get activeUtterance() { return activeSpokenUtterance; },
    dispatchMicrophoneEvent: eventName => pageElement('mic-button').dispatch(eventName),
    microphoneStatusText: () => pageElement('mic-status').textContent,
    element: pageElement,
    advanceTime(milliseconds) {
      const advancedTimestamp = currentTime + milliseconds;
      while (true) {
        const nextDueTimer = [...timerCallbacks]
          .filter(([, timer]) => !timer.cancelled && !timer.fired && timer.scheduledForTimestamp <= advancedTimestamp)
          .sort(([, first], [, second]) => first.scheduledForTimestamp - second.scheduledForTimestamp)[0];
        if (!nextDueTimer) break;
        const [timerId, timer] = nextDueTimer;
        currentTime = timer.scheduledForTimestamp;
        this.fireTimer(timerId);
      }
      currentTime = advancedTimestamp;
    },
    async finishSpeech(index = observations.speech.length - 1, how = 'onend') {
      const spokenLine = observations.speech[index];
      if (spokenLine?.utterance) {
        const utterance = spokenLine.utterance;
        utterance.active = false;
        if (activeSpokenUtterance === utterance) activeSpokenUtterance = null;
        if (how === 'onend') utterance.onend?.();
        else utterance.onerror?.({ error: how.replace(/^onerror:/, '') });
      } else spokenLine?.finished?.(how);
      await Promise.resolve();
    },
    startSpeech(index = observations.speech.length - 1) {
      const utterance = observations.speech[index]?.utterance;
      assert.ok(utterance, 'Native speech playback must exist before its start event');
      utterance.onstart?.({});
    },
    speechBoundary(index, charIndex, charLength = 0) {
      const utterance = observations.speech[index]?.utterance;
      assert.ok(utterance, 'Native speech playback must exist before its boundary event');
      utterance.onboundary?.({ charIndex, charLength, name: 'word' });
    },
    beginEncounter() {
      practice.awaitingResult = false;
      practice.hearPressed = false;
      practice.letterTaps = 0;
      run('beginWordEncounter(gs.currentItem)');
      run("setMicState('ready')");
    },
    async prepare() {
      run('beginWordEncounter(gs.currentItem)');
      await run('openMicStream()');
      run("setMicState('ready')");
    },
    async prepareTuning() { await run('initVosk()'); await this.prepare(); },
    async beginAttempt() { await run('startListening()'); },
    deliverAudio(audioBuffer = { sampleRate: 16000, duration: 0.25, length: 4000,
      getChannelData: () => new Float32Array(4000) }) {
      const processor = run('scriptProc');
      assert.ok(processor?.onaudioprocess, 'Microphone processing must be connected');
      processor.onaudioprocess({ inputBuffer: audioBuffer });
      return audioBuffer;
    },
    release({ leavePausePending = false } = {}) {
      run('finishSpokenAttempt()');
      if (!leavePausePending) this.advanceTime(500);
    },
    fireTimer(timerId) {
      const timer = timerCallbacks.get(timerId);
      assert.ok(timer, `Timer ${timerId} must exist`);
      // Call even after cancellation to simulate a callback already queued by the browser.
      timer.fired = true;
      timer.callback();
    },
    activeTimersWithDelay(milliseconds) {
      return [...timerCallbacks].filter(([, timer]) => !timer.cancelled && !timer.fired && timer.milliseconds === milliseconds)
        .map(([timerId]) => timerId);
    },
  };
}

const permissionDenied = Object.assign(new Error('Microphone access refused'), { name: 'NotAllowedError' });

async function testMissingLocalEngineFailsExplicitly() {
  const app = createReadingVoiceHarness({ localRecognizerLibraryMissing: true });
  await assert.rejects(Promise.resolve(app.run('initVosk()')), /vosk|speech|recognition/i,
    'A missing local recognizer must fail startup explicitly');
  assert.equal(app.run('voskReady'), false);
  assert.equal(app.observations.microphoneRequests.length, 0);
  assert.equal(app.observations.browserRecognizerStarts, 0, 'Missing local speech must never select browser recognition');
}

async function testFailedLocalModelDownloadFailsExplicitly() {
  const localModelLoadError = new Error('Local speech model download failed');
  const app = createReadingVoiceHarness({ localModelLoadError });
  await assert.rejects(Promise.resolve(app.run('initVosk()')), localModelLoadError);
  assert.equal(app.run('voskReady'), false);
  assert.equal(app.observations.microphoneRequests.length, 0);
  assert.equal(app.observations.browserRecognizerStarts, 0);
}

async function testTuningResumesAndCapturesLocalAudio() {
  const app = createReadingVoiceHarness();
  await app.prepareTuning();
  await app.run("armAudition('word:mat')");
  assert.equal(app.run('auditionState'), 'listening');
  assert.ok(app.observations.contexts.some(context => context.resumeCount > 0),
    'Holding the tuning microphone must resume its AudioContext');
  const recognizer = app.run('auditionRecognizer');
  assert.equal(recognizer.grammar, undefined, 'Parent tuning must preserve open-vocabulary local recognition');
  const capturedAudio = app.deliverAudio();
  assert.equal(recognizer.acceptedAudio[0], capturedAudio);
  assert.equal(app.observations.recognizers.length, 1, 'Tuning creates the only recognizer; practice creates none');
  app.run('stopAudition()');
  assert.equal(recognizer.finalRequests, 1);
  recognizer.emitFinalResult('mat');
  assert.deepEqual(app.observations.tuningResults, [{ wordId: 'word:mat', transcript: 'mat', matched: true }]);
  assert.equal(app.word.totalAttempts, 0, 'Parent microphone testing must not change child reading progress');
  assert.equal(app.observations.browserRecognizerStarts, 0);
}

async function testTuningCancelDuringResumeNeverStartsCapture() {
  const audioContextResumePermission = deferredPermission();
  const audioContextResumeStarted = deferredPermission();
  const app = createReadingVoiceHarness({ audioContextResumePermission, audioContextResumeStarted });
  await app.prepareTuning();
  const pendingTuningCapture = app.run("armAudition('word:mat')");
  await audioContextResumeStarted.promise;
  assert.equal(app.run('auditionState'), 'warming');
  app.run('stopAudition()');
  audioContextResumePermission.resolve();
  await pendingTuningCapture;
  assert.equal(app.run('auditionState'), 'idle');
  assert.equal(app.run('auditionRecognizer'), null, 'Releasing during tuning warm-up must never create a recognizer');
  assert.equal(app.run('auditionRowId'), null);
  assert.equal(app.activeTimersWithDelay(6000).length, 0);
  assert.deepEqual(app.observations.tuningListeningRows.at(-1), { wordId: 'word:mat', listening: false });
  assert.equal(app.observations.tuningResults.length, 0);
}

async function testTuningPriorCallbacksAndClosedScreenCannotWriteResults() {
  const app = createReadingVoiceHarness();
  await app.prepareTuning();
  app.run("stored.items['word:bad'] = { id: 'word:bad', display: 'bad', accepted: ['bad'], auditionConfs: [] }");
  await app.run("armAudition('word:mat')");
  const oldRecognizer = app.run('auditionRecognizer');
  app.run('stopAudition()');
  const oldTimers = [...app.timerCallbacks.keys()];
  oldRecognizer.emitFinalResult('mat');

  await app.run("armAudition('word:bad')");
  const newRecognizer = app.run('auditionRecognizer');
  assert.notEqual(newRecognizer, oldRecognizer, 'Each tuning recording must isolate its delayed result events');
  oldRecognizer.emitFinalResult('mat');
  for (const timerId of oldTimers) app.fireTimer(timerId);
  assert.equal(app.run('auditionState'), 'listening', 'Old tuning timers must not stop the current word');
  assert.equal(app.observations.tuningResults.length, 1, 'An old transcript must not write a result for the current word');
  app.run('stopAudition()');
  newRecognizer.emitFinalResult('bad');
  assert.deepEqual(app.observations.tuningResults.at(-1), { wordId: 'word:bad', transcript: 'bad', matched: true });

  await app.run("armAudition('word:mat')");
  const closedScreenRecognizer = app.run('auditionRecognizer');
  app.run('stopAudition()');
  app.run('closeTuning()');
  closedScreenRecognizer.emitFinalResult('mat');
  for (const timerId of app.timerCallbacks.keys()) app.fireTimer(timerId);
  assert.equal(app.observations.tuningResults.length, 2, 'Leaving tuning must reject all pending transcripts');
  assert.equal(app.run('auditionRecognizer'), null);
  assert.equal(app.run('auditionState'), 'idle');
  assert.equal(app.activeTimersWithDelay(6000).length, 0);
  assert.equal(app.activeTimersWithDelay(2500).length, 0);
  assert.equal(app.microphoneTrack.stopped, true);
}

async function testTuningStreamingEndpointsWaitForExplicitFinal() {
  const app = createReadingVoiceHarness();
  await app.prepareTuning();
  await app.run("armAudition('word:mat')");
  const recognizer = app.run('auditionRecognizer');
  app.run('stopAudition()');
  recognizer.emitResult('');
  recognizer.emitPartialResult('bad');
  recognizer.emitResult('bad');
  assert.equal(app.run('auditionState'), 'evaluating');
  assert.equal(app.observations.tuningResults.length, 0, 'Streaming endpoints must not publish a premature tuning judgment');
  recognizer.emitFinalResult('mat');
  assert.equal(app.observations.tuningResults.length, 1);
  assert.equal(app.observations.tuningResults[0].matched, true);
}

async function testMissingTuningFinalReportsEngineFailureWithoutJudgment() {
  const app = createReadingVoiceHarness();
  await app.prepareTuning();
  await app.run("armAudition('word:mat')");
  const recognizer = app.run('auditionRecognizer');
  recognizer.emitResult('mat');
  app.run('stopAudition()');
  app.fireTimer(app.run('auditionSettleTimer'));
  assert.equal(app.observations.tuningResults.length, 0, 'A missing final must not publish a tuning judgment');
  assert.equal(app.run('auditionState'), 'idle');
  assert.ok(app.observations.tuningErrorRows.some(row => /speech|recognition|engine/i.test(row.message)),
    'A missing tuning final response must report a speech engine failure');
  recognizer.emitFinalResult('mat');
  assert.equal(app.observations.tuningResults.length, 0);
}

async function testTuningRecognizerErrorsNeverPublishJudgment() {
  for (const releaseBeforeError of [false, true]) {
    const app = createReadingVoiceHarness();
    await app.prepareTuning();
    await app.run("armAudition('word:mat')");
    const recognizer = app.run('auditionRecognizer');
    recognizer.emitResult('mat');
    if (releaseBeforeError) app.run('stopAudition()');
    recognizer.emitError('Injected local recognizer failure');
    assert.equal(app.observations.tuningResults.length, 0, 'A failed tuning recognizer must never publish buffered text');
    assert.equal(app.run('auditionState'), 'idle');
    assert.ok(app.observations.tuningErrorRows.some(row => /speech|recognition|engine/i.test(row.message)));
    recognizer.emitFinalResult('mat');
    for (const timerId of app.timerCallbacks.keys()) app.fireTimer(timerId);
    assert.equal(app.observations.tuningResults.length, 0);
  }
}

async function askSelfCheck(app) {
  await app.beginAttempt();
  app.deliverAudio();
  app.release();
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer');
  await app.finishSpeech();
  assert.equal(app.practice.spokenWordEncounter.phase, 'confirming');
  assert.equal(app.run('micState'), 'confirming');
}

async function testPhysicalCaptureAsksAfterPauseWithoutSpeechRecognition() {
  const app = createReadingVoiceHarness({ localRecognizerLibraryMissing: true });
  const tuningSpellingsBeforePractice = [...app.word.accepted];
  await app.prepare();
  await app.beginAttempt();
  assert.equal(app.run('micState'), 'listening');
  assert.ok(app.observations.contexts.some(context => context.resumeCount > 0));
  app.deliverAudio();
  app.release({ leavePausePending: true });
  assert.equal(app.observations.recognizers.length, 0, 'Practice must never create a recognition worker');
  assert.equal(app.observations.browserRecognizerStarts, 0);
  assert.equal(app.word.totalAttempts, 0, 'Finishing physical capture must not score the answer');
  assert.equal(app.observations.speech.length, 0, 'Releasing the microphone must begin a silent pause');
  assert.equal(app.practice.spokenWordEncounter.phase, 'first-recorded');
  assert.equal(app.run('micState'), 'waiting');
  assert.equal(app.element('mic-button').disabled, true);
  assert.equal(app.element('mic-button').classList.contains('listening'), false);
  assert.equal(app.element('mic-button').classList.contains('waiting'), true);
  assert.equal(app.element('hear-button').disabled, true);
  assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
  assert.equal(app.element('self-check-question').classList.contains('hidden'), true);
  const capturedSamplesAfterRelease = app.run('capturedMicrophoneSampleCount');
  app.deliverAudio();
  assert.equal(app.run('capturedMicrophoneSampleCount'), capturedSamplesAfterRelease,
    'Audio arriving during the pause must not extend the completed recording');
  app.release({ leavePausePending: true });
  assert.equal(app.activeTimersWithDelay(500).length, 1, 'Repeated release must keep one pending question');
  const questionPauseTimer = app.activeTimersWithDelay(500)[0];
  app.advanceTime(499);
  assert.equal(app.observations.speech.length, 0, 'The comparison question must wait the full 500 ms');
  assert.equal(app.word.totalAttempts, 0);
  app.advanceTime(1);
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer');
  assert.equal(app.observations.speech.length, 1, 'The completed pause must speak the recorded word once');
  assert.equal(app.observations.speech.at(-1).text, 'mat');
  assert.equal(app.element('self-check-question').textContent, 'mat. Got it?');
  app.fireTimer(questionPauseTimer);
  assert.equal(app.observations.speech.length, 1, 'A queued duplicate pause callback must not replay the question');
  assert.equal(app.element('self-check-question').classList.contains('hidden'), false);
  assert.equal(app.element('self-check-yes').disabled, true);
  assert.equal(app.element('mic-button').disabled, true);
  assert.equal(app.activeTimersWithDelay(10000).length, 0, 'Released capture must not retain its recording deadline');
  app.run('confirmFirstSpokenAttempt()');
  await app.beginAttempt();
  assert.equal(app.word.totalAttempts, 0, 'Yes must wait for the spoken word to finish');
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer', 'Repeating must wait for the spoken word to finish');
  await app.finishSpeech();
  assert.equal(app.run('micState'), 'confirming');
  assert.equal(app.observations.speech.length, 2);
  assert.equal(app.observations.speech.at(-1).text, 'Got it?');
  assert.equal(app.element('self-check-yes').disabled, false, 'Yes must be available while Got it? is speaking');
  assert.equal(app.element('mic-button').disabled, false, 'Repeat recording must be available while Got it? is speaking');
  assert.equal(app.word.totalAttempts, 0);
  app.element('self-check-yes').dispatch('click');
  assert.equal(app.word.totalAttempts, 1);
  assert.equal(app.word.totalCorrect, 1);
  assert.equal(app.word.masteryConfirmationCount, 1);
  assert.equal(app.word.flawlessConfirmationCount, 1);
  assert.equal(app.word.mastered, false, 'One self-confirmation must leave one gold dot');
  assert.equal(app.word.flawless, false, 'One zero-tap self-confirmation must leave one purple dot');
  assert.deepEqual(app.word.accepted, tuningSpellingsBeforePractice, 'Self-checking must never mutate tuning spellings');
  assert.deepEqual(app.observations.displayedTranscripts, [], 'Practice must never display an ASR transcript');
}

async function testHelpedRepeatWaitsForPauseBeforeScoringAndFeedback() {
  const app = createReadingVoiceHarness();
  await app.prepare(); await askSelfCheck(app);
  await app.beginAttempt(); app.deliverAudio();
  const speechCountBeforeRelease = app.observations.speech.length;
  app.release({ leavePausePending: true });
  assert.equal(app.practice.spokenWordEncounter.phase, 'repeat-recorded');
  assert.equal(app.run('micState'), 'waiting');
  assert.equal(app.element('mic-button').disabled, true);
  assert.equal(app.element('mic-button').classList.contains('listening'), false);
  assert.equal(app.element('hear-button').disabled, true);
  assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
  const capturedSamplesAfterRelease = app.run('capturedMicrophoneSampleCount');
  app.deliverAudio();
  assert.equal(app.run('capturedMicrophoneSampleCount'), capturedSamplesAfterRelease,
    'The completed helped repeat must stop accepting microphone samples');
  app.release({ leavePausePending: true });
  app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.activeTimersWithDelay(500).length, 1, 'Duplicate release must keep one pending helped completion');
  const repeatPauseTimer = app.activeTimersWithDelay(500)[0];
  app.advanceTime(499);
  assert.equal(app.observations.speech.length, speechCountBeforeRelease,
    'Helped-repeat feedback must wait the full 500 ms');
  assert.equal(app.word.totalAttempts, 0);
  assert.equal(app.word.totalCorrect, 0);
  assert.equal(app.practice.roundCorrect, 0);
  assert.equal(app.practice.completedCount, 0);
  assert.equal(app.observations.savedProgress, 0);
  app.advanceTime(1);
  assert.equal(app.practice.spokenWordEncounter.phase, 'completed');
  assert.equal(app.word.totalAttempts, 2);
  assert.equal(app.word.totalCorrect, 1);
  assert.equal(app.word.lastResult, 'helped');
  assert.equal(app.practice.roundCorrect, 1);
  assert.equal(app.practice.completedCount, 1);
  assert.equal(app.observations.savedProgress, 1);
  assert.equal(app.observations.speech.length, speechCountBeforeRelease + 1);
  assert.equal(app.observations.speech.at(-1).text, 'Nice practice!');
  app.fireTimer(repeatPauseTimer);
  app.release(); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.totalAttempts, 2, 'Queued duplicate completion must not score the helped repeat twice');
  assert.equal(app.observations.savedProgress, 1);
  assert.equal(app.observations.speech.length, speechCountBeforeRelease + 1,
    'The helped repeat must speak its existing feedback exactly once');
  await app.finishSpeech();
  assert.equal(app.observations.nextWordCount, 1);
}

async function testLeavingPracticeAndNewEncountersInvalidatePendingReleasePauses() {
  for (const repeat of [false, true]) for (const transition of ['picker', 'grownup', 'new-encounter']) {
    const app = createReadingVoiceHarness();
    await app.prepare();
    if (repeat) await askSelfCheck(app);
    await app.beginAttempt(); app.deliverAudio(); app.release({ leavePausePending: true });
    const obsoletePauseTimer = app.activeTimersWithDelay(500)[0];
    assert.ok(obsoletePauseTimer, 'Healthy release must leave a pending feedback pause');
    const speechCountBeforeTransition = app.observations.speech.length;
    if (transition === 'new-encounter') {
      app.beginEncounter(); await app.beginAttempt();
    } else app.run(`showScreen('${transition}')`);
    const microphoneStateAfterTransition = app.run('micState');
    app.fireTimer(obsoletePauseTimer);
    app.advanceTime(500);
    assert.equal(app.run('micState'), microphoneStateAfterTransition,
      `${transition}: old first/repeat feedback must not change the current microphone`);
    assert.equal(app.observations.speech.length, speechCountBeforeTransition,
      `${transition}: old first/repeat feedback must not speak`);
    assert.equal(app.word.totalAttempts, 0, `${transition}: old first/repeat feedback must not score`);
    assert.equal(app.word.totalCorrect, 0);
    assert.equal(app.observations.savedProgress, 0);
    if (transition === 'new-encounter') {
      app.deliverAudio(); app.release({ leavePausePending: true });
      app.advanceTime(499);
      assert.equal(app.observations.speech.length, speechCountBeforeTransition);
      app.advanceTime(1);
      assert.equal(app.observations.speech.length, speechCountBeforeTransition + 1,
        'The next encounter must retain its own release pause and question');
      assert.equal(app.observations.speech.at(-1).text, 'mat');
      assert.equal(app.element('self-check-question').textContent, 'mat. Got it?');
      assert.equal(app.word.totalAttempts, 0);
    }
  }
}

async function testSilenceIsValidCaptureButMissingOrEndedCaptureIsUnscored() {
  for (const captureFailure of ['no-samples', 'ended-track', 'suspended-context']) {
    const app = createReadingVoiceHarness();
    await app.prepare(); await app.beginAttempt();
    if (captureFailure !== 'no-samples') app.deliverAudio();
    if (captureFailure === 'ended-track') app.microphoneTrack.readyState = 'ended';
    if (captureFailure === 'suspended-context') app.observations.contexts.at(-1).state = 'suspended';
    app.release();
    assert.equal(app.word.totalAttempts, 0, captureFailure);
    assert.equal(app.word.totalCorrect, 0, captureFailure);
    assert.equal(app.run('micState'), 'ready', captureFailure);
    assert.equal(app.practice.spokenWordEncounter.phase, 'first-ready', captureFailure);
    assert.equal(app.observations.speech.some(utterance => /Got it\?/.test(utterance.text)), false,
      'Missing physical audio must never create a self-check question');
  }
  const silent = createReadingVoiceHarness();
  await silent.prepare(); await askSelfCheck(silent);
  silent.run('confirmFirstSpokenAttempt()');
  assert.equal(silent.word.totalCorrect, 1, 'Captured silence remains eligible for the child\'s own check');
}

async function testSecondEncounterEarnsGoldAndPurpleWithoutDuplicateConfirmations() {
  const app = createReadingVoiceHarness();
  await app.prepare(); await askSelfCheck(app);
  app.run('confirmFirstSpokenAttempt()');
  const staleTimers = [...app.timerCallbacks.keys()];
  app.run('confirmFirstSpokenAttempt()'); app.release();
  for (const timerId of staleTimers) app.fireTimer(timerId);
  assert.equal(app.word.totalAttempts, 1);
  assert.equal(app.word.masteryConfirmationCount, 1, 'A duplicate Yes must not fill the next dot');
  assert.equal(app.word.mastered, false);
  app.beginEncounter(); await askSelfCheck(app);
  app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.totalAttempts, 2);
  assert.equal(app.word.totalCorrect, 2);
  assert.equal(app.word.masteryConfirmationCount, 2);
  assert.equal(app.word.flawlessConfirmationCount, 2);
  assert.equal(app.word.mastered, true);
  assert.equal(app.word.flawless, true);
}

async function testHelpUsageIsFrozenBeforeFeedbackAndCountsDistinctTrophyRequirements() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  app.practice.letterTaps = 1;
  await app.beginAttempt(); app.deliverAudio(); app.release();
  app.practice.letterTaps = 8;
  app.practice.hearPressed = true;
  await app.finishSpeech(); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.masteryConfirmationCount, 1, 'Feedback-time help must not rewrite the submitted attempt');
  assert.equal(app.word.flawlessConfirmationCount, 0, 'A one-tap confirmation does not count as zero taps');
  app.beginEncounter(); await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.mastered, true, 'Two at-most-one-tap first confirmations earn gold');
  assert.equal(app.word.flawlessConfirmationCount, 1);
  assert.equal(app.word.flawless, false);
  app.beginEncounter(); await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.flawless, true, 'Two zero-tap first confirmations earn purple cumulatively');

  const decoded = createReadingVoiceHarness();
  await decoded.prepare(); decoded.practice.letterTaps = 2;
  await askSelfCheck(decoded); decoded.run('confirmFirstSpokenAttempt()');
  assert.equal(decoded.word.decoded, true, 'A first confirmation with at least two letter taps retains silver');
  assert.equal(decoded.word.masteryConfirmationCount, 0);
  assert.equal(decoded.word.flawlessConfirmationCount, 0);

  const heard = createReadingVoiceHarness();
  await heard.prepare(); heard.practice.hearPressed = true;
  await askSelfCheck(heard); heard.run('confirmFirstSpokenAttempt()');
  assert.equal(heard.word.totalCorrect, 1);
  assert.equal(heard.word.masteryConfirmationCount, 0, 'Hear it before recording disqualifies first-attempt dots');
  assert.equal(heard.word.flawlessConfirmationCount, 0);
  assert.equal(heard.word.decoded, false);
}

async function testSameMicrophoneRepeatCompletesAsHelpedAndPreservesEarnedDots() {
  const app = createReadingVoiceHarness({ wordDisplay: 'cat', encounterRole: 'focus' });
  await app.prepare(); await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  app.beginEncounter();
  await askSelfCheck(app);
  const questionsBeforeRepeat = app.observations.speech.filter(utterance => /Got it\?/.test(utterance.text)).length;
  app.dispatchMicrophoneEvent('pointerdown');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.practice.spokenWordEncounter.phase, 'repeat-recording', 'The existing microphone must start the helped repeat');
  assert.equal(app.run('micState'), 'listening');
  assert.equal(app.word.totalAttempts, 1, 'Selecting repeat must wait for physical capture before committing');
  app.deliverAudio(); app.advanceTime(500); app.dispatchMicrophoneEvent('pointerup');
  app.advanceTime(500);
  assert.equal(app.practice.spokenWordEncounter.phase, 'completed');
  assert.equal(app.word.totalAttempts, 3, 'A declined first answer plus its helped repeat are two attempts');
  assert.equal(app.word.totalCorrect, 2);
  assert.equal(app.word.lastResult, 'helped');
  assert.equal(app.word.masteryConfirmationCount, 1, 'Repeating must retain the previously earned gold dot');
  assert.equal(app.word.flawlessConfirmationCount, 1, 'Repeating must retain the previously earned purple dot');
  assert.equal(app.word.mastered, false);
  assert.equal(app.word.flawless, false);
  assert.equal(app.practice.ruleMissed, true);
  assert.equal(app.practice.completedCount, 2);
  assert.equal(app.observations.speech.filter(utterance => /Got it\?/.test(utterance.text)).length, questionsBeforeRepeat,
    'The repeat must finish without a second Yes question');
  app.release(); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.totalAttempts, 3, 'Repeated release and Yes cannot commit the helped answer twice');
  app.beginEncounter(); await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.mastered, true, 'A later first-attempt Yes must use the dot retained through repeating');
  assert.equal(app.word.flawless, true);
}

async function testRepeatWithoutSamplesRemainsUnscoredAndRetainsRepeatReady() {
  const app = createReadingVoiceHarness();
  await app.prepare(); await askSelfCheck(app);
  await app.beginAttempt(); app.release();
  assert.equal(app.word.totalAttempts, 0);
  assert.equal(app.practice.spokenWordEncounter.phase, 'repeat-ready');
  assert.equal(app.run('micState'), 'repeat-ready');
  await app.beginAttempt(); app.deliverAudio(); app.release();
  assert.equal(app.word.totalAttempts, 2);
  assert.equal(app.word.totalCorrect, 1);
  assert.equal(app.word.masteryConfirmationCount, 0);
}

async function testFirstAndRepeatCancellationDuringResumeNeverStartLateCapture() {
  for (const repeat of [false, true]) for (const pointerEvent of ['pointerup', 'pointercancel']) {
    const app = createReadingVoiceHarness();
    await app.prepare();
    if (repeat) await askSelfCheck(app);
    const resumePermission = deferredPermission(), resumeStarted = deferredPermission();
    // Inject delay into the next existing microphone context resume.
    const captureContext = app.observations.contexts.at(-1);
    captureContext.resume = async () => { resumeStarted.resolve(); await resumePermission.promise; captureContext.state = 'running'; };
    const pendingCapture = app.beginAttempt();
    await resumeStarted.promise;
    assert.equal(app.run('micState'), 'warming');
    app.dispatchMicrophoneEvent(pointerEvent);
    resumePermission.resolve(); await pendingCapture;
    assert.equal(app.run('micState'), repeat ? 'repeat-ready' : 'ready', pointerEvent);
    assert.equal(app.practice.spokenWordEncounter.phase, repeat ? 'repeat-ready' : 'first-ready');
    assert.equal(app.word.totalAttempts, 0);
    assert.equal(app.activeTimersWithDelay(10000).length, 0);
  }
}

async function testCancelDuringPhysicalCaptureDiscardsFirstAndRepeatAudio() {
  for (const repeat of [false, true]) {
    const app = createReadingVoiceHarness();
    await app.prepare();
    if (repeat) await askSelfCheck(app);
    await app.beginAttempt(); app.deliverAudio();
    app.dispatchMicrophoneEvent('pointercancel');
    assert.equal(app.run('micState'), repeat ? 'repeat-ready' : 'ready');
    assert.equal(app.practice.spokenWordEncounter.phase, repeat ? 'repeat-ready' : 'first-ready');
    assert.equal(app.word.totalAttempts, 0, 'Cancelling recorded audio must remain unscored');
    app.release();
    assert.equal(app.word.totalAttempts, 0, 'A late release after cancellation must not commit discarded audio');
    await app.beginAttempt(); app.deliverAudio(); app.release();
    if (repeat) assert.equal(app.word.totalAttempts, 2);
    else assert.equal(app.practice.spokenWordEncounter.phase, 'answer');
  }
}

async function testRepeatResumeFailurePreservesTheEncounterAndFirstAssistance() {
  const app = createReadingVoiceHarness();
  await app.prepare(); app.practice.letterTaps = 1;
  await askSelfCheck(app);
  const recordedAssistance = app.practice.spokenWordEncounter.firstAttemptAssistance;
  app.observations.contexts.at(-1).resume = async () => { throw new Error('Repeat capture cannot resume'); };
  await app.beginAttempt();
  assert.equal(app.run('micState'), 'repeat-ready');
  assert.equal(app.practice.spokenWordEncounter.firstAttemptAssistance, recordedAssistance);
  assert.equal(app.word.totalAttempts, 0);
  await app.beginAttempt(); app.deliverAudio(); app.release();
  assert.equal(app.word.totalAttempts, 2);
  assert.equal(app.word.totalCorrect, 1);
  assert.equal(app.word.masteryConfirmationCount, 0);
}

async function testMicrophoneFailuresAndLatePermissionNeverScore() {
  for (const captureOptions of [
    { microphonePermissionError: permissionDenied },
    { audioProcessorCreationError: new Error('Audio processor unavailable') },
    { audioContextResumeError: new Error('Audio capture cannot resume') },
  ]) {
    const app = createReadingVoiceHarness(captureOptions);
    await app.prepare(); await app.beginAttempt();
    assert.notEqual(app.run('micState'), 'listening');
    assert.equal(app.word.totalAttempts, 0);
    assert.equal(app.word.totalCorrect, 0);
    assert.ok(app.observations.speech.some(utterance => /microphone/i.test(utterance.text)));
    if (captureOptions.audioProcessorCreationError) {
      assert.equal(app.microphoneTrack.stopped, true);
      assert.equal(app.run('micStream'), null);
      assert.equal(app.run('audioCtx'), null);
    }
  }
  const microphonePermission = deferredPermission();
  const app = createReadingVoiceHarness({ microphonePermission });
  app.beginEncounter();
  const pendingCapture = app.beginAttempt();
  app.run("showScreen('picker')");
  app.run('closeMicStream()');
  microphonePermission.resolve(app.microphoneStream); await pendingCapture;
  assert.equal(app.microphoneTrack.stopped, true);
  assert.equal(app.run('micStream'), null);
  assert.equal(app.run('scriptProc'), null);
  assert.equal(app.run('audioCtx'), null);
  assert.equal(app.word.totalAttempts, 0);
  assert.notEqual(app.run('micState'), 'listening');
}

async function testReleaseAndCancelDuringPermissionDoNotStartDelayedRecording() {
  for (const pointerEvent of ['pointerup', 'pointercancel']) {
    const microphonePermission = deferredPermission();
    const app = createReadingVoiceHarness({ microphonePermission });
    app.beginEncounter();
    const pendingCapture = app.beginAttempt();
    assert.equal(app.run('micState'), 'warming');
    app.dispatchMicrophoneEvent(pointerEvent);
    microphonePermission.resolve(app.microphoneStream);
    await pendingCapture;
    assert.equal(app.run('micState'), 'ready');
    assert.equal(app.practice.spokenWordEncounter.phase, 'first-ready');
    assert.equal(app.word.totalAttempts, 0);
    assert.equal(app.activeTimersWithDelay(10000).length, 0);
  }
}

async function testPreviouslyEarnedTrophiesRemainPermanentDuringNewSelfChecks() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  Object.assign(app.word, { decoded: true, mastered: true, flawless: true });
  await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.word.mastered, true);
  assert.equal(app.word.flawless, true);
  assert.equal(app.practice.newTrophies, 0, 'Previously earned trophies must not celebrate again');
  app.beginEncounter(); await askSelfCheck(app);
  await app.beginAttempt(); app.deliverAudio(); app.release();
  assert.equal(app.word.decoded, true);
  assert.equal(app.word.mastered, true);
  assert.equal(app.word.flawless, true);
  assert.equal(app.word.masteryConfirmationCount, 1);
  assert.equal(app.word.flawlessConfirmationCount, 1);
}

async function testOldAnswerAndQuestionCallbacksCannotInterruptLaterPractice() {
  for (const spokenStage of ['answer', 'question']) {
    for (const transition of ['picker', 'grownup', 'new-encounter', 'repeat']) {
      if (spokenStage === 'answer' && transition === 'repeat') continue;
      const app = createReadingVoiceHarness({ useRealSpeechCompletion: true, cancelDispatchesError: false });
      await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release();
      const answerIndex = app.observations.speech.length - 1;
      if (spokenStage === 'question') await app.finishSpeech(answerIndex);
      const obsoleteSpeechIndex = app.observations.speech.length - 1;
      const obsoleteWatchdogTimer = app.activeTimersWithDelay(4000).at(-1);
      const spokenLineCount = app.observations.speech.length;
      if (transition === 'new-encounter') {
        app.beginEncounter(); await app.beginAttempt();
      } else if (transition === 'repeat') await app.beginAttempt();
      else app.run(`showScreen('${transition}')`);
      const microphoneStateAfterTransition = app.run('micState');
      await app.finishSpeech(obsoleteSpeechIndex);
      await app.finishSpeech(obsoleteSpeechIndex, 'onerror:late-synthesis-error');
      app.fireTimer(obsoleteWatchdogTimer);
      await app.finishSpeech(answerIndex);
      app.run('confirmFirstSpokenAttempt()');
      assert.equal(app.run('micState'), microphoneStateAfterTransition,
        `${spokenStage}/${transition}: obsolete speech must not expose Yes or stop current recording`);
      assert.equal(app.observations.speech.length, spokenLineCount,
        `${spokenStage}/${transition}: obsolete speech must not start a late question`);
      assert.equal(app.word.totalAttempts, 0);
      assert.equal(app.observations.savedProgress, 0);
    }
  }
}

async function testYesDuringQuestionStopsVoiceAndPreservesOrdinaryAndTrophyFeedback() {
  for (const reward of ['ordinary', 'trophy']) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
    await app.prepare();
    if (reward === 'trophy') {
      app.word.masteryConfirmationCount = 1;
      app.word.flawlessConfirmationCount = 1;
    }
    await askSelfCheck(app);
    const questionIndex = app.observations.speech.length - 1;
    const questionUtterance = app.activeUtterance;
    const questionWatchdogTimer = app.activeTimersWithDelay(4000).at(-1);
    assert.equal(questionUtterance.text, 'Got it?');
    assert.equal(questionUtterance.active, true);
    assert.equal(app.observations.speech[0].rate, app.observations.speech[questionIndex].rate,
      'The word and question must use the same reading rate');
    assert.equal(app.element('self-check-yes').disabled, false);
    assert.equal(app.element('mic-button').disabled, false);
    app.element('self-check-yes').dispatch('click');
    assert.equal(questionUtterance.active, false, `${reward}: Yes must stop Got it? immediately`);
    assert.equal(app.word.totalAttempts, 1);
    assert.equal(app.word.totalCorrect, 1);
    assert.equal(app.observations.savedProgress, 1);
    if (reward === 'trophy') {
      assert.equal(app.activeUtterance, null, 'The trophy pause must begin with the question already stopped');
      assert.equal(app.observations.speech.length, 2);
      app.advanceTime(799);
      assert.equal(app.activeUtterance, null);
      app.advanceTime(1);
    }
    const feedbackUtterance = app.activeUtterance;
    assert.ok(feedbackUtterance, `${reward}: committed feedback must still play`);
    assert.equal(app.observations.speech.length, 3);
    app.element('self-check-yes').dispatch('click');
    await app.finishSpeech(questionIndex);
    await app.finishSpeech(questionIndex, 'onerror:late-synthesis-error');
    app.fireTimer(questionWatchdogTimer);
    assert.equal(app.activeUtterance, feedbackUtterance,
      'Old question end/error/watchdog events must preserve the newer feedback voice');
    assert.equal(feedbackUtterance.active, true);
    assert.equal(app.observations.speech.length, 3);
    assert.equal(app.word.totalAttempts, 1, 'Yes during the question must score once');
    assert.equal(app.observations.nextWordCount, 0, 'The question must not finish reward feedback');
    await app.finishSpeech();
    assert.equal(app.observations.nextWordCount, 1);
  }
}

async function testRepeatDuringQuestionStopsVoiceBeforeMicrophoneResumeAndSamples() {
  const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
  await app.prepare(); await askSelfCheck(app);
  const questionUtterance = app.activeUtterance;
  const resumePermission = deferredPermission(), resumeStarted = deferredPermission();
  const captureContext = app.observations.contexts.at(-1);
  captureContext.resume = async () => {
    assert.equal(app.activeUtterance, null, 'Repeat voice must stop before microphone resume begins');
    resumeStarted.resolve(); await resumePermission.promise; captureContext.state = 'running';
  };
  const pendingRepeatCapture = app.beginAttempt();
  assert.equal(questionUtterance.active, false, 'Starting repeat must synchronously stop Got it?');
  assert.equal(app.activeUtterance, null);
  await resumeStarted.promise;
  assert.equal(app.run('micState'), 'warming');
  const samplesBeforeResume = app.run('capturedMicrophoneSampleCount');
  app.deliverAudio();
  assert.equal(app.run('capturedMicrophoneSampleCount'), samplesBeforeResume,
    'Repeat must not collect samples while microphone resume is pending');
  resumePermission.resolve(); await pendingRepeatCapture;
  assert.equal(app.run('micState'), 'listening');
  assert.equal(app.run('capturedMicrophoneSampleCount'), 0);
  app.deliverAudio();
  assert.equal(app.run('capturedMicrophoneSampleCount'), 4000);
  assert.equal(questionUtterance.active, false, 'The question must remain stopped during repeat capture');
  assert.equal(app.word.totalAttempts, 0);
}

async function testQuestionEndErrorAndWatchdogLeaveChoicesAvailable() {
  for (const completion of ['onend', 'onerror:synthesis-failed', 'WATCHDOG']) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
    await app.prepare(); await askSelfCheck(app);
    if (completion === 'WATCHDOG') app.fireTimer(app.activeTimersWithDelay(4000).at(-1));
    else await app.finishSpeech(undefined, completion);
    assert.equal(app.practice.spokenWordEncounter.phase, 'confirming', completion);
    assert.equal(app.run('micState'), 'confirming');
    assert.equal(app.element('self-check-yes').disabled, false);
    assert.equal(app.element('mic-button').disabled, false);
    assert.equal(app.observations.speech.length, 2, 'Question completion must not replay the answer');
    assert.equal(app.word.totalAttempts, 0);
    app.element('self-check-yes').dispatch('click');
    assert.equal(app.word.totalCorrect, 1, 'A heard word remains confirmable after question speech failure');
  }
}

async function testEstimatedAnswerEndStartsFromPlaybackAndPrecedesNativeCompletion() {
  const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
  app.run('stored.settings.speechRate = 0.9');
  await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release();
  const answerUtterance = app.activeUtterance;
  const answerEstimateMs = app.run("estimateAnswerSpeechDurationMs('mat', 0.9)");
  assert.ok(answerEstimateMs >= 250 && answerEstimateMs <= 500,
    'A short word at the usual reading rate must have a short audible-end estimate');
  app.advanceTime(600);
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer',
    'Submitting speech must not begin the audible-end countdown before playback starts');
  assert.equal(app.element('self-check-yes').disabled, true);
  app.run('stored.settings.speechRate = 0.45');
  app.startSpeech();
  app.advanceTime(100);
  app.startSpeech();
  app.advanceTime(answerEstimateMs - 101);
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer');
  assert.equal(app.element('self-check-yes').disabled, true);
  assert.equal(app.element('mic-button').disabled, true);
  app.element('self-check-yes').dispatch('click'); await app.beginAttempt();
  assert.equal(app.word.totalAttempts, 0, 'Neither choice may act before the audible-end estimate');
  app.advanceTime(1);
  assert.equal(app.practice.spokenWordEncounter.phase, 'confirming',
    'The estimate must use the utterance rate and the first actual playback start');
  assert.equal(app.element('self-check-yes').disabled, false);
  assert.equal(app.element('mic-button').disabled, false);
  assert.equal(app.activeUtterance, answerUtterance);
  assert.equal(answerUtterance.active, true, 'Opening choices must keep the spoken word playing');
  assert.equal(app.observations.speech.length, 1, 'Got it? must wait for native word completion');
  assert.equal(app.word.totalAttempts, 0);
  await app.finishSpeech(0);
  assert.equal(app.observations.speech.length, 2);
  assert.equal(app.activeUtterance.text, 'Got it?');
  assert.equal(app.element('self-check-yes').disabled, false);
  await app.finishSpeech(0);
  assert.equal(app.observations.speech.length, 2, 'Duplicate native word completion must ask once');
}

async function testTerminalAnswerBoundaryOpensChoicesWithoutInterruptingTheWord() {
  const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
  await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release();
  const answerUtterance = app.activeUtterance;
  app.startSpeech(0);
  app.speechBoundary(0, 0, app.word.display.length);
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer',
    'The word-start boundary must not enable choices even when charLength covers the word');
  app.speechBoundary(0, 1, app.word.display.length - 1);
  assert.equal(app.element('self-check-yes').disabled, true,
    'Character coverage must not be mistaken for a terminal speech boundary');
  app.speechBoundary(0, app.word.display.length);
  assert.equal(app.practice.spokenWordEncounter.phase, 'confirming');
  assert.equal(app.element('self-check-yes').disabled, false);
  assert.equal(app.element('mic-button').disabled, false);
  assert.equal(app.activeUtterance, answerUtterance);
  assert.equal(answerUtterance.active, true);
  assert.equal(app.observations.speech.length, 1);
  app.speechBoundary(0, app.word.display.length + 1);
  assert.equal(app.observations.speech.length, 1, 'Repeated terminal boundaries must not start Got it?');
  await app.finishSpeech(0);
  assert.equal(app.activeUtterance.text, 'Got it?');
}

async function testYesAtEstimatedAnswerEndCancelsSafelyBeforeNativeCompletion() {
  for (const reward of ['ordinary', 'trophy']) for (const cancelDispatchesError of [true, false]) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true, cancelDispatchesError });
    await app.prepare();
    if (reward === 'trophy') {
      app.word.masteryConfirmationCount = 1;
      app.word.flawlessConfirmationCount = 1;
    }
    await app.beginAttempt(); app.deliverAudio(); app.release(); app.startSpeech(0);
    const answerUtterance = app.activeUtterance;
    const answerEstimateMs = app.run("estimateAnswerSpeechDurationMs('mat', 0.9)");
    const answerEstimateTimer = app.activeTimersWithDelay(answerEstimateMs)[0];
    const answerWatchdogTimer = app.activeTimersWithDelay(4000)[0];
    app.advanceTime(answerEstimateMs);
    app.element('self-check-yes').dispatch('click');
    assert.equal(answerUtterance.active, false, 'Yes must stop the still-active answer immediately');
    assert.equal(app.practice.spokenWordEncounter.phase, 'completed');
    assert.equal(app.word.totalAttempts, 1);
    if (reward === 'trophy') {
      assert.equal(app.activeUtterance, null, 'The trophy pause must start with the answer already stopped');
      app.advanceTime(800);
    }
    const feedbackUtterance = app.activeUtterance;
    app.startSpeech(0); app.speechBoundary(0, app.word.display.length);
    app.fireTimer(answerEstimateTimer);
    await app.finishSpeech(0); await app.finishSpeech(0, 'onerror:late-synthesis-error');
    app.fireTimer(answerWatchdogTimer);
    app.element('self-check-yes').dispatch('click');
    assert.equal(app.activeUtterance, feedbackUtterance,
      'Late answer events must preserve the newer reward feedback');
    assert.equal(feedbackUtterance.active, true);
    assert.equal(app.observations.speech.length, 2);
    assert.equal(app.observations.speech.some(line => line.text === 'Got it?'), false,
      'A confirmed answer must never start a late question');
    assert.equal(app.word.totalAttempts, 1);
    assert.equal(app.observations.savedProgress, 1);
  }
}

async function testRepeatAtEstimatedAnswerEndCancelsBeforeCaptureAndRejectsLateSpeech() {
  for (const cancelDispatchesError of [true, false]) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true, cancelDispatchesError });
    await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release(); app.startSpeech(0);
    const answerUtterance = app.activeUtterance;
    const answerEstimateMs = app.run("estimateAnswerSpeechDurationMs('mat', 0.9)");
    const answerEstimateTimer = app.activeTimersWithDelay(answerEstimateMs)[0];
    const answerWatchdogTimer = app.activeTimersWithDelay(4000)[0];
    app.advanceTime(answerEstimateMs);
    const pendingRepeatCapture = app.beginAttempt();
    assert.equal(answerUtterance.active, false, 'Repeat must stop the answer before asynchronous microphone setup');
    await pendingRepeatCapture;
    assert.equal(app.practice.spokenWordEncounter.phase, 'repeat-recording');
    assert.equal(app.run('micState'), 'listening');
    app.startSpeech(0); app.speechBoundary(0, app.word.display.length);
    app.fireTimer(answerEstimateTimer);
    await app.finishSpeech(0); await app.finishSpeech(0, 'onerror:late-synthesis-error');
    app.fireTimer(answerWatchdogTimer);
    assert.equal(app.practice.spokenWordEncounter.phase, 'repeat-recording');
    assert.equal(app.run('micState'), 'listening');
    assert.equal(app.observations.speech.length, 1);
    assert.equal(app.word.totalAttempts, 0);
    app.deliverAudio(); app.release();
    assert.equal(app.word.totalAttempts, 2);
    assert.equal(app.observations.speech.at(-1).text, 'Nice practice!');
    assert.equal(app.observations.speech.some(line => line.text === 'Got it?'), false);
  }
}

async function testGenuineAnswerFailureAfterEstimatedEndRevokesChoices() {
  for (const failure of ['onerror:synthesis-failed', 'WATCHDOG']) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
    await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release(); app.startSpeech(0);
    const answerEstimateMs = app.run("estimateAnswerSpeechDurationMs('mat', 0.9)");
    const answerEstimateTimer = app.activeTimersWithDelay(answerEstimateMs)[0];
    app.advanceTime(answerEstimateMs);
    assert.equal(app.element('self-check-yes').disabled, false);
    if (failure === 'WATCHDOG') app.fireTimer(app.activeTimersWithDelay(4000)[0]);
    else await app.finishSpeech(0, failure);
    assert.equal(app.practice.spokenWordEncounter.phase, 'answer-error', failure);
    assert.equal(app.run('micState'), 'answer-error');
    assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
    assert.equal(app.element('mic-button').disabled, true);
    assert.equal(app.element('hear-button').disabled, false);
    app.startSpeech(0); app.speechBoundary(0, app.word.display.length); app.fireTimer(answerEstimateTimer);
    await app.finishSpeech(0);
    app.element('self-check-yes').dispatch('click'); await app.beginAttempt();
    assert.equal(app.practice.spokenWordEncounter.phase, 'answer-error');
    assert.equal(app.word.totalAttempts, 0);
    assert.equal(app.observations.savedProgress, 0);
    assert.equal(app.observations.speech.length, 1, 'A failed answer must not start Got it?');
  }
}

async function testAnswerWithoutPlaybackStartStaysDisabledUntilSuccessfulNativeEnd() {
  const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
  await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release();
  app.advanceTime(1000);
  assert.equal(app.practice.spokenWordEncounter.phase, 'answer');
  assert.equal(app.element('self-check-yes').disabled, true);
  assert.equal(app.element('mic-button').disabled, true);
  app.element('self-check-yes').dispatch('click'); await app.beginAttempt();
  assert.equal(app.word.totalAttempts, 0, 'An unstarted answer must remain unscored');
  await app.finishSpeech(0);
  assert.equal(app.practice.spokenWordEncounter.phase, 'confirming');
  assert.equal(app.element('self-check-yes').disabled, false);
  assert.equal(app.activeUtterance.text, 'Got it?');
}

async function testStaleAnswerEstimateAndPlaybackEventsCannotOpenAnotherAnswer() {
  for (const transition of ['picker', 'grownup', 'new-encounter', 'retry']) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true, cancelDispatchesError: false });
    await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release(); app.startSpeech(0);
    const answerEstimateMs = app.run("estimateAnswerSpeechDurationMs('mat', 0.9)");
    const obsoleteEstimateTimer = app.activeTimersWithDelay(answerEstimateMs)[0];
    if (transition === 'retry') {
      await app.finishSpeech(0, 'onerror:synthesis-failed');
      app.element('hear-button').dispatch('click');
    } else if (transition === 'new-encounter') {
      app.beginEncounter(); await app.beginAttempt(); app.deliverAudio(); app.release();
    } else app.run(`showScreen('${transition}')`);
    const microphoneStateAfterTransition = app.run('micState');
    const speechCountAfterTransition = app.observations.speech.length;
    const currentUtterance = app.activeUtterance;
    app.startSpeech(0); app.speechBoundary(0, app.word.display.length);
    app.fireTimer(obsoleteEstimateTimer);
    await app.finishSpeech(0); await app.finishSpeech(0, 'onerror:late-synthesis-error');
    app.advanceTime(answerEstimateMs);
    assert.equal(app.run('micState'), microphoneStateAfterTransition,
      `${transition}: obsolete estimate/start/boundary/completion must not expose choices`);
    assert.equal(app.observations.speech.length, speechCountAfterTransition,
      `${transition}: obsolete answer must not start Got it?`);
    assert.equal(app.word.totalAttempts, 0);
    if (transition === 'retry' || transition === 'new-encounter') {
      assert.equal(app.activeUtterance, currentUtterance);
      assert.equal(app.element('self-check-yes').disabled, true);
      app.startSpeech(1); app.advanceTime(answerEstimateMs);
      assert.equal(app.practice.spokenWordEncounter.phase, 'confirming',
        'The current answer playback must retain its own audible-end estimate');
      await app.finishSpeech(1);
      assert.equal(app.activeUtterance.text, 'Got it?');
    }
  }
}

async function testAnswerEstimateAccountsForNumbersLongerWordsAndSlowerPlayback() {
  const estimates = createReadingVoiceHarness({ useRealSpeechCompletion: true });
  const shortWordMs = estimates.run("estimateAnswerSpeechDurationMs('mat', 0.9)");
  const longerWordMs = estimates.run("estimateAnswerSpeechDurationMs('elephant', 0.9)");
  const phraseMs = estimates.run("estimateAnswerSpeechDurationMs('red and blue', 0.9)");
  const oneMs = estimates.run("estimateAnswerSpeechDurationMs('1', 0.9)");
  const twentyOneMs = estimates.run("estimateAnswerSpeechDurationMs('21', 0.9)");
  const slowWordMs = estimates.run("estimateAnswerSpeechDurationMs('mat', 0.45)");
  assert.ok(longerWordMs > shortWordMs, 'A longer spoken word must keep choices disabled longer');
  assert.ok(phraseMs > shortWordMs, 'A spoken phrase must include all its words in the estimate');
  assert.ok(twentyOneMs > oneMs, 'Twenty-one must be estimated from its spoken name, beyond its two displayed digits');
  assert.ok(Math.abs(slowWordMs / shortWordMs - 2) < 0.01, 'Half-rate speech must approximately double the estimate');
  for (const [display, rate, estimateMs] of [['21', 0.9, twentyOneMs], ['mat', 0.45, slowWordMs]]) {
    const app = createReadingVoiceHarness({ useRealSpeechCompletion: true });
    app.word.display = display; app.run(`stored.settings.speechRate = ${rate}`);
    await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release(); app.startSpeech(0);
    app.advanceTime(estimateMs - 1);
    assert.equal(app.element('self-check-yes').disabled, true, `${display}/${rate}: estimate must not finish early`);
    app.advanceTime(1);
    assert.equal(app.element('self-check-yes').disabled, false, `${display}/${rate}: estimate must open choices`);
    assert.equal(app.activeUtterance.text, display);
    assert.equal(app.activeUtterance.active, true);
    assert.equal(app.observations.speech.length, 1);
    assert.equal(app.word.totalAttempts, 0);
  }
}

async function testRecapFirstConfirmationAndHelpedRepeatAreFeedbackOnly() {
  for (const repeat of [false, true]) {
    const app = createReadingVoiceHarness();
    await app.prepare(); app.practice.recapId = app.word.id;
    const originalWord = JSON.stringify(app.word);
    await askSelfCheck(app);
    if (repeat) { await app.beginAttempt(); app.deliverAudio(); app.release(); }
    else app.run('confirmFirstSpokenAttempt()');
    assert.equal(JSON.stringify(app.word), originalWord, 'Recap may not alter item progress');
    assert.equal(app.practice.roundCorrect, 0);
    assert.equal(app.practice.roundSilentCorrect, 0);
    assert.equal(app.practice.completedCount, 0);
    assert.equal(app.observations.savedProgress, 0);
  }
}

async function testLevelAdvancesOnlyAfterSecondQualifyingFirstConfirmation() {
  const app = createReadingVoiceHarness({ wordDisplay: 'cat', encounterRole: 'focus' });
  app.run("wordFocusItems(1).filter(item => item.id !== gs.currentItem.id).forEach(item => { item.mastered = true; })");
  await app.prepare(); await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.run('checkLevelComplete()'), null);
  assert.equal(app.run('stored.settings.wordLevel'), 1);
  assert.equal(app.run('wordCourseFocusComplete(1)'), false,
    'Every focus word must earn mastery before the active course level advances');
  app.beginEncounter(); await askSelfCheck(app); app.run('confirmFirstSpokenAttempt()');
  assert.equal(app.run('wordCourseFocusComplete(1)'), true);
  assert.equal(app.run('checkLevelComplete()'), 'level_complete');
  assert.equal(app.run('stored.settings.wordLevel'), 2);
}

async function testSelfCheckUiKeepsTheSameMicrophoneAndControlsYesVisibility() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  const microphoneButton = app.element('mic-button');
  assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
  await askSelfCheck(app);
  assert.equal(app.element('self-check-yes').classList.contains('hidden'), false);
  assert.equal(app.element('mic-button'), microphoneButton);
  assert.equal(app.element('hear-button').classList.contains('disabled'), true);
  await app.beginAttempt();
  assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
  assert.equal(app.element('mic-button'), microphoneButton);
  app.deliverAudio(); app.release();
  assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
  assert.equal(app.run('micState'), 'waiting');
}

async function testFailedAnswerSpeechRequiresHearingTheWordBeforeYes() {
  for (const speechFailure of ['onerror:synthesis-failed', 'WATCHDOG', 'unavailable']) {
    const app = createReadingVoiceHarness();
    await app.prepare(); await app.beginAttempt(); app.deliverAudio(); app.release();
    const originalAssistance = app.practice.spokenWordEncounter.firstAttemptAssistance;
    await app.finishSpeech(undefined, speechFailure);
    assert.equal(app.practice.spokenWordEncounter.phase, 'answer-error', speechFailure);
    assert.equal(app.run('micState'), 'answer-error');
    assert.equal(app.element('self-check-yes').classList.contains('hidden'), true);
    assert.equal(app.element('mic-button').disabled, true);
    assert.equal(app.element('hear-button').disabled, false);
    app.element('self-check-yes').dispatch('click');
    assert.equal(app.word.totalAttempts, 0, 'An unheard word must never expose a successful Yes');
    const microphoneRequestCount = app.observations.microphoneRequests.length;
    app.element('hear-button').dispatch('click');
    assert.equal(app.practice.spokenWordEncounter.phase, 'answer');
    assert.equal(app.observations.speech.at(-1).text, 'mat');
    assert.equal(app.element('self-check-question').textContent, 'mat. Got it?');
    assert.equal(app.observations.microphoneRequests.length, microphoneRequestCount,
      'Retrying comparison speech must reuse the already recorded first answer');
    assert.equal(app.practice.spokenWordEncounter.firstAttemptAssistance, originalAssistance);
    await app.finishSpeech();
    assert.equal(app.practice.spokenWordEncounter.phase, 'confirming');
    assert.equal(app.observations.speech.at(-1).text, 'Got it?');
    app.element('self-check-yes').dispatch('click');
    assert.equal(app.word.totalAttempts, 1);
    assert.equal(app.word.masteryConfirmationCount, 1);
  }
}

async function testChildStartupDoesNotLoadTheAdultRecognitionModel() {
  for (const modelOptions of [
    { localRecognizerLibraryMissing: true },
    { localModelLoadError: new Error('Adult recognition model unavailable') },
  ]) {
    const app = createReadingVoiceHarness(modelOptions);
    await app.run('init()');
    assert.equal(app.observations.modelLoads, 0, 'Child startup must not request the adult recognition model');
    assert.equal(app.observations.imageManifestLoads, 1);
    assert.equal(app.observations.pickerRenders, 1, 'Child startup must reach the practice picker without adult ASR');
    assert.equal(app.observations.microphoneRequests.length, 0);
    await app.prepare(); await askSelfCheck(app); app.element('self-check-yes').dispatch('click');
    assert.equal(app.word.totalCorrect, 1);
  }
}

async function testOpeningTuningLoadsItsModelLazilyAndRejectsStaleStatusCallbacks() {
  const app = createReadingVoiceHarness();
  await app.run('init()');
  assert.equal(app.observations.modelLoads, 0);
  await app.run('openTuning()');
  assert.equal(app.observations.modelLoads, 1);
  assert.match(app.element('tune-engine-status').textContent, /ready/i);
  assert.equal(app.observations.microphoneRequests.length, 0, 'Opening adult tuning must not request microphone access');
  await app.run('openTuning()');
  assert.equal(app.observations.modelLoads, 1, 'Reopening adult tuning must reuse its loaded model');

  const localModelPermission = deferredPermission();
  const delayed = createReadingVoiceHarness({ localModelPermission });
  const pendingTuning = delayed.run('openTuning()');
  const loadingMessage = delayed.element('tune-engine-status').textContent;
  delayed.run("showScreen('picker')");
  localModelPermission.resolve(); await pendingTuning;
  assert.equal(delayed.element('tune-engine-status').textContent, loadingMessage,
    'A model callback after leaving tuning must not write a hidden-screen status');
}

async function testTuningCaptureFailuresClearTheListeningRowAndPublishTheError() {
  for (const captureOptions of [
    { microphonePermissionError: permissionDenied },
    { audioProcessorCreationError: new Error('Tuning audio processor unavailable') },
  ]) {
    const app = createReadingVoiceHarness(captureOptions);
    await app.run('initVosk()');
    await app.run("armAudition('word:mat')");
    assert.equal(app.run('auditionState'), 'idle');
    assert.equal(app.run('auditionRowId'), null);
    assert.deepEqual(app.observations.tuningListeningRows.at(-1), { wordId: 'word:mat', listening: false });
    assert.equal(app.observations.tuningErrorRows.at(-1)?.wordId, 'word:mat');
    assert.match(app.observations.tuningErrorRows.at(-1)?.message || '', /microphone|capture/i);
    assert.equal(app.observations.tuningResults.length, 0);
    assert.equal(app.word.totalAttempts, 0);
    assert.equal(app.activeTimersWithDelay(6000).length, 0);
    if (captureOptions.audioProcessorCreationError) assert.equal(app.microphoneTrack.stopped, true);
  }
}

function createPracticeOrderHarness() {
  const context = vm.createContext({
    console, Math: { ...Math, random: () => 0.999, min: Math.min, max: Math.max, ceil: Math.ceil },
    stored: { settings: { roundSize: 1, knownStarterWordIds: ['word:mat'] },
      items: createWordItemFixtures(), wordCourse: null },
    saveStored() {},
  });
  vm.runInContext([wordCourseSource, wordPracticeSource,
    readingAppSection('// ROUND BUILDING', '// GAME STATE'),
    'stored.wordCourse = createWordCourseProgress();'].join('\n'), context,
    { filename: 'app.js practice order', timeout: 1000 });
  return expression => vm.runInContext(expression, context, { timeout: 1000 });
}

async function testHelpedAnswersReturnToNumberPracticeAndTheActiveFocusBank() {
  const run = createPracticeOrderHarness();
  const numberPick = run(`buildNumberRound([
    { id: 'num:1', kind: 'number', display: '1', totalAttempts: 3, mastered: false, lastResult: 'correct' },
    { id: 'num:2', kind: 'number', display: '2', totalAttempts: 2, mastered: false, lastResult: 'helped' }
  ])[0].id`);
  assert.equal(numberPick, 'num:2', 'A helped number must return before an ordinary correct number');
  run("Object.assign(stored.items['word:cat'], { totalAttempts: 2, lastResult: 'helped' });");
  const wordRound = run('buildRound("words", 1)');
  const expectedRoles = run('Array(WORD_COURSE.roundRecipe.openingCount).fill("familiar").concat(Array(WORD_COURSE.roundRecipe.focusCount).fill("focus"), Array(WORD_COURSE.roundRecipe.closingCount).fill("familiar"))');
  assert.deepEqual(Array.from(wordRound.encounters, encounter => encounter.role), Array.from(expectedRoles),
    'The active word course must keep its familiar/focus/familiar sequence');
  assert.ok(wordRound.ruleIds.includes('word:cat'), 'A helped focus word remains unmastered and returns for practice');
  assert.equal(wordRound.ruleFocusId, 'short-a');
  const openingClosingWordIds = new Set(run('wordOpeningClosingItems(1).map(item => item.id)'));
  assert.ok(wordRound.encounters.filter(encounter => encounter.role === 'familiar').every(encounter => openingClosingWordIds.has(encounter.item.id)),
    'The easy sections draw from known words and the authorized level-one supplement');
  const openingCount = run('WORD_COURSE.roundRecipe.openingCount');
  const closingCount = run('WORD_COURSE.roundRecipe.closingCount');
  assert.equal(new Set(wordRound.encounters.slice(0, openingCount).map(encounter => encounter.item.id)).size, openingCount,
    'Each opening word must be selected without replacement');
  assert.equal(new Set(wordRound.encounters.slice(-closingCount).map(encounter => encounter.item.id)).size, closingCount,
    'Each closing word must be selected without replacement');
  assert.ok(wordRound.encounters.every((encounter, index, encounters) => !index || encounter.item.id !== encounters[index - 1].item.id),
    'Easy-section boundaries must not repeat the neighboring focus word');
  const laterFocusWords = run('buildRound("words", 1).ruleIds');
  assert.ok(laterFocusWords.includes('word:bag') && laterFocusWords.includes('word:jam'),
    'The next round rotates through the remaining declared focus words');
  run('stored.settings.knownStarterWordIds = []');
  const freshRound = run('buildRound("words", 1)');
  const levelOneWordIds = new Set(run('wordCourseLevel(1).focusWordIds'));
  assert.equal(freshRound.encounters.length, expectedRoles.length, 'Fresh setup starts a complete word round without a starter-choice gate');
  assert.ok(freshRound.encounters.filter(encounter => encounter.role === 'familiar').every(encounter => levelOneWordIds.has(encounter.item.id)),
    'Fresh setup uses only the declared level-one words for its easy sections');
  assert.equal(new Set(freshRound.encounters.slice(0, openingCount).map(encounter => encounter.item.id)).size, openingCount);
  assert.equal(new Set(freshRound.encounters.slice(-closingCount).map(encounter => encounter.item.id)).size, closingCount);
  assert.ok(freshRound.encounters.every((encounter, index, encounters) => !index || encounter.item.id !== encounters[index - 1].item.id));
  assert.equal(run("needsMorePractice({ lastResult: 'miss' })"), true, 'Historical misses must retain their priority');
  assert.equal(run("needsMorePractice({ lastResult: 'helped' })"), true);
  assert.equal(run("needsMorePractice({ lastResult: 'correct' })"), false);
}

async function testAllDoneDelayedSpeechCannotInterruptAnotherScreen() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  app.practice.originalSize = 1; app.practice.completedCount = 1; app.practice.roundCorrect = 1;
  app.run('showAllDone(null)');
  const roundEndTimers = app.activeTimersWithDelay(600);
  assert.equal(roundEndTimers.length, 1);
  const spokenBeforeLeaving = app.observations.speech.length;
  app.run("showScreen('picker')");
  app.fireTimer(roundEndTimers[0]);
  assert.equal(app.observations.speech.length, spokenBeforeLeaving,
    'The previous all-done timer must not speak after leaving its screen');
  app.run('showAllDone(null)');
  const currentRoundEndTimer = app.activeTimersWithDelay(600).at(-1);
  app.fireTimer(currentRoundEndTimer);
  assert.equal(app.observations.speech.length, spokenBeforeLeaving + 1,
    'The current all-done screen still speaks its own round feedback');
}

async function testAutomaticWordGuidanceFinishesBeforeTheMicrophoneBecomesReady() {
  for (const guidance of ['recap', 'known-word', 'first-rule']) {
    const app = createReadingVoiceHarness(guidance === 'first-rule' ?
      { wordDisplay: 'cat', encounterRole: 'focus' } : {});
    await app.prepare();
    if (guidance === 'recap') app.practice.recapId = app.word.id;
    if (guidance === 'known-word') app.word.mastered = true;
    app.run('presentItem(gs.currentItem)');
    assert.equal(app.run('micState'), 'waiting', `${guidance} guidance must complete before recording`);
    assert.equal(app.element('mic-button').disabled, true);
    if (guidance === 'first-rule') {
      assert.equal(app.observations.speech.at(-1).text, 'Letter A.');
      assert.equal(app.observations.speech.at(-1).rate, 0.72);
      await app.finishSpeech();
      app.advanceTime(219);
      assert.equal(app.run('micState'), 'waiting');
      assert.equal(app.run('stored.wordCourse.ruleLessonsHeard["short-a"]'), undefined);
      app.advanceTime(1);
      await app.finishSpeech();
      assert.match(app.observations.recordedSounds.at(-1).url, /\/a\.mp3\?v=4$/);
      app.observations.recordedSounds.at(-1).onended();
      assert.equal(app.observations.speech.at(-1).text, 'cat. map.');
      assert.equal(app.run('micState'), 'waiting', 'A recorded sound cannot finish the complete spoken rule');
      assert.equal(app.run('stored.wordCourse.ruleLessonsHeard["short-a"]'), undefined);
    }
    await app.finishSpeech();
    assert.equal(app.run('micState'), 'ready');
    if (guidance === 'first-rule') {
      assert.equal(app.run('stored.wordCourse.ruleLessonsHeard["short-a"]'), true);
      app.run('stored.wordCourse.ruleLessonsHeard["short-a"] = false');
    }
    app.run('presentItem(gs.currentItem)');
    const obsoleteGuidanceIndex = app.observations.speech.length - 1;
    app.run("showScreen('picker')");
    const microphoneStateAfterLeaving = app.run('micState');
    await app.finishSpeech(obsoleteGuidanceIndex);
    assert.equal(app.run('micState'), microphoneStateAfterLeaving,
      'Guidance completion after navigation cannot change the microphone state');
    assert.equal(app.practice.spokenWordEncounter, null);
  }
}

function createSpeechCompletionHarness({ cancelDispatchesError = true } = {}) {
  const utterances = [];
  const completionCallbacks = [];
  const speechTimers = new Map();
  let nextSpeechTimerId = 1;
  let activeUtterance = null;
  let cancelCount = 0;
  class TestSpeechUtterance {
    constructor(text) { this.text = text; this.active = false; utterances.push(this); }
  }
  const speechSynthesis = {
    speak(utterance) { activeUtterance = utterance; utterance.active = true; },
    cancel() {
      cancelCount++;
      const cancelledUtterance = activeUtterance;
      activeUtterance = null;
      if (!cancelledUtterance) return;
      cancelledUtterance.active = false;
      if (cancelDispatchesError) cancelledUtterance.onerror?.({ error: 'canceled' });
    },
  };
  const context = vm.createContext({
    window: { speechSynthesis }, speechSynthesis, SpeechSynthesisUtterance: TestSpeechUtterance,
    getVoice: () => null, stored: { settings: { speechRate: 0.9 } }, DBG() {}, activeRuleLessonPlayback:null,
    speechCompleted: how => completionCallbacks.push({ how, activeUtterance }),
    setTimeout(callback) {
      const timerId = nextSpeechTimerId++;
      speechTimers.set(timerId, { callback, cancelled: false });
      return timerId;
    },
    clearTimeout(timerId) { if (speechTimers.has(timerId)) speechTimers.get(timerId).cancelled = true; },
  });
  vm.runInContext(readingAppSection('let currentUtterance = null;', 'const speakWord'), context,
    { filename: 'app.js real speech completion', timeout: 1000 });
  return {
    utterances, completionCallbacks, speechTimers,
    run: expression => vm.runInContext(expression, context, { timeout: 1000 }),
    get activeUtterance() { return activeUtterance; },
    get cancelCount() { return cancelCount; },
    fireTimer: timerId => speechTimers.get(timerId).callback(),
  };
}

async function testSpeechWatchdogStopsVoiceBeforeCallbackAndCannotStopANewerUtterance() {
  const speech = createSpeechCompletionHarness();
  speech.run("speak('Listen to this word.', 1, speechCompleted)");
  const timedOutUtterance = speech.utterances[0];
  assert.equal(timedOutUtterance.active, true);
  const cancelCountBeforeTimeout = speech.cancelCount;
  speech.fireTimer(1);
  assert.equal(speech.cancelCount, cancelCountBeforeTimeout + 1);
  assert.equal(timedOutUtterance.active, false, 'The watchdog must stop the actual voice before progressing');
  assert.equal(speech.completionCallbacks.length, 1, 'Cancellation error reentry must not call completion twice');
  assert.equal(speech.completionCallbacks[0].how, 'WATCHDOG');
  assert.equal(speech.completionCallbacks[0].activeUtterance, null,
    'The completion callback must observe an already stopped utterance');
  assert.equal(speech.run('currentUtterance'), null);
  timedOutUtterance.onerror({ error: 'late-cancellation' });
  timedOutUtterance.onend();
  speech.fireTimer(1);
  assert.equal(speech.completionCallbacks.length, 1, 'Late end/error/timeout callbacks must remain one completion');

  const stale = createSpeechCompletionHarness({ cancelDispatchesError: false });
  stale.run("speak('Previous guidance.', 1, speechCompleted)");
  stale.run("speak('Current question.', 1, speechCompleted)");
  const currentQuestion = stale.utterances[1];
  const cancelCountBeforeStaleTimeout = stale.cancelCount;
  stale.fireTimer(1);
  assert.equal(stale.cancelCount, cancelCountBeforeStaleTimeout,
    'A stale timeout without a cancellation event must not cancel the current voice');
  assert.equal(stale.activeUtterance, currentQuestion);
  assert.equal(currentQuestion.active, true);
  assert.equal(stale.run('currentUtterance'), currentQuestion,
    'A stale completion must preserve ownership of the current utterance');
  currentQuestion.onend();
  assert.deepEqual(stale.completionCallbacks.map(completion => completion.how), ['WATCHDOG', 'onend']);
}

const readingVoiceChecks = [
  testPhysicalCaptureAsksAfterPauseWithoutSpeechRecognition,
  testHelpedRepeatWaitsForPauseBeforeScoringAndFeedback,
  testLeavingPracticeAndNewEncountersInvalidatePendingReleasePauses,
  testSilenceIsValidCaptureButMissingOrEndedCaptureIsUnscored,
  testSecondEncounterEarnsGoldAndPurpleWithoutDuplicateConfirmations,
  testHelpUsageIsFrozenBeforeFeedbackAndCountsDistinctTrophyRequirements,
  testSameMicrophoneRepeatCompletesAsHelpedAndPreservesEarnedDots,
  testRepeatWithoutSamplesRemainsUnscoredAndRetainsRepeatReady,
  testFirstAndRepeatCancellationDuringResumeNeverStartLateCapture,
  testCancelDuringPhysicalCaptureDiscardsFirstAndRepeatAudio,
  testRepeatResumeFailurePreservesTheEncounterAndFirstAssistance,
  testMicrophoneFailuresAndLatePermissionNeverScore,
  testReleaseAndCancelDuringPermissionDoNotStartDelayedRecording,
  testPreviouslyEarnedTrophiesRemainPermanentDuringNewSelfChecks,
  testOldAnswerAndQuestionCallbacksCannotInterruptLaterPractice,
  testYesDuringQuestionStopsVoiceAndPreservesOrdinaryAndTrophyFeedback,
  testRepeatDuringQuestionStopsVoiceBeforeMicrophoneResumeAndSamples,
  testQuestionEndErrorAndWatchdogLeaveChoicesAvailable,
  testEstimatedAnswerEndStartsFromPlaybackAndPrecedesNativeCompletion,
  testTerminalAnswerBoundaryOpensChoicesWithoutInterruptingTheWord,
  testYesAtEstimatedAnswerEndCancelsSafelyBeforeNativeCompletion,
  testRepeatAtEstimatedAnswerEndCancelsBeforeCaptureAndRejectsLateSpeech,
  testGenuineAnswerFailureAfterEstimatedEndRevokesChoices,
  testAnswerWithoutPlaybackStartStaysDisabledUntilSuccessfulNativeEnd,
  testStaleAnswerEstimateAndPlaybackEventsCannotOpenAnotherAnswer,
  testAnswerEstimateAccountsForNumbersLongerWordsAndSlowerPlayback,
  testRecapFirstConfirmationAndHelpedRepeatAreFeedbackOnly,
  testLevelAdvancesOnlyAfterSecondQualifyingFirstConfirmation,
  testSelfCheckUiKeepsTheSameMicrophoneAndControlsYesVisibility,
  testFailedAnswerSpeechRequiresHearingTheWordBeforeYes,
  testChildStartupDoesNotLoadTheAdultRecognitionModel,
  testOpeningTuningLoadsItsModelLazilyAndRejectsStaleStatusCallbacks,
  testTuningCaptureFailuresClearTheListeningRowAndPublishTheError,
  testHelpedAnswersReturnToNumberPracticeAndTheActiveFocusBank,
  testAllDoneDelayedSpeechCannotInterruptAnotherScreen,
  testAutomaticWordGuidanceFinishesBeforeTheMicrophoneBecomesReady,
  testSpeechWatchdogStopsVoiceBeforeCallbackAndCannotStopANewerUtterance,
  testMissingLocalEngineFailsExplicitly,
  testFailedLocalModelDownloadFailsExplicitly,
  testTuningResumesAndCapturesLocalAudio,
  testTuningCancelDuringResumeNeverStartsCapture,
  testTuningPriorCallbacksAndClosedScreenCannotWriteResults,
  testTuningStreamingEndpointsWaitForExplicitFinal,
  testMissingTuningFinalReportsEngineFailureWithoutJudgment,
  testTuningRecognizerErrorsNeverPublishJudgment,
];

let failingVoiceCheckCount = 0;
for (const check of readingVoiceChecks) {
  try {
    await check();
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failingVoiceCheckCount++;
    console.error(`FAIL ${check.name}\n${error.stack}`);
  }
}
console.log(`Reading self-check and grown-up tuning: ${readingVoiceChecks.length - failingVoiceCheckCount}/${readingVoiceChecks.length} checks passed.`);
if (failingVoiceCheckCount) process.exitCode = 1;
