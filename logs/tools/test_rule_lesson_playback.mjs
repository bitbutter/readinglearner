// Simulates the real spoken-rule sequence, native speech and recorded clips.
// Run: node logs/tools/test_rule_lesson_playback.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const courseSource = readFileSync(new URL('../../word-course.js', import.meta.url), 'utf8');
const practiceSource = readFileSync(new URL('../../word-practice.js', import.meta.url), 'utf8');
const reviewedCourse = JSON.parse(readFileSync(new URL('../../plans/word-levels-proposed.json', import.meta.url), 'utf8'));
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing app section: ${start}`);
  return source.slice(from, to);
}

function harness(options = {}) {
  const utterances = [], recordings = [], timers = new Map(), elements = new Map();
  let activeUtterance, saved = 0, timerSequence = 0;
  function element(name) {
    if (!elements.has(name)) {
      const listeners = new Map(), classes = new Set();
      elements.set(name, {
        textContent:'', children:[], dataset:{}, style:{ setProperty() {} }, disabled:false,
        set innerHTML(value) { this.children = []; this.markup = value; },
        get innerHTML() { return this.markup || ''; },
        classList:{ add:name => classes.add(name), remove:name => classes.delete(name),
          toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
          contains:name => classes.has(name) },
        appendChild(child) { this.children.push(child); return child; }, setAttribute() {},
        append(...children) { this.children.push(...children); },
        addEventListener:(name, callback) => listeners.set(name, callback),
        click:() => listeners.get('click')?.(),
      });
    }
    return elements.get(name);
  }
  class RuleSpeech {
    constructor(text) { this.text = text; }
  }
  class RuleSound {
    constructor(url) { this.url = url; this.paused = false; recordings.push(this); }
    play() { this.paused = false; return options.recordedSoundPlayError ? Promise.reject(options.recordedSoundPlayError) : Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const speechSynthesis = {
    speak(utterance) { activeUtterance = utterance; utterances.push(utterance); },
    cancel() {
      const oldUtterance = activeUtterance;
      activeUtterance = null;
      oldUtterance?.onerror?.({ error:'canceled' });
    },
  };
  const practice = { currentSet:'words', currentLevel:24, currentEncounterRole:'focus',
    ruleFocusId:'ai', currentItem:null, spokenWordEncounter:null, awaitingResult:false, ruleIds:[], recapId:null };
  const context = vm.createContext({
    window:{ speechSynthesis }, speechSynthesis, SpeechSynthesisUtterance:RuleSpeech, Audio:RuleSound,
    gs:practice, micState:'ready', stored:{ wordCourse:{id:'one-focus-word-course-v1',ruleLessonsHeard:{}}, settings:{ speechRate:0.9 } },
    spokenWordEncounterSequence:0, spokenAttemptGeneration:0, maxListenTimer:null,
    getVoice:() => null, cancelUnblock() {}, DBG() {}, saveStored() { saved++; },
    renderDots() {}, renderTrophyRow() {}, renderConfirmationProgress() {},
    document:{ getElementById:element, createElement:tag => element(Symbol(tag)),
      createDocumentFragment:() => element(Symbol('fragment')) },
    setTimeout(callback, milliseconds) { const id = ++timerSequence; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout:id => timers.delete(id),
  });
  vm.runInContext([
    courseSource, practiceSource,
    section('// Isolated phonetic letter sounds', 'function triggerSoundSpan'),
    section('const letterAudioCache = {}', '// CONTENT'),
    section('let currentUtterance = null;', '// MICROPHONE CAPTURE AND TUNING RECOGNITION'),
    section('function presentItem(item)', 'function confirmFirstSpokenAttempt'),
    section('function setMicState(state)', 'function playPling()'),
    section('  // Hear button', "  document.getElementById('self-check-yes')"),
  ].join('\n'), context);
  const run = expression => vm.runInContext(expression, context);
  return {
    run, context, practice, utterances, recordings, timers, element,
    get saved() { return saved; },
    begin(word = 'rain', role = 'focus') {
      practice.currentItem = { id:'word:' + word, display:word, kind:'word' };
      const focus = vm.runInContext(`WORD_COURSE.levels.find(level => level.focusWords.includes(${JSON.stringify(word)}))`, context);
      assert.ok(focus, 'The test word must belong to the active course.');
      practice.currentLevel = focus.level;
      practice.ruleFocusId = focus.id;
      practice.currentEncounterRole = role;
      run('beginWordEncounter(gs.currentItem)');
      run("setMicState('ready')");
    },
    start(focusId = 'ai') { run(`startRuleLessonPlayback(${JSON.stringify(focusId)}, gs.currentItem)`); },
    finishSpeech(how = 'onend', utterance = utterances.at(-1)) {
      if (utterance === activeUtterance) activeUtterance = null;
      if (how === 'onend') utterance.onend?.();
      else utterance.onerror?.({ error:how });
    },
    finishSpeechPause() {
      const pendingPause = [...timers.entries()].find(([, timer]) => timer.milliseconds === 220);
      assert.ok(pendingPause, 'The letter name must own a 220 ms pause.');
      timers.delete(pendingPause[0]);
      pendingPause[1].callback();
    },
    reachGuidance() {
      this.finishSpeech(); this.finishSpeechPause();
      this.finishSpeech(); this.finishSpeechPause();
    },
    reachSound() { this.reachGuidance(); this.finishSpeech(); },
  };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('Paced letter names, guidance, recorded sound, example, then heard', () => {
  const app = harness(); app.begin(); app.start();
  assert.equal(app.run('micState'), 'waiting');
  assert.equal(app.element('mic-button').disabled, true);
  assert.equal(app.element('hear-button').disabled, false);
  app.reachSound();
  assert.deepEqual(app.utterances.map(utterance => utterance.text), [
    'Letter A.', 'Letter I.', 'In these words, these letters work together. Listen.',
  ]);
  assert.deepEqual(app.utterances.map(utterance => utterance.rate), [0.72, 0.72, 0.9]);
  assert.match(app.recordings[0].url, /\/ay\.mp3\?v=4$/);
  assert.equal(app.run('stored.wordCourse.ruleLessonsHeard.ai'), undefined);
  assert.equal(app.saved, 0);
  app.recordings[0].onended();
  assert.equal(app.utterances.at(-1).text, 'rain. pain.');
  assert.equal(app.saved, 0);
  app.finishSpeech();
  assert.equal(app.run('stored.wordCourse.ruleLessonsHeard.ai'), true);
  assert.equal(app.saved, 1);
  assert.equal(app.run('micState'), 'ready');
});

test('A completed letter name waits for its pause before continuing', () => {
  const app = harness(); app.begin(); app.start();
  assert.equal(app.utterances.at(-1).text, 'Letter A.');
  app.finishSpeech();
  assert.equal(app.utterances.length, 1);
  assert.equal(app.recordings.length, 0);
  assert.equal(app.saved, 0);
  assert.equal(app.run('micState'), 'waiting');
  app.finishSpeechPause();
  assert.equal(app.utterances.at(-1).text, 'Letter I.');
});

test('New word cancels a letter pause and rejects a queued stale timer', () => {
  const app = harness(); app.begin(); app.start(); app.finishSpeech();
  const oldPause = [...app.timers.values()].find(timer => timer.milliseconds === 220).callback;
  app.begin('turn');
  assert.equal([...app.timers.values()].some(timer => timer.milliseconds === 220), false);
  oldPause();
  assert.equal(app.utterances.length, 1);
  assert.equal(app.saved, 0);
  assert.equal(app.practice.currentItem.display, 'turn');
});

test('Replay during a letter pause cannot continue the superseded lesson', () => {
  const app = harness(); app.begin(); app.start(); app.finishSpeech();
  const oldPause = [...app.timers.values()].find(timer => timer.milliseconds === 220).callback;
  app.start();
  oldPause();
  assert.equal(app.utterances.length, 2);
  assert.equal(app.utterances.at(-1).text, 'Letter A.');
  assert.equal(app.saved, 0);
});

test('A final declared pause must finish before the rule is marked heard', () => {
  const app = harness(); app.begin();
  app.run('const unpacedRuleLessonFor = ruleLessonFor; ruleLessonFor = (family, word) => { const steps = unpacedRuleLessonFor(family, word); steps[steps.length - 1].pauseAfterMs = 220; return steps; };');
  app.start(); app.reachSound(); app.recordings[0].onended(); app.finishSpeech();
  assert.equal(app.saved, 0);
  assert.equal(app.run('stored.wordCourse.ruleLessonsHeard.ai'), undefined);
  app.finishSpeechPause();
  assert.equal(app.saved, 1);
});

test('A failed letter utterance does not wait or continue as successful speech', () => {
  const app = harness(); app.begin(); app.start(); app.finishSpeech('synthesis-failed');
  assert.equal([...app.timers.values()].some(timer => timer.milliseconds === 220), false);
  assert.equal(app.recordings.length, 0);
  assert.equal(app.saved, 0);
  assert.match(app.element('mic-status').textContent, /spoken rule could not play/);
});

test('Invalid declared speech pacing fails explicitly', () => {
  for (const pacing of [{rate:0},{rate:null},{pauseAfterMs:-1},{pauseAfterMs:null}]) {
    const app = harness(); app.begin();
    app.context.invalidSpeechPacing = pacing;
    app.run('ruleLessonFor = () => [{kind:"speech", text:"Letter A.", ...invalidSpeechPacing}];');
    app.start();
    assert.equal(app.utterances.length, 0);
    assert.equal(app.saved, 0);
    assert.match(app.element('mic-status').textContent, /invalid speech pacing/);
  }
});

test('Missing recorded sound reports error without invented speech or heard mark', () => {
  const app = harness(); app.begin(); app.start(); app.reachSound();
  app.recordings[0].onerror();
  assert.match(app.element('mic-status').textContent, /recorded rule sound could not play.*try again/);
  assert.equal(app.utterances.length, 3);
  assert.equal(app.saved, 0);
  assert.equal(app.run('activeRuleLessonPlayback'), null);
  assert.equal(app.run('micState'), 'ready');
});

test('Rejected clip playback stops the lesson and does not synthesize its sound', async () => {
  const app = harness({ recordedSoundPlayError:new Error('Audio file missing') });
  app.begin(); app.start(); app.reachSound();
  await Promise.resolve();
  assert.match(app.element('mic-status').textContent, /recorded rule sound could not play/);
  assert.equal(app.utterances.length, 3);
  assert.equal(app.saved, 0);
  assert.equal(app.recordings[0].paused, true);
});

test('A clip that never finishes reports its deadline and rejects late completion', () => {
  const app = harness(); app.begin(); app.start(); app.reachSound();
  const oldEnding = app.recordings[0].onended;
  const deadline = [...app.timers.values()].find(timer => timer.milliseconds === 10000);
  assert.ok(deadline);
  deadline.callback();
  oldEnding();
  assert.match(app.element('mic-status').textContent, /recorded rule sound took too long/);
  assert.equal(app.utterances.length, 3);
  assert.equal(app.saved, 0);
});

test('Navigation during a clip cancels it and rejects an already queued ending', () => {
  const app = harness(); app.begin(); app.start(); app.reachSound();
  const oldEnding = app.recordings[0].onended;
  app.run('cancelWordEncounter()');
  assert.equal(app.recordings[0].paused, true);
  oldEnding();
  assert.equal(app.utterances.length, 3);
  assert.equal(app.saved, 0);
  assert.equal(app.practice.spokenWordEncounter, null);
});

test('Rapid replay invalidates old speech and sound completions', () => {
  const app = harness(); app.begin(); app.start(); app.reachSound();
  const oldEnding = app.recordings[0].onended;
  app.start();
  const secondGuidance = app.utterances.at(-1);
  oldEnding();
  assert.equal(app.utterances.at(-1), secondGuidance);
  app.start();
  app.finishSpeech('onend', secondGuidance);
  assert.equal(app.utterances.at(-1).text, 'Letter A.');
  assert.equal(app.saved, 0);
});

test('Failed spoken guidance can retry without prematurely marking heard', () => {
  const app = harness(); app.begin(); app.start(); app.reachGuidance(); app.finishSpeech('synthesis-failed');
  assert.match(app.element('mic-status').textContent, /spoken rule could not play/);
  assert.equal(app.saved, 0);
  app.start(); app.reachSound(); app.recordings.at(-1).onended(); app.finishSpeech();
  assert.equal(app.saved, 1);
});

test('Hear it interrupts the entire lesson and finishes its own help', () => {
  const app = harness(); app.begin(); app.start(); app.reachSound();
  const oldEnding = app.recordings[0].onended;
  app.element('hear-button').click();
  assert.equal(app.recordings[0].paused, true);
  assert.equal(app.utterances.at(-1).text, 'rain');
  assert.equal(app.run('micState'), 'waiting', 'Hear it still owns the microphone wait after interrupting a rule.');
  oldEnding();
  assert.equal(app.utterances.at(-1).text, 'rain');
  app.finishSpeech();
  assert.equal(app.run('micState'), 'ready');
  assert.equal(app.saved, 0);
  assert.equal(app.practice.hearPressed, true);
});

test('A letter sound interrupts rule speech and clears the sequence', () => {
  const app = harness(); app.begin(); app.start();
  const oldGuidance = app.utterances.at(-1);
  app.run("playLetterSound('t')");
  app.finishSpeech('onend', oldGuidance);
  assert.match(app.recordings.at(-1).url, /\/t\.mp3/);
  assert.equal(app.utterances.length, 1);
  assert.equal(app.saved, 0);
  assert.equal(app.run('micState'), 'ready');
});

test('First introduction and chip replay use the same lesson definition', () => {
  const app = harness(); app.begin(); app.run('presentItem(gs.currentItem)');
  assert.equal(app.utterances[0].text, 'Letter A.');
  app.reachSound();
  const chip = app.element('rule-chips').children[0];
  chip.click();
  assert.equal(app.recordings[0].paused, true);
  assert.equal(app.utterances.at(-1).text, app.utterances[0].text);
});

test('All 41 live lessons match the reviewed steps and use existing recorded clips', () => {
  const app = harness();
  assert.equal(reviewedCourse.levels.length, 41);
  for (const level of reviewedCourse.levels) {
    for (const word of level.focusWords) {
      const steps = app.run(`ruleLessonFor(${JSON.stringify(level.id)}, ${JSON.stringify(word)})`);
      assert.deepEqual(JSON.parse(JSON.stringify(steps)), level.rulePlaybackSteps, `${word}: the live lesson differs from its reviewed declaration.`);
      for (const step of steps) {
        if (step.kind === 'recorded-sound') assert.ok(existsSync(new URL(`../../audio/letters/${step.clipKey}.mp3`, import.meta.url)), `${word}: missing ${step.clipKey}`);
        else {
          assert.equal(step.kind, 'speech');
          if (/^Letter [A-Z]\.$/.test(step.text)) {
            assert.equal(step.rate, 0.72);
            assert.equal(step.pauseAfterMs, 220);
          }
        }
      }
    }
  }
  const uLesson = app.run('ruleLessonFor("u-e-yoo", "cube")');
  assert.ok(uLesson.some(step => step.kind === 'speech' && step.text === 'You.'));
  assert.ok(!uLesson.some(step => step.kind === 'recorded-sound' && step.clipKey === 'ue'));
});

test('Focus words show one current rule chip and familiar words show none', () => {
  const app = harness(); app.begin(); app.run('renderRuleChips(gs.currentItem)');
  const host = app.element('rule-chips');
  assert.equal(host.children.length, 1);
  assert.equal(host.classList.contains('hidden'), false);
  assert.equal(host.children[0].children[0].textContent, 'ai, as in rain');
  app.begin('rain', 'familiar'); app.run('renderRuleChips(gs.currentItem)');
  assert.equal(host.children.length, 0);
  assert.equal(host.classList.contains('hidden'), true);
  app.run('presentItem(gs.currentItem)');
  assert.equal(app.utterances.length, 0, 'A familiar encounter must not introduce its old or current rule.');
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS ' + name);
}
console.log(`${tests.length}/${tests.length} rule lesson checks passed.`);
