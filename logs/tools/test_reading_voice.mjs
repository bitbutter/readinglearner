// Runs the reading app's real microphone, Vosk and grading code without packages.
// Run from any directory: node logs/tools/test_reading_voice.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const readingAppSource = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');

function readingAppSection(startMarker, endMarker) {
  const sectionStart = readingAppSource.indexOf(startMarker);
  const sectionEnd = readingAppSource.indexOf(endMarker, sectionStart);
  assert.ok(sectionStart >= 0 && sectionEnd > sectionStart,
    `Reading app test section missing: ${startMarker} / ${endMarker}`);
  return readingAppSource.slice(sectionStart, sectionEnd);
}

const testedReadingAppSource = [
  readingAppSection('// VOSK SPEECH RECOGNITION', '// AUDITION (grown-up tuning)'),
  readingAppSection('async function armAudition(itemId)', '// ROUND BUILDING'),
  readingAppSection('function closeTuning()', 'function setTuneTab(tab)'),
  readingAppSection('function handleAnswer(correct)', 'function endRound()'),
  readingAppSection('function onRecognitionResult(transcripts)', '// UI'),
  readingAppSection("  const micBtn = document.getElementById('mic-button');",
    "  document.getElementById('tomorrow-text').addEventListener"),
].join('\n');

function deferredPermission() {
  let resolve, reject;
  const promise = new Promise((fulfill, fail) => { resolve = fulfill; reject = fail; });
  return { promise, resolve, reject };
}

function createReadingVoiceHarness(options = {}) {
  const timerCallbacks = new Map();
  let nextTimerId = 1;
  const word = {
    id: 'word:mat', display: 'mat', kind: 'word', accepted: ['mat'],
    totalAttempts: 0, totalCorrect: 0, successStreak: 0, unaidedStreak: 0,
    silentCorrect: 0, decoded: false, mastered: false, flawless: false, auditionConfs: [],
  };
  const practice = {
    currentSet: 'words', currentItem: word, awaitingResult: false,
    recapId: null, hearPressed: false, retryCount: 0, letterTaps: 0,
    completedCount: 0, roundCorrect: 0, roundSilentCorrect: 0,
    newTrophies: 0, ruleIds: [], ruleMissed: false, recycled: new Set(), queue: [],
  };
  const observations = {
    contexts: [], recognizers: [], microphoneRequests: [], microphoneStatuses: [],
    speech: [], displayedTranscripts: [], savedProgress: 0, browserRecognizerStarts: 0,
    presentedWords: [], nextWordCount: 0, auditMessages: [],
    tuningListeningRows: [], tuningResults: [], tuningErrorRows: [],
  };
  const microphoneTrack = { stopped: false, stop() { this.stopped = true; } };
  const microphoneStream = { getTracks: () => [microphoneTrack] };

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

  const localSpeechModel = { KaldiRecognizer: LocalWordRecognizer, setLogLevel() {} };
  const modelApi = { async createModel() {
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
    console, URL, Promise, Date,
    document: { getElementById: pageElement },
    window: {
      Vosk: options.localRecognizerLibraryMissing ? undefined : modelApi, AudioContext: MicrophoneAudioContext,
      SpeechRecognition: BrowserSpeechRecognizer, webkitSpeechRecognition: BrowserSpeechRecognizer,
      location: { href: 'https://example.invalid/readinglearner/index.html' },
    },
    AudioContext: MicrophoneAudioContext, Vosk: modelApi,
    navigator: { mediaDevices: { async getUserMedia(configuration) {
      observations.microphoneRequests.push(configuration);
      if (options.microphonePermissionError) throw options.microphonePermissionError;
      return options.microphonePermission ? options.microphonePermission.promise : microphoneStream;
    } } },
    gs: practice,
    stored: { items: { [word.id]: word }, settings: { retryCap: 2 } },
    kindForSet: set => set === 'numbers' ? 'number' : 'word',
    DBG: (...message) => observations.auditMessages.push(message),
    setTimeout(callback, milliseconds) {
      const timerId = nextTimerId++;
      timerCallbacks.set(timerId, { callback, milliseconds, cancelled: false });
      return timerId;
    },
    clearTimeout(timerId) {
      const timer = timerCallbacks.get(timerId);
      if (timer) timer.cancelled = true;
    },
    setHeardDisplay: text => observations.displayedTranscripts.push(text),
    saveStored: () => observations.savedProgress++,
    speak: (text, rate, finished) => observations.speech.push({ text, rate, finished }),
    speakPraise: finished => observations.speech.push({ text: 'Praise', finished }),
    speakCorrect: (display, finished) => observations.speech.push({ text: `This says ${display}.`, finished }),
    nextItem: () => observations.nextWordCount++,
    presentItem: currentWord => observations.presentedWords.push(currentWord.id),
    setRowListening: (wordId, listening) => observations.tuningListeningRows.push({ wordId, listening }),
    setRowResult: (wordId, status, message) => observations.tuningErrorRows.push({ wordId, status, message }),
    renderAuditionResult: (wordId, transcript, matched) => observations.tuningResults.push({ wordId, transcript, matched }),
    openGrownUp() {},
    flashScreen() {}, renderTrophyRow() {}, playTrophyChime() {}, burstStars() {}, cancelUnblock() {},
    playPling() {}, renderDots() {},
    PRAISE: ['Good'], TROPHY_PALETTES: { silver: [], gold: [], purple: [] },
  });

  if (!options.useRealMicrophoneUi) {
    context.setMicState = state => {
      observations.microphoneStatuses.push(state);
      context.requestedMicrophoneStatus = state;
      vm.runInContext('micState = requestedMicrophoneStatus', context);
    };
  }
  const testedMicrophoneUiSource = options.useRealMicrophoneUi
    ? readingAppSection('function armUnblock(ms)', 'function setHeardDisplay(text)') : '';
  vm.runInContext(testedReadingAppSource + '\n' + testedMicrophoneUiSource, context,
    { filename: 'app.js local reading voice', timeout: 1000 });

  const run = expression => vm.runInContext(expression, context, { timeout: 1000 });
  const latestRecognizer = () => run('voskRecognizer');
  return {
    run, word, practice, observations, microphoneTrack, microphoneStream, timerCallbacks,
    dispatchMicrophoneEvent: eventName => pageElement('mic-button').dispatch(eventName),
    microphoneStatusText: () => pageElement('mic-status').textContent,
    latestRecognizer,
    async prepare() {
      await run('initVosk()');
      run("createRoundRecognizer('words')");
      await run('openMicStream()');
      run("setMicState('ready')");
    },
    async beginAttempt() { await run('startListening()'); },
    deliverAudio(audioBuffer = { sampleRate: 16000, duration: 0.25 }) {
      const processor = run('scriptProc');
      assert.ok(processor?.onaudioprocess, 'Microphone processing must be connected');
      processor.onaudioprocess({ inputBuffer: audioBuffer });
      return audioBuffer;
    },
    release() { run('requestStopAndEvaluate()'); },
    fireTimer(timerId) {
      const timer = timerCallbacks.get(timerId);
      assert.ok(timer, `Timer ${timerId} must exist`);
      // Call even after cancellation to simulate a callback already queued by the browser.
      timer.callback();
    },
    activeTimersWithDelay(milliseconds) {
      return [...timerCallbacks].filter(([, timer]) => !timer.cancelled && timer.milliseconds === milliseconds)
        .map(([timerId]) => timerId);
    },
  };
}

const permissionDenied = Object.assign(new Error('Microphone access refused'), { name: 'NotAllowedError' });

async function testLocalMicrophoneAndRelease() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  await app.beginAttempt();
  assert.equal(app.run('micState'), 'listening');
  assert.equal(app.observations.browserRecognizerStarts, 0, 'Browser recognition must never start');
  assert.ok(app.observations.contexts.some(context => context.resumeCount > 0),
    'The first hold must resume the microphone AudioContext');
  const recognizer = app.latestRecognizer();
  assert.equal(recognizer.sampleRate, 16000);
  assert.ok(JSON.parse(recognizer.grammar).includes('mat'), 'The local grammar must include approved word spellings');
  const capturedAudio = app.deliverAudio();
  assert.equal(recognizer.acceptedAudio[0], capturedAudio, 'Real capture code must feed audio to local Vosk');
  app.release();
  assert.equal(app.run('micState'), 'evaluating');
  assert.equal(recognizer.finalRequests, 1, 'Releasing the button must request the final local transcript');
  recognizer.emitFinalResult('mat');
  assert.equal(app.word.totalAttempts, 1);
  assert.equal(app.word.totalCorrect, 1);
  assert.equal(app.word.mastered, true, 'Unaided correct reading must keep its existing progress behavior');
  recognizer.emitFinalResult('mat');
  app.run('evaluateVosk()');
  assert.equal(app.word.totalAttempts, 1, 'Duplicate finals must never grade an attempt twice');
}

async function testHelpDoesNotApproveWrongWords() {
  for (const help of [{ hearPressed: true, retryCount: 0 }, { hearPressed: false, retryCount: 1 }]) {
    const app = createReadingVoiceHarness();
    await app.prepare();
    Object.assign(app.practice, help);
    await app.beginAttempt();
    app.release();
    app.latestRecognizer().emitFinalResult('bad');
    assert.deepEqual(app.word.accepted, ['mat'], 'Hear and retry must never add a wrong transcript to approved spellings');
    assert.equal(app.word.totalCorrect, 0, 'A wrong word remains wrong after help');
    assert.equal(app.word.lastResult, 'miss');
    assert.equal(app.word.totalAttempts, 1);
    assert.equal(app.practice.completedCount, 0, 'A wrong first or second attempt must stay on the word');
    assert.ok(app.observations.speech.some(utterance => utterance.text === 'This says mat.'),
      'Wrong readings must preserve spoken teaching and retry');
  }

  const app = createReadingVoiceHarness();
  await app.prepare();
  app.practice.hearPressed = true;
  await app.beginAttempt();
  app.release();
  app.latestRecognizer().emitFinalResult('mat');
  assert.equal(app.word.totalCorrect, 1, 'Correct repetitions after help must still count as correct');
  assert.equal(app.word.mastered, false, 'A helped answer must not earn an unaided trophy');
  assert.deepEqual(app.word.accepted, ['mat']);
}

async function testEmptyAndUnknownAudioNeverAdvances() {
  for (const transcript of ['', '[unk]']) {
    const app = createReadingVoiceHarness();
    await app.prepare();
    const progressBeforeAttempt = JSON.stringify(app.word);
    await app.beginAttempt();
    app.deliverAudio();
    app.release();
    app.latestRecognizer().emitFinalResult(transcript);
    assert.equal(app.run('micState'), 'ready');
    assert.equal(JSON.stringify(app.word), progressBeforeAttempt, 'An empty result must leave progress unchanged');
    assert.equal(app.practice.completedCount, 0);
    assert.equal(app.observations.savedProgress, 0);
    assert.ok(app.observations.speech.some(utterance => /didn't hear you/i.test(utterance.text)));
  }
}

async function testOldAttemptCannotGradeNewAttempt() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  await app.beginAttempt();
  const oldRecognizer = app.latestRecognizer();
  app.release();
  const oldSettleTimers = [...app.timerCallbacks.keys()];
  oldRecognizer.emitFinalResult('');
  await app.beginAttempt();
  const newRecognizer = app.latestRecognizer();
  assert.notEqual(newRecognizer, oldRecognizer, 'A new recording must not reuse an old recognizer with pending results');
  oldRecognizer.emitFinalResult('mat');
  for (const timerId of oldSettleTimers) app.fireTimer(timerId);
  assert.equal(app.word.totalAttempts, 0, 'Previous callbacks must not grade the new recording');
  assert.equal(app.run('micState'), 'listening', 'Previous timers must not stop the new recording');
  app.release();
  newRecognizer.emitFinalResult('bad');
  assert.equal(app.word.totalCorrect, 0);
  assert.equal(app.word.totalAttempts, 1);
}

async function testRoundCloseRejectsLateCallbacks() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  await app.beginAttempt();
  const recognizer = app.latestRecognizer();
  app.release();
  const oldTimers = [...app.timerCallbacks.keys()];
  app.run('closeMicStream()');
  app.practice.currentItem = null;
  assert.doesNotThrow(() => recognizer.emitFinalResult('mat'), 'Closed round callbacks must be ignored');
  for (const timerId of oldTimers) assert.doesNotThrow(() => app.fireTimer(timerId));
  assert.equal(app.word.totalAttempts, 0);
  assert.equal(app.microphoneTrack.stopped, true);
  assert.equal(app.run('micStream'), null);
  assert.equal(app.run('voskRecognizer'), null);
}

async function testDeniedMicrophoneReportsPermissionProblem() {
  const app = createReadingVoiceHarness({ microphonePermissionError: permissionDenied });
  await app.prepare();
  await app.beginAttempt();
  assert.equal(app.run('sessionMicBlocked'), true);
  assert.notEqual(app.run('micState'), 'listening');
  assert.equal(app.run('micStream'), null);
  assert.equal(app.word.totalAttempts, 0);
  assert.ok(app.observations.speech.some(utterance => /allow microphone access/i.test(utterance.text)));
}

async function testLatePermissionResultStopsUnusedMicrophone() {
  const microphonePermission = deferredPermission();
  const app = createReadingVoiceHarness({ microphonePermission });
  await app.run('initVosk()');
  app.run("createRoundRecognizer('words')");
  const pendingCapture = app.run('openMicStream()');
  app.run('closeMicStream()');
  microphonePermission.resolve(app.microphoneStream);
  await pendingCapture;
  assert.equal(app.microphoneTrack.stopped, true, 'A permission result after round close must immediately stop its tracks');
  assert.equal(app.run('micStream'), null);
  assert.equal(app.run('scriptProc'), null);
  assert.equal(app.run('audioCtx'), null);
}

async function testAudioSetupFailureClosesPartialCapture() {
  const audioProcessorCreationError = new Error('Audio processor unavailable');
  const app = createReadingVoiceHarness({ audioProcessorCreationError });
  await app.prepare();
  await app.beginAttempt();
  assert.notEqual(app.run('micState'), 'listening', 'Failed capture setup must never report that the microphone is listening');
  assert.equal(app.microphoneTrack.stopped, true, 'Failed setup must close the acquired microphone tracks');
  assert.equal(app.run('micStream'), null);
  assert.equal(app.run('audioCtx'), null);
  assert.equal(app.word.totalAttempts, 0);
  assert.ok(app.observations.speech.some(utterance => /microphone/i.test(utterance.text)),
    'Failed microphone setup must give a visible or spoken explanation');
}

async function testSuspendedAudioResumeFailureIsReported() {
  const app = createReadingVoiceHarness({ audioContextResumeError: new Error('Audio capture cannot resume') });
  await app.prepare();
  await app.beginAttempt();
  assert.notEqual(app.run('micState'), 'listening', 'Failed AudioContext resume must never enable a recording');
  assert.equal(app.word.totalAttempts, 0);
  assert.ok(app.observations.speech.some(utterance => /microphone/i.test(utterance.text)),
    'AudioContext resume failure must explain the capture problem');
}

async function testRoundCloseDuringAudioResumeCannotRestartCapture() {
  const audioContextResumePermission = deferredPermission();
  const audioContextResumeStarted = deferredPermission();
  const app = createReadingVoiceHarness({ audioContextResumePermission, audioContextResumeStarted });
  await app.prepare();
  const pendingAttempt = app.beginAttempt();
  await audioContextResumeStarted.promise;
  assert.ok(app.observations.contexts.some(context => context.resumeCount > 0));
  app.run('closeMicStream()');
  app.practice.currentItem = null;
  audioContextResumePermission.resolve();
  await pendingAttempt;
  assert.notEqual(app.run('micState'), 'listening', 'Resuming audio after leaving a round must never start a recording');
  assert.equal(app.word.totalAttempts, 0);
  assert.equal(app.run('voskRecognizer'), null);
  assert.equal(app.microphoneTrack.stopped, true);
}

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
  await app.prepare();
  await app.run("armAudition('word:mat')");
  assert.equal(app.run('auditionState'), 'listening');
  assert.ok(app.observations.contexts.some(context => context.resumeCount > 0),
    'Holding the tuning microphone must resume its AudioContext');
  const recognizer = app.run('auditionRecognizer');
  assert.equal(recognizer.grammar, undefined, 'Parent tuning must preserve open-vocabulary local recognition');
  const capturedAudio = app.deliverAudio();
  assert.equal(recognizer.acceptedAudio[0], capturedAudio);
  assert.equal(app.latestRecognizer().acceptedAudio.length, 0, 'Tuning audio must not enter the child practice recognizer');
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
  await app.prepare();
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
  await app.prepare();
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

async function testPracticeReleaseAndCancelDuringResumeNeverStartsCapture() {
  for (const pointerEvent of ['pointerup', 'pointercancel']) {
    const audioContextResumePermission = deferredPermission();
    const audioContextResumeStarted = deferredPermission();
    const app = createReadingVoiceHarness({ audioContextResumePermission, audioContextResumeStarted });
    await app.prepare();
    const pendingCapture = app.beginAttempt();
    await audioContextResumeStarted.promise;
    assert.equal(app.run('micState'), 'warming');
    app.dispatchMicrophoneEvent(pointerEvent);
    assert.equal(app.run('micState'), 'ready');
    audioContextResumePermission.resolve();
    await pendingCapture;
    assert.equal(app.run('micState'), 'ready', `${pointerEvent} must invalidate pending capture startup`);
    assert.equal(app.activeTimersWithDelay(10000).length, 0);
    assert.equal(app.word.totalAttempts, 0);
  }
}

async function testPracticeStreamingEndpointsWaitForExplicitFinal() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  await app.beginAttempt();
  const recognizer = app.latestRecognizer();
  app.release();
  recognizer.emitResult('');
  recognizer.emitPartialResult('bad');
  recognizer.emitResult('bad');
  assert.equal(app.run('micState'), 'evaluating', 'Streaming endpoints after release must wait for the explicit flush reply');
  assert.equal(app.word.totalAttempts, 0, 'A queued streaming endpoint must never prematurely grade the word');
  assert.equal(app.observations.speech.length, 0, 'A queued empty endpoint must not prompt a premature retry');
  recognizer.emitFinalResult('mat');
  assert.equal(app.word.totalAttempts, 1);
  assert.equal(app.word.totalCorrect, 1);
  recognizer.emitFinalResult('mat');
  assert.equal(app.word.totalAttempts, 1);
}

async function testTuningStreamingEndpointsWaitForExplicitFinal() {
  const app = createReadingVoiceHarness();
  await app.prepare();
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

async function testMissingPracticeFinalReportsEngineFailureWithoutGrading() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  await app.beginAttempt();
  const recognizer = app.latestRecognizer();
  recognizer.emitResult('mat');
  app.release();
  app.fireTimer(app.run('settleTimer'));
  assert.equal(app.word.totalAttempts, 0, 'Streaming text alone must never count when the final flush does not arrive');
  assert.equal(app.word.totalCorrect, 0);
  assert.equal(app.run('micState'), 'ready');
  assert.ok(app.observations.speech.some(utterance => /speech|recognition|engine|could not check/i.test(utterance.text)),
    'A missing final response must report a speech engine failure');
  assert.equal(app.observations.speech.some(utterance => /didn't hear you/i.test(utterance.text)), false,
    'An engine timeout must not be presented as an empty child recording');
  recognizer.emitFinalResult('mat');
  assert.equal(app.word.totalAttempts, 0, 'A final arriving after the error must be discarded');
}

async function testMissingTuningFinalReportsEngineFailureWithoutJudgment() {
  const app = createReadingVoiceHarness();
  await app.prepare();
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

async function testPracticeRecognizerErrorsNeverGradeTheWord() {
  for (const releaseBeforeError of [false, true]) {
    const app = createReadingVoiceHarness();
    await app.prepare();
    await app.beginAttempt();
    const recognizer = app.latestRecognizer();
    recognizer.emitResult('mat');
    if (releaseBeforeError) app.release();
    recognizer.emitError('Injected local recognizer failure');
    assert.equal(app.word.totalAttempts, 0, 'A failed recognizer must never grade buffered text');
    assert.equal(app.run('micState'), 'ready');
    assert.ok(app.observations.speech.some(utterance => /speech|recognition|engine|could not check/i.test(utterance.text)),
      'A local recognizer error must explain the engine failure');
    recognizer.emitFinalResult('mat');
    for (const timerId of app.timerCallbacks.keys()) app.fireTimer(timerId);
    assert.equal(app.word.totalAttempts, 0);
  }
}

async function testTuningRecognizerErrorsNeverPublishJudgment() {
  for (const releaseBeforeError of [false, true]) {
    const app = createReadingVoiceHarness();
    await app.prepare();
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

async function testRealMicrophoneUiCancelsWatchdogsAfterStateTransitions() {
  const audioContextResumePermission = deferredPermission();
  const audioContextResumeStarted = deferredPermission();
  const app = createReadingVoiceHarness({ useRealMicrophoneUi: true,
    audioContextResumePermission, audioContextResumeStarted });
  await app.prepare();
  const pendingCapture = app.beginAttempt();
  await audioContextResumeStarted.promise;
  const warmupWatchdogs = app.activeTimersWithDelay(14000);
  assert.equal(warmupWatchdogs.length, 1, 'Real UI must arm its watchdog during microphone warm-up');
  assert.equal(app.microphoneStatusText(), 'Get ready…');
  audioContextResumePermission.resolve();
  await pendingCapture;
  assert.equal(app.run('micState'), 'listening');
  assert.equal(app.microphoneStatusText(), 'Speak now!');
  assert.equal(app.timerCallbacks.get(warmupWatchdogs[0]).cancelled, true,
    'Entering listening must cancel the warm-up watchdog, including after a slow permission/resume step');
  assert.equal(app.activeTimersWithDelay(14000).length, 0);

  app.release();
  const finalisationWatchdogs = app.activeTimersWithDelay(14000);
  assert.equal(finalisationWatchdogs.length, 1, 'Real UI must arm its watchdog while finalising');
  app.latestRecognizer().emitFinalResult('mat');
  assert.equal(app.run('micState'), 'waiting');
  assert.equal(app.timerCallbacks.get(finalisationWatchdogs[0]).cancelled, true,
    'Entering waiting must cancel the finalisation watchdog');
  assert.equal(app.activeTimersWithDelay(14000).length, 0);
  assert.equal(app.word.totalCorrect, 1);
}

async function testPracticeErrorAfterLeavingTuningDoesNotWriteHiddenRow() {
  const app = createReadingVoiceHarness();
  await app.prepare();
  await app.run("armAudition('word:mat')");
  app.run('closeTuning()');
  assert.equal(app.run('auditionRowId'), null, 'Leaving tuning must clear the old word identity');
  assert.equal(app.run('auditionState'), 'idle');
  const tuningErrorsBeforePractice = app.observations.tuningErrorRows.length;
  await app.beginAttempt();
  assert.equal(app.run('micState'), 'listening');
  app.latestRecognizer().emitError('Injected practice failure after closing tuning');
  assert.equal(app.run('micState'), 'ready');
  assert.equal(app.word.totalAttempts, 0);
  assert.ok(app.observations.speech.some(utterance => /could not check/i.test(utterance.text)),
    'A practice failure after tuning must give the child its ordinary spoken recovery');
  assert.equal(app.observations.tuningErrorRows.length, tuningErrorsBeforePractice,
    'A practice failure must never write to the previous hidden tuning row');
}

const readingVoiceChecks = [
  testLocalMicrophoneAndRelease,
  testHelpDoesNotApproveWrongWords,
  testEmptyAndUnknownAudioNeverAdvances,
  testOldAttemptCannotGradeNewAttempt,
  testRoundCloseRejectsLateCallbacks,
  testDeniedMicrophoneReportsPermissionProblem,
  testLatePermissionResultStopsUnusedMicrophone,
  testAudioSetupFailureClosesPartialCapture,
  testSuspendedAudioResumeFailureIsReported,
  testRoundCloseDuringAudioResumeCannotRestartCapture,
  testMissingLocalEngineFailsExplicitly,
  testFailedLocalModelDownloadFailsExplicitly,
  testTuningResumesAndCapturesLocalAudio,
  testTuningCancelDuringResumeNeverStartsCapture,
  testTuningPriorCallbacksAndClosedScreenCannotWriteResults,
  testPracticeReleaseAndCancelDuringResumeNeverStartsCapture,
  testPracticeStreamingEndpointsWaitForExplicitFinal,
  testTuningStreamingEndpointsWaitForExplicitFinal,
  testMissingPracticeFinalReportsEngineFailureWithoutGrading,
  testMissingTuningFinalReportsEngineFailureWithoutJudgment,
  testPracticeRecognizerErrorsNeverGradeTheWord,
  testTuningRecognizerErrorsNeverPublishJudgment,
  testRealMicrophoneUiCancelsWatchdogsAfterStateTransitions,
  testPracticeErrorAfterLeavingTuningDoesNotWriteHiddenRow,
];

for (const check of readingVoiceChecks) {
  await check();
  console.log(`PASS ${check.name}`);
}
console.log(`Reading voice restoration: ${readingVoiceChecks.length} checks passed.`);
