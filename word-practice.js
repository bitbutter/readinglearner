'use strict';

// The active word course defines membership. Stable item records hold earned
// progress; their historical numeric levels do not define this course.
function wordCourseLevel(level) {
  if (!Number.isInteger(level) || level < 1 || level > WORD_COURSE.levels.length) {
    throw new Error('Invalid word-course level: ' + level);
  }
  const focus = WORD_COURSE.levels[level - 1];
  if (focus.level !== level) throw new Error('The word course has an invalid level sequence.');
  return focus;
}

function wordFocusLevelForItem(item) {
  if (item.kind !== 'word') return null;
  return WORD_COURSE.levels.find(focus => focus.focusWordIds.includes(item.id)) || null;
}

function wordFocusItems(level, progress = stored) {
  return wordCourseLevel(level).focusWordIds.map(id => {
    const item = progress.items[id];
    if (!item || item.kind !== 'word') throw new Error('Missing focus word: ' + id);
    return item;
  });
}

function wordCourseFocusComplete(level, progress = stored) {
  return wordFocusItems(level, progress).every(item => item.mastered);
}

function firstUnfinishedWordLevel(progress) {
  for (const focus of WORD_COURSE.levels) {
    if (!wordCourseFocusComplete(focus.level, progress)) return focus.level;
  }
  return WORD_COURSE.levels.length;
}

function createWordCourseProgress() {
  return { id: WORD_COURSE.id, ruleLessonsHeard: {}, focusBankOffsets: {} };
}

function migrateWordCourseProgress(progress) {
  if (progress.wordCourse) {
    if (progress.wordCourse.id !== WORD_COURSE.id) throw new Error('This saved word course needs an explicit migration.');
    if (!progress.wordCourse.ruleLessonsHeard || !progress.wordCourse.focusBankOffsets) {
      throw new Error('The saved word course is missing its lesson or rotation records.');
    }
    wordCourseLevel(progress.settings.wordLevel);
    return;
  }
  progress.wordCourseHistory = progress.wordCourseHistory || [];
  progress.wordCourseHistory.push({
    courseId: 'legacy-word-course',
    selectedLevel: progress.settings.wordLevel,
    rulesHeard: { ...(progress.rulesHeard || {}) },
    cvcLevels: progress.cvcLevels === true,
    archivedAt: new Date().toISOString(),
  });
  for (const round of progress.rounds) {
    if (round.set === 'words' && !round.courseId) round.courseId = 'legacy-word-course';
  }
  progress.wordCourse = createWordCourseProgress();
  progress.settings.wordLevel = firstUnfinishedWordLevel(progress);
}

function wordFamiliarItems(level, progress = stored) {
  wordCourseLevel(level);
  if (!Array.isArray(progress.settings.knownStarterWordIds)) throw new Error('The familiar starter choices are missing.');
  const confirmedStarters = new Set(progress.settings.knownStarterWordIds);
  for (const id of confirmedStarters) {
    if (!WORD_COURSE.startingWordIds.includes(id)) throw new Error('A confirmed starter is outside the declared starter bank.');
  }
  const familiarIds = new Set(WORD_COURSE.levels.filter(focus => focus.level <= level)
    .flatMap(focus => focus.focusWordIds));
  return [...new Set([...familiarIds, ...WORD_COURSE.startingWordIds])].map(id => {
    const item = progress.items[id];
    if (!item || item.kind !== 'word') throw new Error('Missing familiar-word record: ' + id);
    return item;
  }).filter(item => item.mastered || confirmedStarters.has(item.id));
}

function buildWordRound(level) {
  const focus = wordCourseLevel(level);
  const familiar = wordFamiliarItems(level);
  if (!familiar.length) {
    const error = new Error('Choose at least one word he already reads in the familiar starter settings.');
    error.code = 'known_word_bank_required';
    throw error;
  }
  const focusItems = wordFocusItems(level);
  const offset = stored.wordCourse.focusBankOffsets[focus.id] ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= focusItems.length) throw new Error('Invalid focus-word rotation.');
  const rotated = focusItems.slice(offset).concat(focusItems.slice(0, offset));
  const selectedFocus = rotated.filter(item => !item.mastered)
    .concat(rotated.filter(item => item.mastered)).slice(0, WORD_COURSE.roundRecipe.focusCount);
  if (selectedFocus.length !== WORD_COURSE.roundRecipe.focusCount) throw new Error('The focus bank cannot fill the reviewed round.');
  const shuffledFamiliar = shuffle(familiar);
  const familiarEncounter = index => ({ item: shuffledFamiliar[index % shuffledFamiliar.length], role: 'familiar' });
  const encounters = [
    ...Array.from({ length: WORD_COURSE.roundRecipe.openingCount }, (_, index) => familiarEncounter(index)),
    ...selectedFocus.map(item => ({ item, role: 'focus' })),
    ...Array.from({ length: WORD_COURSE.roundRecipe.closingCount }, (_, index) => familiarEncounter(index + WORD_COURSE.roundRecipe.openingCount)),
  ];
  stored.wordCourse.focusBankOffsets[focus.id] = (offset + WORD_COURSE.roundRecipe.focusCount) % focusItems.length;
  return { encounters, ruleFocusId: focus.id, ruleIds: selectedFocus.map(item => item.id) };
}
