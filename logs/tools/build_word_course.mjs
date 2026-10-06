// Build the active word course from its reviewed word banks, rule lessons and
// artwork assignments. Run: node logs/tools/build_word_course.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const courseFile = new URL('../../plans/word-levels-proposed.json', import.meta.url);
const artworkFile = new URL('../../images/word-course-artwork.json', import.meta.url);
const appFile = new URL('../../app.js', import.meta.url);
const moduleFile = new URL('../../word-course.js', import.meta.url);
const reviewedFocusBankSha256 = 'd0fce52acff2b2b206453452fac26bc0ab37e3920c1bd1ab45b9ac97be05b77e';
const requireCourse = (condition, message) => { if (!condition) throw new Error(`Word course: ${message}`); };
const requireText = (value, name) => requireCourse(typeof value === 'string' && value.trim().length > 0, `${name} must be nonempty text.`);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const sourceCourse = JSON.parse(readFileSync(courseFile, 'utf8'));
requireCourse(sourceCourse.schemaVersion === 1 && sourceCourse.status === 'active', 'the source must be the active schema-1 course.');
requireCourse(sourceCourse.courseId === 'one-focus-word-course-v1', 'the active course identity is incorrect.');
requireCourse(Array.isArray(sourceCourse.levels) && sourceCourse.levels.length === 41, 'the reviewed course has exactly 41 levels.');
const reviewedFocusBanks = sourceCourse.levels.map(({ level, id, focusWords }) => ({ level, id, focusWords }));
requireCourse(sha256(JSON.stringify(reviewedFocusBanks)) === reviewedFocusBankSha256, 'the reviewed focus banks changed; review the course content before generating it.');
requireCourse(JSON.stringify(sourceCourse.startingWordSuggestions) === '["mat","dad","hat"]', 'the confirmed-starter choices must be mat, dad and hat.');
for (const [name, count] of Object.entries({ openingCount: 3, focusCount: 4, closingCount: 3 })) {
  requireCourse(sourceCourse.roundRecipe[name] === count, `${name} must be ${count}.`);
}

const appSource = readFileSync(appFile, 'utf8');
const currentWordLiteral = appSource.match(/const WORDS_CONTENT\s*=\s*(\[[\s\S]*?^\]);/m);
requireCourse(currentWordLiteral !== null, 'the static app vocabulary was not found.');
const currentWords = runInNewContext(currentWordLiteral[1], Object.create(null), { timeout: 100 });
requireCourse(Array.isArray(currentWords), 'the static app vocabulary is not an array.');
const currentWordByDisplay = new Map();
const currentWordIds = new Set();
for (const word of currentWords) {
  requireText(word.display, 'current word display');
  requireText(word.id, 'current word id');
  requireCourse(!currentWordByDisplay.has(word.display) && !currentWordIds.has(word.id), `current word ${word.display} repeats.`);
  currentWordByDisplay.set(word.display, word);
  currentWordIds.add(word.id);
}
for (const word of sourceCourse.startingWordSuggestions) requireCourse(currentWordByDisplay.get(word)?.id === `word:${word}`, `starter ${word} must keep its existing word identity.`);

const artworkCatalog = JSON.parse(readFileSync(artworkFile, 'utf8'));
requireCourse(artworkCatalog.schemaVersion === 1 && artworkCatalog.existingArtwork.length === 10 && artworkCatalog.tankPhotographs.length === 31, 'the artwork catalog must contain ten existing pictures and 31 photographs.');
const artworkByPath = new Map();
const artworkSha256ByPath = new Map();
const photographPaths = new Set(artworkCatalog.tankPhotographs.map(photograph => photograph.path));
for (const artwork of [...artworkCatalog.existingArtwork, ...artworkCatalog.tankPhotographs]) {
  requireText(artwork.title, 'artwork title');
  requireCourse(/^images\/[a-z0-9_/-]+\.jpg$/.test(artwork.path), `invalid artwork path ${artwork.path}.`);
  requireCourse(!artworkByPath.has(artwork.path), `artwork ${artwork.path} repeats.`);
  const bytes = readFileSync(new URL('../../' + artwork.path, import.meta.url));
  requireCourse(bytes.length > 0, `artwork ${artwork.path} is empty.`);
  const digest = sha256(bytes);
  if (photographPaths.has(artwork.path)) {
    for (const field of ['sourceTitle', 'author', 'sourcePageUrl', 'license', 'licenseUrl', 'modifications', 'sha256']) requireText(artwork[field], `photograph ${artwork.path} ${field}`);
    for (const field of ['sourcePageUrl', 'licenseUrl']) requireCourse(['http:', 'https:'].includes(new URL(artwork[field]).protocol), `${artwork.path} ${field} must be a web link.`);
    requireCourse(digest === artwork.sha256 && bytes.length === artwork.byteLength, `photograph ${artwork.path} differs from its recorded asset.`);
  }
  artworkByPath.set(artwork.path, artwork);
  artworkSha256ByPath.set(artwork.path, digest);
}

const focusIds = new Set();
const focusWords = new Set();
const introducedWords = new Set(sourceCourse.startingWordSuggestions);
const assignedArtwork = new Set();
const assignedArtworkDigests = new Set();
const declaredClipKeys = new Set();
const additionalWords = [];
const levels = sourceCourse.levels.map((level, index) => {
  requireCourse(level.level === index + 1, 'level numbers must be sequential.');
  for (const field of ['id', 'phase', 'focus', 'spokenRule', 'artwork']) requireText(level[field], `level ${level.level} ${field}`);
  requireCourse(/^[a-z0-9-]+$/.test(level.id) && !focusIds.has(level.id), `level ${level.level} focus identity is invalid or repeated.`);
  requireCourse(Array.isArray(level.focusWords) && level.focusWords.length > 0, `level ${level.level} has no focus words.`);
  requireCourse(Array.isArray(level.prerequisiteFocusIds) && new Set(level.prerequisiteFocusIds).size === level.prerequisiteFocusIds.length, `level ${level.level} prerequisites are invalid or repeated.`);
  for (const id of level.prerequisiteFocusIds) requireCourse(focusIds.has(id), `level ${level.level} requires a focus not taught earlier: ${id}.`);
  requireCourse(Array.isArray(level.reviewWordCandidates) && level.reviewWordCandidates.length > 0 && new Set(level.reviewWordCandidates).size === level.reviewWordCandidates.length, `level ${level.level} review candidates are invalid or repeated.`);
  for (const word of level.reviewWordCandidates) requireCourse(introducedWords.has(word) && !level.focusWords.includes(word), `level ${level.level} review word ${word} is not an earlier word or starter.`);
  requireCourse(Array.isArray(level.rulePlaybackSteps) && level.rulePlaybackSteps.length > 0, `level ${level.level} needs a declared rule lesson.`);
  for (const step of level.rulePlaybackSteps) {
    if (step.kind === 'speech') {
      requireText(step.text, `level ${level.level} rule speech`);
      requireCourse(Object.keys(step).every(key => ['kind', 'text', 'rate', 'pauseAfterMs'].includes(key)), `level ${level.level} speech has unknown fields.`);
      if (Object.hasOwn(step, 'rate')) requireCourse(Number.isFinite(step.rate) && step.rate > 0, `level ${level.level} speech rate is invalid.`);
      if (Object.hasOwn(step, 'pauseAfterMs')) requireCourse(Number.isInteger(step.pauseAfterMs) && step.pauseAfterMs >= 0, `level ${level.level} pause duration is invalid.`);
    } else {
      requireCourse(step.kind === 'recorded-sound' && /^[a-z]+$/.test(step.clipKey), `level ${level.level} sound step is invalid.`);
      requireCourse(Object.keys(step).every(key => ['kind', 'clipKey'].includes(key)), `level ${level.level} sound has unknown fields.`);
      requireCourse(readFileSync(new URL(`../../audio/letters/${step.clipKey}.mp3`, import.meta.url)).length > 0, `sound ${step.clipKey} is empty.`);
      declaredClipKeys.add(step.clipKey);
    }
  }
  const artwork = artworkByPath.get(level.artwork);
  requireCourse(artwork !== undefined && !assignedArtwork.has(level.artwork), `level ${level.level} artwork is missing or reused.`);
  const artworkDigest = artworkSha256ByPath.get(level.artwork);
  requireCourse(!assignedArtworkDigests.has(artworkDigest), `level ${level.level} repeats another picture's image content.`);
  assignedArtwork.add(level.artwork);
  assignedArtworkDigests.add(artworkDigest);
  for (const word of level.focusWords) {
    requireCourse(/^[a-z]+$/.test(word) && !focusWords.has(word), `focus word ${word} is invalid or repeated.`);
    const existingWord = currentWordByDisplay.get(word);
    if (existingWord) requireCourse(existingWord.id === `word:${word}`, `focus word ${word} must keep its existing identity.`);
    else {
      requireCourse(!currentWordIds.has(`word:${word}`), `new word identity word:${word} already exists.`);
      additionalWords.push({ id: `word:${word}`, display: word, accepted: [word], level: level.level });
    }
    focusWords.add(word);
    introducedWords.add(word);
  }
  focusIds.add(level.id);
  const artworkCredit = photographPaths.has(level.artwork) ? {
    title: artwork.sourceTitle.replace(/\s+/g, ' ').trim(),
    author: artwork.author.replace(/\s+/g, ' ').trim(),
    sourcePageUrl: artwork.sourcePageUrl,
    license: artwork.license,
    licenseUrl: artwork.licenseUrl,
    modifications: artwork.modifications,
  } : null;
  return {
    level: level.level,
    id: level.id,
    phase: level.phase,
    focus: level.focus,
    focusWords: level.focusWords,
    focusWordIds: level.focusWords.map(word => `word:${word}`),
    rulePlaybackSteps: level.rulePlaybackSteps,
    artwork: level.artwork,
    artworkCredit,
  };
});
requireCourse(focusWords.size === 240 && additionalWords.length === 145, 'the active course must contain 240 focus words, including 145 additions to the original catalog.');
const wordCourse = {
  id: sourceCourse.courseId,
  levels,
  startingWordIds: sourceCourse.startingWordSuggestions.map(word => `word:${word}`),
  additionalWords,
  roundRecipe: { openingCount: 3, focusCount: 4, closingCount: 3 },
};
writeFileSync(moduleFile, '// Generated by logs/tools/build_word_course.mjs. Edit the reviewed course source, not this file.\nconst WORD_COURSE = ' + JSON.stringify(wordCourse, null, 2) + ';\n');
console.log(`Built ${levels.length} active word levels, ${focusWords.size} focus words, ${additionalWords.length} additional words, ${declaredClipKeys.size} declared clips, and ${assignedArtwork.size} distinct pictures.`);
