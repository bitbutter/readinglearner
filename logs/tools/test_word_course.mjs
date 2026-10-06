// Exercises the live word course, save migrations, and round lifecycle without a browser.
// Run: node logs/tools/test_word_course.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const appSource = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const courseSource = readFileSync(new URL('../../word-course.js', import.meta.url), 'utf8');
const wordPracticeSource = readFileSync(new URL('../../word-practice.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));

function harness(savedProgress) {
  const savedValues = new Map();
  if (savedProgress) savedValues.set('readingLearner.v1', JSON.stringify(savedProgress));
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    window: {}, navigator: {}, location: { hash: '', protocol: 'https:' },
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem: key => savedValues.get(key) ?? null,
      setItem: (key, value) => savedValues.set(key, value),
      removeItem: key => savedValues.delete(key),
    },
    speechSynthesis: { cancel() {} },
    setTimeout() { return 1; }, clearTimeout() {},
    performance: { now: () => 0 },
    Audio: class { pause() {} }, Image: class {},
    spokenMessages: [],
  });
  vm.runInContext(courseSource, context, { filename: 'word-course.js' });
  vm.runInContext(wordPracticeSource, context, { filename: 'word-practice.js' });
  vm.runInContext(appSource, context, { filename: 'app.js' });
  vm.runInContext(`
    showStorageError = message => { throw new Error(message); };
    cancelWordEncounter = () => {};
    setLevelBackground = () => {};
    showScreen = () => {};
    openMicStream = () => {};
    closeMicStream = () => {};
    speak = (line, _rate, finished) => { spokenMessages.push(line); finished?.('onend'); };
    nextItem = () => {};
    showAllDone = completion => { globalThis.lastRoundCompletion = completion; };
    globalThis.wordCourseTest = {
      course: WORD_COURSE, freshState, makeItem, loadStored, saveStored,
      wordCourseLevel, wordFocusItems, wordFamiliarItems, wordCourseFocusComplete,
      firstUnfinishedWordLevel, migrateWordCourseProgress, buildRound, startRound,
      checkLevelComplete, endRound, levelFromHash,
      get progress() { return stored; }, set progress(value) { stored = value; },
      get practice() { return gs; },
    };
  `, context);
  const app = context.wordCourseTest;
  return {
    ...app, context,
    get progress() { return app.progress; }, set progress(value) { app.progress = value; },
    get practice() { return app.practice; },
    run: expression => vm.runInContext(expression, context),
    saved: () => JSON.parse(savedValues.get('readingLearner.v1')),
    load() { app.loadStored(); assert.ok(app.progress, 'Loading must produce usable progress.'); return app.progress; },
    fresh() { app.progress = app.freshState(); return app.progress; },
  };
}

function masterFocusBank(app, level, progress = app.progress) {
  for (const item of app.wordFocusItems(level, progress)) {
    item.mastered = true;
    item.masteryConfirmationCount = 2;
  }
}

function confirmStarterBank(app, progress = app.progress) {
  progress.settings.knownStarterWordIds = [...app.course.startingWordIds];
}

function legacyFixture(app, { oldMigrationFlags = true } = {}) {
  const progress = plain(app.freshState());
  delete progress.wordCourse;
  delete progress.wordCourseHistory;
  progress.settings.wordLevel = 8;
  progress.settings.numberLevel = 7;
  delete progress.settings.knownStarterWordIds;
  progress.rulesHeard = { 'ea-team': true, 'r-controlled': true };
  progress.acceptedPruned = true;
  if (oldMigrationFlags) {
    progress.cvcLevels = true;
    progress.forwardLevels = true;
  } else {
    delete progress.cvcLevels;
    delete progress.forwardLevels;
  }
  progress.rounds = [
    { id: 'old-word-round', set: 'words', level: 8, total: 10, correct: 9, endedAt: '2026-09-01T10:00:00Z' },
    { id: 'old-number-round', set: 'numbers', level: 7, total: 10, correct: 8, endedAt: '2026-09-02T10:00:00Z' },
  ];
  const parkedWord = progress.items['word:are'];
  assert.ok(parkedWord, 'The legacy catalog must retain the parked word are.');
  Object.assign(parkedWord, {
    mastered: true, decoded: true, flawless: true, totalAttempts: 12, totalCorrect: 9,
    masteryConfirmationCount: 1, flawlessConfirmationCount: 1,
    successStreak: 3, unaidedStreak: 2, silentCorrect: 6,
    lastSeenRound: 17, lastRecapRound: 11, lastResult: 'helped', auditionConfs: [0.72, 0.91],
  });
  progress.items['custom:word:peppa'] = plain(app.makeItem({
    id: 'custom:word:peppa', display: 'Peppa', accepted: ['peppa'], level: 4,
  }, 'word'));
  progress.items['custom:word:peppa'].totalAttempts = 4;
  progress.items['custom:num:999'] = plain(app.makeItem({
    id: 'custom:num:999', display: '999', accepted: ['nine hundred ninety nine'], level: 9,
  }, 'number'));
  masterFocusBank(app, 1, progress);
  masterFocusBank(app, 2, progress);
  // Historic trophies predate the new confirmation counters and still carry credit.
  progress.items[app.course.levels[0].focusWordIds[0]].masteryConfirmationCount = 0;
  return progress;
}

const checks = [];
function check(name, run) { checks.push({ name, run }); }

check('The live course has 41 distinct focus banks and 240 stable focus identities', () => {
  const app = harness();
  assert.equal(app.course.levels.length, 41);
  assert.deepEqual(plain(app.course.levels.map(bank => bank.level)), Array.from({ length: 41 }, (_, index) => index + 1));
  const focusIds = app.course.levels.flatMap(bank => bank.focusWordIds);
  assert.equal(focusIds.length, 240);
  assert.equal(new Set(focusIds).size, 240);
  for (const level of [0, 42, -1, 1.5, '2', NaN]) {
    assert.throws(() => app.wordCourseLevel(level), /level/i, `Reject invalid course level ${String(level)}.`);
  }
});

check('Fresh and reset-style saves initialize course state without inventing familiar starters', () => {
  const app = harness();
  app.load();
  assert.equal(app.progress.wordCourse.id, app.course.id);
  assert.deepEqual(plain(app.progress.wordCourse.ruleLessonsHeard), {});
  assert.deepEqual(plain(app.progress.wordCourse.focusBankOffsets), {});
  assert.equal(app.progress.settings.wordLevel, 1);
  assert.equal(app.progress.settings.numberLevel, 1);
  assert.equal(app.wordFamiliarItems(1).length, 0);
  app.saveStored();
  const reloaded = harness(app.saved()); reloaded.load();
  assert.equal(reloaded.progress.wordCourse.id, app.course.id);
  assert.equal(reloaded.progress.settings.wordLevel, 1);
});

check('Legacy migration preserves parked/custom words, permanent trophies, counters, numbers, and history', () => {
  const seedApp = harness();
  const legacy = legacyFixture(seedApp);
  const parkedBefore = plain(legacy.items['word:are']);
  const customBefore = plain(legacy.items['custom:word:peppa']);
  const numbersBefore = plain(Object.fromEntries(Object.entries(legacy.items).filter(([, item]) => item.kind === 'number')));
  const roundsBefore = plain(legacy.rounds);
  const app = harness(legacy); app.load();
  assert.equal(app.progress.settings.wordLevel, 3);
  assert.equal(app.progress.settings.numberLevel, 7);
  assert.deepEqual(plain(app.progress.items['word:are']), parkedBefore);
  assert.deepEqual(plain(app.progress.items['custom:word:peppa']), customBefore);
  assert.deepEqual(plain(Object.fromEntries(Object.entries(app.progress.items).filter(([, item]) => item.kind === 'number'))), numbersBefore);
  assert.equal(app.wordCourseFocusComplete(1), true, 'Historic gold keeps credit without resetting its earned trophy.');
  assert.equal(app.wordCourseFocusComplete(2), true);
  assert.equal(app.wordCourseFocusComplete(3), false);
  assert.equal(app.progress.wordCourse.id, app.course.id);
  assert.deepEqual(plain(app.progress.wordCourse.ruleLessonsHeard), {}, 'Old heard rules cannot suppress new focus lessons.');
  assert.ok(app.progress.wordCourseHistory?.length, 'Archive the old selected course and heard rules.');
  const archivedCourse = app.progress.wordCourseHistory[0];
  assert.equal(archivedCourse.courseId, 'legacy-word-course');
  assert.equal(archivedCourse.selectedLevel, 8);
  assert.deepEqual(plain(archivedCourse.rulesHeard), legacy.rulesHeard);
  assert.equal(app.progress.rounds[0].courseId, archivedCourse.courseId);
  const { courseId: _legacyCourseId, ...oldWordRound } = plain(app.progress.rounds[0]);
  assert.deepEqual(oldWordRound, roundsBefore[0]);
  assert.deepEqual(plain(app.progress.rounds[1]), roundsBefore[1]);
  assert.equal(app.progress.rounds.length, roundsBefore.length);
  for (const bank of app.course.levels) {
    assert.equal(app.wordFocusItems(bank.level).length, bank.focusWordIds.length);
  }
});

check('Missing new catalog words are merged while all old word identities survive', () => {
  const seedApp = harness();
  const legacy = legacyFixture(seedApp);
  const newWordId = seedApp.course.levels.flatMap(bank => bank.focusWordIds).find(id => id !== 'word:are' && legacy.items[id].totalAttempts === 0);
  delete legacy.items[newWordId];
  const oldWordIds = Object.values(legacy.items).filter(item => item.kind === 'word').map(item => item.id);
  const app = harness(legacy); app.load();
  assert.ok(app.progress.items[newWordId], 'Merge a required canonical focus word.');
  for (const id of oldWordIds) assert.ok(app.progress.items[id], `Preserve old word identity ${id}.`);
});

check('Accepted-answer export treats new course spellings as defaults and exports only manual additions', () => {
  const app = harness(); app.load();
  const untouchedExport = app.context.window.rlExportAccepted();
  assert.deepEqual(plain(untouchedExport.acceptedAdditions), {}, 'Untouched canonical words cannot appear as manual additions.');
  const addedCourseWord = app.course.additionalWords[0];
  assert.ok(addedCourseWord, 'Exercise a word added by the new course rather than a legacy word.');
  const wordProgress = app.progress.items[addedCourseWord.id];
  const defaultSpellings = plain(wordProgress.accepted);
  const manualSpelling = addedCourseWord.display.toLowerCase() + 'testspelling';
  wordProgress.accepted.push(manualSpelling);
  const editedExport = app.context.window.rlExportAccepted();
  assert.deepEqual(plain(editedExport.acceptedAdditions), { [addedCourseWord.id]: [manualSpelling] });
  assert.deepEqual(plain(wordProgress.accepted), [...defaultSpellings, manualSpelling], 'Exporting cannot rewrite the word\'s accepted answers.');
  assert.ok(defaultSpellings.every(spelling => !editedExport.acceptedAdditions[addedCourseWord.id].includes(spelling)),
    'The new word\'s default spelling remains part of the canonical baseline.');
});

check('Course migration is idempotent and repeated loading keeps parent-selected practice levels', () => {
  const seedApp = harness(); const app = harness(legacyFixture(seedApp)); app.load();
  app.progress.wordCourse.ruleLessonsHeard['short-a'] = true;
  app.progress.wordCourse.focusBankOffsets['short-a'] = 3;
  for (const parentLevel of [1, 19, 41]) {
    app.progress.settings.wordLevel = parentLevel;
    const beforeMigration = plain(app.progress);
    app.migrateWordCourseProgress(app.progress);
    assert.deepEqual(plain(app.progress), beforeMigration, 'Repeated migration must not rewrite the selected practice level.');
    app.saveStored();
    const reloaded = harness(app.saved()); reloaded.load(); reloaded.saveStored();
    const loadedAgain = harness(reloaded.saved()); loadedAgain.load();
    assert.equal(loadedAgain.progress.settings.wordLevel, parentLevel);
    assert.equal(loadedAgain.progress.settings.numberLevel, 7);
    assert.equal(loadedAgain.progress.wordCourse.ruleLessonsHeard['short-a'], true);
    assert.equal(loadedAgain.progress.wordCourse.focusBankOffsets['short-a'], 3);
    assert.equal(loadedAgain.progress.wordCourseHistory.length, app.progress.wordCourseHistory.length);
  }
});

check('Older one-time migrations cannot relabel the active word course on a later reload', () => {
  const seedApp = harness(); const app = harness(legacyFixture(seedApp, { oldMigrationFlags: false })); app.load();
  assert.equal(app.progress.settings.wordLevel, 3);
  app.progress.settings.wordLevel = 27;
  app.saveStored();
  const reloaded = harness(app.saved()); reloaded.load();
  assert.equal(reloaded.progress.settings.wordLevel, 27);
  assert.equal(reloaded.progress.settings.numberLevel, 7);
});

check('Unknown or incomplete saved course identities fail without resetting earned progress', () => {
  const seedApp = harness();
  for (const malformedCourse of [
    { id: 'unrecognized-word-course', ruleLessonsHeard: {}, focusBankOffsets: {} },
    { id: seedApp.course.id, ruleLessonsHeard: {} },
  ]) {
    const progress = plain(seedApp.freshState());
    progress.items['word:are'].mastered = true;
    progress.items['word:are'].totalAttempts = 17;
    progress.wordCourse = malformedCourse;
    const app = harness(progress);
    assert.throws(() => app.load(), /migration|missing|course/i);
    assert.deepEqual(app.saved(), progress, 'Rejected loading cannot overwrite the original save.');
  }
});

check('Only mastered current/earlier focus words and demonstrated starters enter the familiar bank', () => {
  const app = harness(); app.fresh();
  const current = app.wordFocusItems(2)[0];
  const earlier = app.wordFocusItems(1)[0];
  const future = app.wordFocusItems(3)[0];
  for (const item of [current, earlier, future, app.progress.items['word:are']]) item.mastered = true;
  const starter = app.course.startingWordIds[0];
  app.progress.settings.knownStarterWordIds = [starter];
  const familiarIds = new Set(app.wordFamiliarItems(2).map(item => item.id));
  assert.ok(familiarIds.has(current.id));
  assert.ok(familiarIds.has(earlier.id));
  assert.ok(familiarIds.has(starter));
  assert.ok(!familiarIds.has(future.id));
  assert.ok(!familiarIds.has('word:are'));
  assert.ok(app.wordFamiliarItems(2).every(item => item.kind === 'word'));
  app.progress.settings.knownStarterWordIds = [];
  app.progress.items[starter].mastered = true;
  assert.ok(app.wordFamiliarItems(1).some(item => item.id === starter), 'Earned starter mastery also proves familiarity.');
});

check('An unknown familiar bank fails explicitly without substituting unseen easy words', () => {
  const app = harness(); app.fresh();
  assert.throws(() => app.buildRound('words', 1), /familiar|known|starter/i);
  assert.equal(app.progress.rounds.length, 0);
  assert.ok(app.wordFocusItems(1).every(item => !item.mastered && item.totalAttempts === 0));
});

check('Every level assembles ten word encounters with 3 familiar, 4 focus, 3 familiar and full bank rotation', () => {
  for (let level = 1; level <= 41; level++) {
    const app = harness(); app.fresh(); confirmStarterBank(app);
    app.progress.settings.roundSize = level % 2 ? 4 : 20;
    const bank = app.wordCourseLevel(level);
    const focusIds = new Set(bank.focusWordIds);
    const seenFocusIds = new Set();
    const roundsToCoverBank = Math.ceil(focusIds.size / 4) + 1;
    for (let round = 0; round < roundsToCoverBank; round++) {
      const built = app.buildRound('words', level);
      assert.equal(built.encounters.length, 10, `Level ${level} stays at ten encounters.`);
      assert.deepEqual(plain(built.encounters.map(encounter => encounter.role)), [
        'familiar', 'familiar', 'familiar', 'focus', 'focus', 'focus', 'focus', 'familiar', 'familiar', 'familiar',
      ]);
      assert.equal(built.ruleFocusId, bank.id);
      assert.ok(built.encounters.every(encounter => encounter.item.kind === 'word'));
      const focusEncounters = built.encounters.filter(encounter => encounter.role === 'focus');
      assert.equal(new Set(focusEncounters.map(encounter => encounter.item.id)).size, 4);
      for (const encounter of focusEncounters) {
        assert.ok(focusIds.has(encounter.item.id), `Level ${level} teaches only its declared bank.`);
        seenFocusIds.add(encounter.item.id);
      }
      assert.deepEqual(new Set(built.ruleIds), new Set(focusEncounters.map(encounter => encounter.item.id)));
      const familiarIds = new Set(app.wordFamiliarItems(level).map(item => item.id));
      assert.ok(built.encounters.filter(encounter => encounter.role === 'familiar').every(encounter => familiarIds.has(encounter.item.id)));
    }
    assert.equal(seenFocusIds.size, focusIds.size, `Level ${level} eventually encounters its entire focus bank.`);
    assert.ok(app.wordFocusItems(level).every(item => !item.mastered && item.totalAttempts === 0),
      'Selecting rounds cannot award word progress.');
  }
});

check('Focus rotation resumes from saved offsets and prioritizes the remaining unmastered words', () => {
  const app = harness(); app.fresh(); confirmStarterBank(app);
  const bank = app.wordCourseLevel(1);
  const firstRoundIds = new Set(app.buildRound('words', 1).encounters.filter(encounter => encounter.role === 'focus').map(encounter => encounter.item.id));
  app.saveStored(); const reloaded = harness(app.saved()); reloaded.load();
  const nextRoundIds = reloaded.buildRound('words', 1).encounters.filter(encounter => encounter.role === 'focus').map(encounter => encounter.item.id);
  assert.ok(nextRoundIds.some(id => !firstRoundIds.has(id)), 'Reloading cannot restart the same focus subset.');
  const focusItems = reloaded.wordFocusItems(1);
  focusItems.forEach(item => { item.mastered = true; });
  const remainingId = bank.focusWordIds.at(-1);
  reloaded.progress.items[remainingId].mastered = false;
  for (let round = 0; round < 4; round++) {
    const focusIds = reloaded.buildRound('words', 1).encounters.filter(encounter => encounter.role === 'focus').map(encounter => encounter.item.id);
    assert.ok(focusIds.includes(remainingId), 'A remaining unmastered focus word gets a slot every round.');
  }
});

check('Completion ignores familiar/custom/parked words and skips completed following focus banks', () => {
  const app = harness(); app.fresh();
  masterFocusBank(app, 1); masterFocusBank(app, 2); masterFocusBank(app, 3);
  app.progress.items['word:are'].mastered = false;
  app.progress.items['custom:word:test'] = app.makeItem({ id: 'custom:word:test', display: 'test', accepted: ['test'], level: 1 }, 'word');
  assert.equal(app.wordCourseFocusComplete(1), true);
  assert.equal(app.firstUnfinishedWordLevel(app.progress), 4);
  app.practice.currentSet = 'words'; app.practice.currentLevel = 1;
  assert.equal(app.checkLevelComplete(), 'level_complete');
  assert.equal(app.progress.settings.wordLevel, 4);
  assert.equal(app.progress.settings.numberLevel, 1);
  app.practice.currentLevel = 4;
  assert.equal(app.checkLevelComplete(), null);
});

check('Mastering every focus bank completes Level 41 without creating a Level 42', () => {
  const app = harness(); app.fresh();
  for (let level = 1; level <= 41; level++) masterFocusBank(app, level);
  assert.equal(app.firstUnfinishedWordLevel(app.progress), 41);
  app.progress.settings.wordLevel = 41;
  app.practice.currentSet = 'words'; app.practice.currentLevel = 41;
  assert.equal(app.checkLevelComplete(), 'all_defeated');
  assert.equal(app.progress.settings.wordLevel, 41);
  assert.equal(app.progress.settings.numberLevel, 1);
});

check('A completed final bank cannot award the course trophy while earlier focus banks remain unfinished', () => {
  for (const selectedLevel of [40, 41]) {
    const app = harness(); app.fresh();
    masterFocusBank(app, 40); masterFocusBank(app, 41);
    app.progress.settings.wordLevel = selectedLevel;
    app.practice.currentSet = 'words'; app.practice.currentLevel = selectedLevel;
    assert.equal(app.firstUnfinishedWordLevel(app.progress), 1);
    assert.equal(app.checkLevelComplete(), null, 'Do not claim the course is complete or jump back into earlier work.');
    assert.equal(app.progress.settings.wordLevel, selectedLevel);
  }
});

check('Completing a parent-selected later level advances forward despite earlier unfinished banks', () => {
  const app = harness(); app.fresh();
  masterFocusBank(app, 19); masterFocusBank(app, 20);
  app.progress.settings.wordLevel = 19;
  app.practice.currentSet = 'words'; app.practice.currentLevel = 19;
  assert.equal(app.firstUnfinishedWordLevel(app.progress), 1, 'Earlier unfinished work still exists.');
  assert.equal(app.checkLevelComplete(), 'level_complete');
  assert.equal(app.progress.settings.wordLevel, 21, 'Advancement honors the parent-selected progression point.');
});

check('The unlock message names the actual committed next level after completed focus banks are skipped', () => {
  const app = harness(); app.fresh();
  masterFocusBank(app, 19); masterFocusBank(app, 20);
  app.progress.settings.wordLevel = 19;
  app.practice.currentSet = 'words'; app.practice.currentLevel = 19;
  const completion = app.checkLevelComplete();
  assert.equal(completion, 'level_complete');
  assert.equal(app.progress.settings.wordLevel, 21);
  const messages = new Map(['levelup-title', 'levelup-body'].map(id => [id, { textContent: '' }]));
  app.context.document.getElementById = id => messages.get(id) ?? null;
  app.context.completionToDisplay = completion;
  app.run('showLevelUp(completionToDisplay)');
  assert.match(messages.get('levelup-body').textContent, /\b21\b/);
  assert.ok(!/\b20\b/.test(messages.get('levelup-body').textContent));
  assert.match(app.context.spokenMessages.at(-1), /\b21\b/);
});

check('An invalid non-number focus rotation fails without silently restarting at the beginning', () => {
  const app = harness(); app.fresh(); confirmStarterBank(app);
  app.progress.wordCourse.focusBankOffsets['short-a'] = NaN;
  assert.throws(() => app.buildRound('words', 1), /rotation/i);
  assert.equal(app.progress.settings.wordLevel, 1);
  assert.equal(app.progress.rounds.length, 0);
});

check('Numbers still complete at Level 10 independently of the 41-level word course', () => {
  const app = harness(); app.fresh();
  app.progress.settings.wordLevel = 31;
  app.progress.settings.numberLevel = 10;
  for (const item of Object.values(app.progress.items).filter(item => item.kind === 'number' && item.level === 10)) item.mastered = true;
  app.practice.currentSet = 'numbers'; app.practice.currentLevel = 10;
  assert.equal(app.checkLevelComplete(), 'all_defeated');
  assert.equal(app.progress.settings.numberLevel, 10);
  assert.equal(app.progress.settings.wordLevel, 31);
});

check('Word startup keeps exactly ten encounters; number startup adds only a feedback-only number recap', () => {
  const app = harness(); app.fresh(); confirmStarterBank(app);
  masterFocusBank(app, 1);
  for (const item of Object.values(app.progress.items).filter(item => item.kind === 'number' && item.level === 1)) item.mastered = true;
  app.startRound('words', 2);
  assert.equal(app.practice.originalSize, 10);
  assert.equal(app.practice.queue.length, 10);
  assert.ok(app.practice.queue.every(encounter => encounter.item.kind === 'word' && encounter.role !== 'recap'));
  app.progress.settings.roundSize = 4;
  app.startRound('numbers', 2);
  assert.equal(app.practice.originalSize, 4);
  assert.equal(app.practice.queue.length, 5);
  const recaps = app.practice.queue.filter(encounter => encounter.role === 'recap');
  assert.equal(recaps.length, 1);
  assert.ok(app.practice.queue.every(encounter => encounter.item.kind === 'number'));
  assert.equal(recaps[0].item.level, 1);
});

check('Round history identifies the new word course while practice outside the selected level does not advance it', () => {
  const app = harness(); app.fresh();
  masterFocusBank(app, 1);
  app.progress.settings.wordLevel = 9;
  Object.assign(app.practice, { currentSet: 'words', currentLevel: 1, roundCorrect: 10, completedCount: 10 });
  app.endRound();
  assert.equal(app.progress.settings.wordLevel, 9);
  assert.equal(app.context.lastRoundCompletion, null);
  assert.equal(app.progress.rounds.at(-1).courseId, app.course.id);
  assert.equal(app.progress.rounds.at(-1).level, 1);
  Object.assign(app.practice, { currentSet: 'numbers', currentLevel: 1, roundCorrect: 4, completedCount: 4 });
  app.progress.settings.numberLevel = 7;
  app.endRound();
  assert.equal(app.progress.settings.wordLevel, 9);
  assert.equal(app.progress.settings.numberLevel, 7);
  assert.notEqual(app.progress.rounds.at(-1).courseId, app.course.id);
});

check('Word deep links reach 41 while number deep links retain their ten-level bound', () => {
  const app = harness();
  for (const [hash, expected] of [
    ['#words-1', { set: 'words', level: 1 }], ['#words-41', { set: 'words', level: 41 }],
    ['#numbers-10', { set: 'numbers', level: 10 }], ['#words-42', null], ['#numbers-11', null], ['#words-0', null],
  ]) {
    app.context.location.hash = hash;
    const parsed = app.levelFromHash();
    assert.deepEqual(parsed ? plain(parsed) : null, expected, hash);
  }
});

check('Missing required focus records fail explicitly rather than shrinking completion or practice banks', () => {
  const app = harness(); app.fresh(); confirmStarterBank(app);
  const requiredId = app.course.levels[0].focusWordIds[0];
  delete app.progress.items[requiredId];
  assert.throws(() => app.wordFocusItems(1), /missing|required|word|catalog/i);
  assert.throws(() => app.wordCourseFocusComplete(1), /missing|required|word|catalog/i);
  assert.throws(() => app.buildRound('words', 1), /missing|required|word|catalog/i);
});

let failures = 0;
for (const { name, run } of checks) {
  try { await run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name); console.error(error.stack || error); }
}
console.log(`${checks.length - failures}/${checks.length} word course checks passed.`);
if (failures) process.exitCode = 1;
