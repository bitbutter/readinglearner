// Render the active word-course guide. This reads the app's original vocabulary only;
// it does not execute the app or read browser progress or recordings.
// Usage: node logs/tools/render_proposed_word_levels.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const courseFile = new URL('../../plans/word-levels-proposed.json', import.meta.url);
const reviewPageFile = new URL('../../plans/word-levels-proposed.html', import.meta.url);
const coverageFile = new URL('../../plans/word-levels-coverage.json', import.meta.url);
const appFile = new URL('../../app.js', import.meta.url);

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Word-course guide: ${message}`);
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function requireText(value, name) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, `${name} must be nonempty text.`);
}

function requireTextList(value, name, allowEmpty = false) {
  requireCondition(Array.isArray(value) && (allowEmpty || value.length > 0), `${name} must be an array${allowEmpty ? '' : ' with at least one entry'}.`);
  value.forEach((text, index) => requireText(text, `${name}[${index}]`));
}

function readOriginalWordCatalog() {
  const appSource = readFileSync(appFile, 'utf8');
  const wordArray = appSource.match(/const WORDS_CONTENT\s*=\s*(\[[\s\S]*?^\]);/m);
  requireCondition(wordArray !== null, 'app.js WORDS_CONTENT static array was not found.');
  const words = runInNewContext(wordArray[1], Object.create(null), { timeout: 100 });
  requireCondition(Array.isArray(words), 'the original app vocabulary must evaluate to an array.');
  const wordDisplays = new Set();
  const originalWordIds = new Set();
  for (const word of words) {
    requireText(word.id, 'original word id');
    requireText(word.display, 'original word display');
    requireCondition(word.id.startsWith('word:') && !originalWordIds.has(word.id), `original word id ${word.id} is invalid or repeated.`);
    requireCondition(Number.isInteger(word.level) && word.level > 0, `original level for ${word.display} is invalid.`);
    requireCondition(!wordDisplays.has(word.display), `original vocabulary repeats ${word.display}.`);
    wordDisplays.add(word.display);
    originalWordIds.add(word.id);
  }
  return { words, originalWordIds: [...originalWordIds] };
}

function compareWordCoverage(course, originalCatalog) {
  const courseLevelByWord = new Map(course.levels.flatMap(level => level.focusWords.map(word => [word, level.level])));
  const originalWordByDisplay = new Map(originalCatalog.words.map(word => [word.display, word]));
  const retainedOriginalFocusWords = [];
  const parkedOriginalWords = [];
  for (const word of originalCatalog.words) {
    const record = { originalWordId: word.id, word: word.display, originalLevel: word.level };
    if (courseLevelByWord.has(word.display)) {
      record.courseLevel = courseLevelByWord.get(word.display);
      retainedOriginalFocusWords.push(record);
    } else {
      parkedOriginalWords.push(record);
    }
  }
  const additionalFocusWords = [...courseLevelByWord].filter(([word]) => !originalWordByDisplay.has(word))
    .map(([word, courseLevel]) => ({ wordId: `word:${word}`, word, courseLevel }));
  const familiarStarterWords = course.startingWordSuggestions.map(word => {
    const originalWord = originalWordByDisplay.get(word);
    requireCondition(originalWord !== undefined && !courseLevelByWord.has(word), `familiar starter ${word} must be an original word outside the focus banks.`);
    return { originalWordId: originalWord.id, word, originalLevel: originalWord.level };
  });
  const sortAlphabetically = records => records.sort((left, right) => left.word.localeCompare(right.word, 'en'));
  [retainedOriginalFocusWords, parkedOriginalWords, additionalFocusWords, familiarStarterWords].forEach(sortAlphabetically);
  const counts = {
    courseLevels: course.levels.length,
    courseFocusWords: courseLevelByWord.size,
    originalCatalogWords: originalCatalog.words.length,
    retainedOriginalFocusWords: retainedOriginalFocusWords.length,
    additionalFocusWords: additionalFocusWords.length,
    parkedOriginalWords: parkedOriginalWords.length,
    familiarStarterWords: familiarStarterWords.length,
  };
  requireCondition(counts.courseFocusWords === counts.retainedOriginalFocusWords + counts.additionalFocusWords, 'active focus coverage does not reconcile.');
  requireCondition(counts.originalCatalogWords === counts.retainedOriginalFocusWords + counts.parkedOriginalWords, 'original catalog coverage does not reconcile.');
  return {
    descriptions: {
      originalWordIds: 'Stable identities from the original 286-word WORDS_CONTENT catalog, before the active course additions.',
      originalLevel: 'The original catalog level; it does not determine membership or progression in the active course.',
      parkedOriginalWords: 'Original words outside the active focus banks. Their progress and tuning remain available.',
      familiarStarterWords: 'These original words are counted within parkedOriginalWords and remain available as familiar starters when mastered or explicitly confirmed by a grown-up.',
    },
    counts,
    originalWordIds: originalCatalog.originalWordIds,
    retainedOriginalFocusWords,
    additionalFocusWords,
    parkedOriginalWords,
    familiarStarterWords,
  };
}

function validateCourse(course) {
  requireCondition(course.status === 'active', 'this renderer requires the active course.');
  requireTextList(course.startingWordSuggestions, 'starting word suggestions');
  requireCondition(Array.isArray(course.levels) && course.levels.length > 0, 'levels are missing.');
  const earlierFocusIds = new Set();
  const earlierWords = new Set(course.startingWordSuggestions);
  const focusWords = new Set();
  for (const [index, level] of course.levels.entries()) {
    requireCondition(level.level === index + 1, 'level numbers must be sequential.');
    for (const field of ['id', 'phase', 'focus', 'spokenRule', 'artwork']) requireText(level[field], `level ${level.level} ${field}`);
    requireCondition(existsSync(new URL('../../' + level.artwork, import.meta.url)), `level ${level.level} artwork is missing.`);
    requireCondition(!earlierFocusIds.has(level.id), `focus id ${level.id} repeats.`);
    requireTextList(level.focusWords, `level ${level.level} focus words`);
    requireTextList(level.prerequisiteFocusIds, 'prerequisite focus ids', true);
    requireTextList(level.reviewWordCandidates, 'review candidates');
    requireTextList(level.notes, 'notes', true);
    requireCondition(Array.isArray(level.rulePlaybackSteps) && level.rulePlaybackSteps.length > 0, `level ${level.level} needs rule playback steps.`);
    for (const step of level.rulePlaybackSteps) {
      if (step.kind === 'speech') {
        requireText(step.text, 'rule speech');
        if (Object.hasOwn(step, 'rate')) requireCondition(Number.isFinite(step.rate) && step.rate > 0, 'rule speech rate must be positive.');
        if (Object.hasOwn(step, 'pauseAfterMs')) requireCondition(Number.isInteger(step.pauseAfterMs) && step.pauseAfterMs >= 0, 'rule speech pause must be a nonnegative millisecond duration.');
      }
      else {
        requireCondition(step.kind === 'recorded-sound', 'unknown rule playback step.');
        requireCondition(/^[a-z]+$/.test(step.clipKey), 'invalid recorded sound key.');
        requireCondition(existsSync(new URL(`../../audio/letters/${step.clipKey}.mp3`, import.meta.url)), `recorded sound ${step.clipKey} is missing.`);
      }
    }
    for (const id of level.prerequisiteFocusIds) requireCondition(earlierFocusIds.has(id), `level ${level.level} requires a focus not previously taught: ${id}.`);
    for (const word of level.reviewWordCandidates) {
      requireCondition(earlierWords.has(word), `review candidate ${word} has not been introduced earlier.`);
      requireCondition(!level.focusWords.includes(word), `word ${word} is both focus and review at level ${level.level}.`);
    }
    for (const word of level.focusWords) {
      requireCondition(/^[a-z]+$/.test(word), `focus word ${word} is not a lowercase word.`);
      requireCondition(!focusWords.has(word), `focus word ${word} repeats across banks.`);
      focusWords.add(word);
      earlierWords.add(word);
    }
    earlierFocusIds.add(level.id);
  }
}

function renderCourseGuide(course, coverage) {
  const e = htmlEscape;
  const list = values => `<ul>${values.map(value => `<li>${e(value)}</li>`).join('')}</ul>`;
  const levelById = new Map(course.levels.map(level => [level.id, level]));
  const levels = course.levels.map(level => {
    const prerequisites = level.prerequisiteFocusIds.map(id => levelById.get(id).focus);
    const search = [level.level, level.focus, level.phase, ...level.focusWords].join(' ').toLowerCase();
    return `<article class="level" data-search="${e(search)}" data-phase="${e(level.phase)}">
      <div class="level-number">${level.level}</div><div class="level-body">
      <div class="phase">${e(level.phase)}</div><h3>${e(level.focus)}</h3>
      <p class="focus-words">${level.focusWords.map(word => `<strong>${e(word)}</strong>`).join(' ')}</p>
      <p class="review"><span>Familiar-word candidates:</span> ${level.reviewWordCandidates.map(e).join(', ')} <small>— only if already known</small></p>
      <button class="rule-preview" data-rule-id="${e(level.id)}" aria-label="Listen to the rule for level ${level.level}: ${e(level.focus)}">Listen to this rule</button>
      <span class="rule-preview-status" role="status"></span>
      <details><summary>Rule wording &amp; teaching notes</summary><p>“${e(level.spokenRule)}”</p>
      <p>Builds on all earlier levels.${prerequisites.length ? ` Especially: ${prerequisites.map(e).join('; ')}.` : ''}</p>${list(level.notes)}</details>
      </div></article>`;
  }).join('\n');
  const c = coverage.counts;
  const wordCoverageSection = (title, records) => `<details class="coverage-list"><summary>${e(title)} (${records.length})</summary><p>${records.map(record => `${e(record.word)}${record.courseLevel ? ` <small>L${record.courseLevel}</small>` : ''}`).join(' · ')}</p></details>`;
  const phaseOptions = [...new Set(course.levels.map(level => level.phase))].map(phase => `<option value="${e(phase)}">${e(phase)}</option>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(course.title)} — active word course</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ee;color:#21333b;font:17px/1.55 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:38px 24px 70px}h1{font-size:clamp(30px,5vw,48px);line-height:1.12;margin:14px 0}h2{font-size:25px;margin:28px 0 10px}h3{font-size:21px;margin:3px 0 12px}p{margin:10px 0}.badge{display:inline-block;background:#e6e0bf;color:#564c21;padding:5px 12px;border-radius:20px;font-size:14px;font-weight:650}.lede{max-width:780px}.count{font-weight:700;color:#246377}.scope{border-left:4px solid #ae8e43;padding-left:14px;color:#5c542f}.round{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.round>div{background:#e8efed;padding:18px;border-radius:10px}.round strong{display:block;font-size:19px}.panel{background:#fff;border:1px solid #dce1dd;border-radius:12px;padding:20px;margin:18px 0}.filters{display:flex;gap:14px;margin:18px 0;flex-wrap:wrap}.filters label{flex:1;min-width:230px;font-weight:650;font-size:15px}input,select{width:100%;margin-top:5px;padding:11px;border:1px solid #b2bcb9;border-radius:7px;background:white;color:inherit;font:inherit}.level{display:flex;gap:20px;background:white;border:1px solid #dce1dd;border-radius:12px;margin:12px 0;padding:20px}.level-number{flex:0 0 48px;height:48px;display:grid;place-items:center;background:#246377;color:white;font-size:22px;font-weight:700;border-radius:50%}.level-body{min-width:0;flex:1}.phase{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#627674}.focus-words{display:flex;flex-wrap:wrap;gap:9px}.focus-words strong{background:#e6f0ef;border-radius:6px;padding:4px 12px;font-size:21px;color:#153f4a}.review{font-size:15px;color:#5d6b6b}.review span{font-weight:600}small{font-size:13px;color:#627674}summary{cursor:pointer;color:#246377;font-weight:600}details p,details ul{font-size:15px}details{margin-top:10px}li+li{margin-top:7px}a{color:#17617e}code{font-size:13px}footer{margin-top:28px;color:#627674;font-size:14px}.coverage-list p{line-height:1.9}.technical li{margin-bottom:18px}.technical b{display:block}.empty{padding:20px;text-align:center}[hidden]{display:none!important}button{padding:9px 16px;border:1px solid #b2bcb9;border-radius:7px;background:white;color:#246377;font:inherit;cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #d7ae53;outline-offset:3px}
.rule-preview-status{font-size:14px;margin-left:10px;color:#627674}
@media(max-width:600px){main{padding:24px 14px}.round{grid-template-columns:1fr}.level{gap:12px;padding:15px}.level-number{flex-basis:36px;height:36px;font-size:18px}.focus-words strong{font-size:19px;padding:3px 9px}}
@media print{body{background:white;font-size:11pt}main{padding:0;max-width:none}h1{font-size:26pt}.filters,button{display:none}.level{break-inside:avoid;border-radius:0}.focus-words strong{background:none;padding:0;margin-right:8px;font-size:13pt}.level-number{background:none;color:black}.panel{break-inside:avoid}details{font-size:10pt}}
</style></head><body><main>
<header><span class="badge">Active word course · ${e(course.createdDate)}</span><h1>${e(course.title)}</h1>
<p class="lede">${e(course.description)}</p><p class="count">${c.courseLevels} small levels · ${c.courseFocusWords} focus words · usually 6 words per level</p>
<p class="scope">${e(course.scope)}</p></header>
<p><a href="word-level-artwork.html">See the artwork for all 41 levels</a></p>
<section aria-labelledby="practice-heading"><h2 id="practice-heading">A practice round</h2><div class="round">
<div><strong>${course.roundRecipe.openingCount} familiar words</strong>${e(course.roundRecipe.opening)}</div>
<div><strong>${course.roundRecipe.focusCount} focus encounters</strong>${e(course.roundRecipe.focus)}</div>
<div><strong>${course.roundRecipe.closingCount} familiar words</strong>${e(course.roundRecipe.closing)}</div></div>
<p>${e(course.completion.description)}</p><p>${e(course.completion.familiarWords)} ${e(course.completion.earnedProgress)}</p></section>
<section class="panel"><h2>Check the starting point</h2>${list(course.startingSkills)}
<p>Starter choices for a grown-up to confirm: <b>${course.startingWordSuggestions.map(e).join(', ')}</b>.</p><p>${e(course.startingWordsNote)}</p>
<details><summary>If these starting skills are not ready</summary><p>${e(course.roundRecipe.noKnownWords)}</p></details></section>
<section aria-labelledby="levels-heading"><h2 id="levels-heading">The word levels</h2><p>${e(course.prerequisitesNote)}</p>
<p>Bold words practise the level’s focus. Familiar-word candidates are optional; use them only after he knows them.</p>
<p>${e(course.rulePlaybackNote)}</p>
<div class="filters"><label>Find a rule or focus word<input id="word-search" type="search" placeholder="e.g. th, moon, short a"></label>
<label>Show a group<select id="phase-filter"><option value="">All groups</option>${phaseOptions}</select></label></div>
<p id="visible-count" role="status">Showing all ${c.courseLevels} levels</p><div id="levels">${levels}</div><p id="empty" class="empty" hidden>No levels match. Try another rule or word.</p></section>
<section class="panel"><h2>The original vocabulary</h2><p>Of the ${c.originalCatalogWords} original words, ${c.retainedOriginalFocusWords} are in the active focus banks and ${c.parkedOriginalWords} are parked outside those banks. The course adds ${c.additionalFocusWords} focus words. Parked words retain their progress records and grown-up tuning.</p>
<p>The ${c.familiarStarterWords} starter choices — ${course.startingWordSuggestions.map(e).join(', ')} — are included in the parked count. They remain separately available for familiar practice when mastered or explicitly confirmed by a grown-up.</p>
<p>Later topics need separate levels: ${course.deferredPatterns.map(pattern => e(pattern.pattern.toLowerCase())).join('; ')}.</p>
<details><summary>Deferred topics and reasons</summary>${list(course.deferredPatterns.map(pattern => `${pattern.pattern}: ${pattern.reason}`))}</details>
${wordCoverageSection('Original words retained as focus words', coverage.retainedOriginalFocusWords)}
${wordCoverageSection('Added focus words', coverage.additionalFocusWords)}
${wordCoverageSection('Original words outside the focus banks', coverage.parkedOriginalWords)}
<p><a href="word-levels-coverage.json">Download the coverage list</a> · <a href="word-levels-proposed.json">Download the exact course map</a></p></section>
<section class="panel"><h2>Teaching notes</h2>${list(course.reviewNotes)}<p>${e(course.completion.selfCheck)}</p><p>${e(course.completion.restart)}</p>
<p>This course follows a systematic progression. It is a custom course rather than a validated teaching programme.</p>
${course.sources.map(source => `<p><a href="${e(source.url)}">${e(source.title)}</a><br><small>${e(source.purpose)}</small></p>`).join('')}</section>
<details class="panel technical"><summary>How the active course works in the app</summary>
<p>${e(course.completion.ruleChips)}</p><ol>${course.implementationNotes.map(note => `<li><b>OLD:</b>${e(note.before)}<b>CHANGES_TO:</b>${e(note.after)}<b>REASON:</b>${e(note.reason)}</li>`).join('')}</ol>
<details><summary>Artwork assignments</summary><p>${e(course.artworkNote)}</p>${list(course.levels.map(level => `Level ${level.level}: ${level.artwork}`))}</details></details>
<footer>Course map ${e(course.courseId)} · Generated from the reviewed word-list file. Structural validation checks counts, unique words and earlier prerequisites; it does not validate pronunciation.</footer>
</main><script type="application/json" id="rule-preview-steps">${JSON.stringify(Object.fromEntries(course.levels.map(level => [level.id, level.rulePlaybackSteps]))).replaceAll('<', '\\u003c')}</script>
<script src="word-rule-preview.js?v=2" defer></script><script>
const wordSearch = document.getElementById('word-search');
const phaseFilter = document.getElementById('phase-filter');
const levelCards = [...document.querySelectorAll('.level')];
function filterLevels() {
  const query = wordSearch.value.trim().toLowerCase();
  let visibleCount = 0;
  for (const card of levelCards) {
    card.hidden = !(card.dataset.search.includes(query) && (!phaseFilter.value || card.dataset.phase === phaseFilter.value));
    if (!card.hidden) visibleCount++;
  }
  document.getElementById('visible-count').textContent = 'Showing ' + visibleCount + ' of ' + levelCards.length + ' levels';
  document.getElementById('empty').hidden = visibleCount > 0;
}
wordSearch.addEventListener('input', filterLevels);
phaseFilter.addEventListener('change', filterLevels);
</script></body></html>\n`;
}

const course = JSON.parse(readFileSync(courseFile, 'utf8'));
validateCourse(course);
const coverage = compareWordCoverage(course, readOriginalWordCatalog());
writeFileSync(coverageFile, JSON.stringify({ courseId: course.courseId, status: course.status, createdDate: course.createdDate, ...coverage }, null, 2) + '\n');
writeFileSync(reviewPageFile, renderCourseGuide(course, coverage));
console.log(JSON.stringify({ validation: 'passed', ...coverage.counts }, null, 2));
