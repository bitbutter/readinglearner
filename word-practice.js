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

function wordOpeningClosingItems(level, progress = stored) {
  const familiar = wordFamiliarItems(level, progress);
  const sectionSize = Math.max(WORD_COURSE.roundRecipe.openingCount, WORD_COURSE.roundRecipe.closingCount);
  if (familiar.length >= sectionSize) return familiar;
  // Level 1 supplies the approved easy-word default; this does not grant mastery.
  const familiarIds = new Set(familiar.map(item => item.id));
  return familiar.concat(wordFocusItems(1, progress).filter(item => !familiarIds.has(item.id)));
}

function buildWordRound(level) {
  const focus = wordCourseLevel(level);
  const openingClosingItems = wordOpeningClosingItems(level);
  const { openingCount, focusCount, closingCount } = WORD_COURSE.roundRecipe;
  if (openingClosingItems.length < Math.max(openingCount, closingCount)) {
    throw new Error('The declared easy-word bank cannot fill distinct opening and closing sections.');
  }
  const focusItems = wordFocusItems(level);
  const offset = stored.wordCourse.focusBankOffsets[focus.id] ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= focusItems.length) throw new Error('Invalid focus-word rotation.');
  const rotated = focusItems.slice(offset).concat(focusItems.slice(0, offset));
  const selectedFocus = rotated.filter(item => !item.mastered)
    .concat(rotated.filter(item => item.mastered)).slice(0, focusCount);
  if (selectedFocus.length !== focusCount) throw new Error('The focus bank cannot fill the reviewed round.');
  const shuffledEasyWords = shuffle(openingClosingItems);
  const openingWords = shuffledEasyWords.slice(0, openingCount);
  const closingWords = Array.from({ length: closingCount }, (_, index) => shuffledEasyWords[(index + openingCount) % shuffledEasyWords.length]);
  // A mastered focus word can also be eligible for an easy section.
  // Move that section's boundary word, leaving the focus rotation unchanged.
  if (openingWords.at(-1).id === selectedFocus[0].id) {
    [openingWords[0], openingWords[openingCount - 1]] = [openingWords[openingCount - 1], openingWords[0]];
  }
  if (closingWords[0].id === selectedFocus.at(-1).id) {
    [closingWords[0], closingWords[closingCount - 1]] = [closingWords[closingCount - 1], closingWords[0]];
  }
  const encounters = [
    ...openingWords.map(item => ({ item, role: 'familiar' })),
    ...selectedFocus.map(item => ({ item, role: 'focus' })),
    ...closingWords.map(item => ({ item, role: 'familiar' })),
  ];
  stored.wordCourse.focusBankOffsets[focus.id] = (offset + focusCount) % focusItems.length;
  return { encounters, ruleFocusId: focus.id, ruleIds: selectedFocus.map(item => item.id) };
}
