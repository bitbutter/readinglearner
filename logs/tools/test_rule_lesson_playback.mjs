// Simulates the real spoken-rule sequence, native speech and recorded clips.
// Run: node logs/tools/test_rule_lesson_playback.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
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
        classList:{ add:name => classes.add(name), remove:name => classes.delete(name),
          toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
          contains:name => classes.has(name) },
        appendChild(child) { this.children.push(child); return child; }, setAttribute() {},
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
  const practice = { currentItem:null, spokenWordEncounter:null, awaitingResult:false, ruleIds:[], recapId:null };
  const context = vm.createContext({
    window:{ speechSynthesis }, speechSynthesis, SpeechSynthesisUtterance:RuleSpeech, Audio:RuleSound,
    gs:practice, micState:'ready', stored:{ rulesHeard:{}, settings:{ speechRate:0.9 } },
    spokenWordEncounterSequence:0, spokenAttemptGeneration:0, maxListenTimer:null,
    getVoice:() => null, cancelUnblock() {}, DBG() {}, saveStored() { saved++; },
    renderDots() {}, renderTrophyRow() {}, renderConfirmationProgress() {},
    document:{ getElementById:element, createElement:tag => element(Symbol(tag)),
      createDocumentFragment:() => element(Symbol('fragment')) },
    setTimeout(callback, milliseconds) { const id = ++timerSequence; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout:id => timers.delete(id),
    famsOf:item => vm.runInContext(`SOUND_FIXES[${JSON.stringify(item.display)}]?.fams || []`, context),
  });
  vm.runInContext([
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
    begin(word = 'tea') {
      practice.currentItem = { id:'word:' + word, display:word, kind:'word' };
      run('beginWordEncounter(gs.currentItem)');
      run("setMicState('ready')");
    },
    start(family = 'ea-team') { run(`startRuleLessonPlayback(${JSON.stringify(family)}, gs.currentItem)`); },
    finishSpeech(how = 'onend', utterance = utterances.at(-1)) {
      if (utterance === activeUtterance) activeUtterance = null;
      if (how === 'onend') utterance.onend?.();
      else utterance.onerror?.({ error:how });
    },
    reachSound() { this.finishSpeech(); this.finishSpeech(); this.finishSpeech(); },
  };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }

test('Guidance, separate letter names, recorded sound, example, then heard', () => {
  const app = harness(); app.begin(); app.start();
  assert.equal(app.run('micState'), 'waiting');
  assert.equal(app.element('mic-button').disabled, true);
  assert.equal(app.element('hear-button').disabled, false);
  app.reachSound();
  assert.deepEqual(app.utterances.map(utterance => utterance.text), [
    'These two letters work together to make this sound.', 'Letter E.', 'Letter A.',
  ]);
  assert.match(app.recordings[0].url, /\/ee\.mp3\?v=4$/);
  assert.equal(app.run('stored.rulesHeard["ea-team"]'), undefined);
  assert.equal(app.saved, 0);
  app.recordings[0].onended();
  assert.equal(app.utterances.at(-1).text, 'As in tea.');
  assert.equal(app.saved, 0);
  app.finishSpeech();
  assert.equal(app.run('stored.rulesHeard["ea-team"]'), true);
  assert.equal(app.saved, 1);
  assert.equal(app.run('micState'), 'ready');
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
  assert.equal(app.utterances.at(-1).text, 'These two letters work together to make this sound.');
  assert.equal(app.saved, 0);
});

test('Failed spoken guidance can retry without prematurely marking heard', () => {
  const app = harness(); app.begin(); app.start(); app.finishSpeech('synthesis-failed');
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
  assert.equal(app.utterances.at(-1).text, 'tea');
  assert.equal(app.run('micState'), 'waiting', 'Hear it still owns the microphone wait after interrupting a rule.');
  oldEnding();
  assert.equal(app.utterances.at(-1).text, 'tea');
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
  assert.equal(app.utterances[0].text, 'These two letters work together to make this sound.');
  app.reachSound();
  const chip = app.element('rule-chips').children[0];
  chip.click();
  assert.equal(app.recordings[0].paused, true);
  assert.equal(app.utterances.at(-1).text, app.utterances[0].text);
});

test('Every declared lesson clip exists, with intentional real-word U demonstration', () => {
  const app = harness();
  const fixes = app.run('SOUND_FIXES');
  for (const [word, fix] of Object.entries(fixes)) {
    for (const family of fix.fams || []) {
      const steps = app.run(`ruleLessonFor(${JSON.stringify(family.fam)}, ${JSON.stringify(word)})`);
      for (const step of steps) {
        if (step.kind === 'recorded-sound') assert.ok(existsSync(new URL(`../../audio/letters/${step.clipKey}.mp3`, import.meta.url)), `${word}: missing ${step.clipKey}`);
        else assert.equal(step.kind, 'speech');
      }
    }
  }
  const uLesson = app.run('ruleLessonFor("open-syllable", "music")');
  assert.ok(uLesson.some(step => step.kind === 'speech' && step.text === 'you'));
  assert.ok(!uLesson.some(step => step.kind === 'recorded-sound' && step.clipKey === 'ue'));
});

test('Corrected word chips and unit sounds state truthful conditions', () => {
  const app = harness();
  const fixes = app.run('SOUND_FIXES');
  assert.equal(fixes.both.fams[0].fam, 'o-says-oh');
  assert.equal(fixes.water.fams[0].fam, 'a-says-aw');
  assert.equal(fixes.shall.over, undefined);
  assert.equal(fixes.shall.fams, undefined);
  assert.equal(fixes.music.over.c, undefined);
  assert.ok(!fixes.music.fams.some(family => family.fam === 'soft-c'));
});

for (const { name, run } of tests) {
  await run();
  console.log('PASS ' + name);
}
console.log(`${tests.length}/${tests.length} rule lesson checks passed.`);
