// Render the proposed word course. This reads the app's static vocabulary only;
// it does not execute the app or read browser progress or recordings.
// Usage: node logs/tools/render_proposed_word_levels.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const proposalFile = new URL('../../plans/word-levels-proposed.json', import.meta.url);
const reviewPageFile = new URL('../../plans/word-levels-proposed.html', import.meta.url);
const coverageFile = new URL('../../plans/word-levels-coverage.json', import.meta.url);
const appFile = new URL('../../app.js', import.meta.url);

function requireCondition(condition, message) {
  if (!condition) throw new Error(`Proposed word course: ${message}`);
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

function readCurrentWordCatalog() {
  const appSource = readFileSync(appFile, 'utf8');
  const wordArray = appSource.match(/const WORDS_CONTENT\s*=\s*(\[[\s\S]*?^\]);/m);
  const excludedArray = appSource.match(/const EXCLUDED_WORDS\s*=\s*new Set\((\[[^\r\n]*\])\);/);
  requireCondition(wordArray !== null, 'app.js WORDS_CONTENT static array was not found.');
  requireCondition(excludedArray !== null, 'app.js EXCLUDED_WORDS static array was not found.');
  const words = runInNewContext(wordArray[1], Object.create(null), { timeout: 100 });
  const excludedWords = runInNewContext(excludedArray[1], Object.create(null), { timeout: 100 });
  requireCondition(Array.isArray(words) && Array.isArray(excludedWords), 'the app vocabulary constants must evaluate to arrays.');
  const wordDisplays = new Set();
  const wordIds = new Set();
  for (const word of words) {
    requireText(word.id, 'current word id');
    requireText(word.display, 'current word display');
    requireCondition(word.id.startsWith('word:') && !wordIds.has(word.id), `current word id ${word.id} is invalid or repeated.`);
    requireCondition(Number.isInteger(word.level) && word.level > 0, `current level for ${word.display} is invalid.`);
    requireCondition(!wordDisplays.has(word.display), `current vocabulary repeats ${word.display}.`);
    wordDisplays.add(word.display);
    wordIds.add(word.id);
  }
  requireTextList(excludedWords, 'current excluded words');
  requireCondition(new Set(excludedWords).size === excludedWords.length, 'current excluded words repeat an entry.');
  for (const word of excludedWords) requireCondition(wordDisplays.has(word), `excluded word ${word} is missing from the current catalog.`);
  return { words, excludedWords: new Set(excludedWords) };
}

function compareWordCoverage(proposal, currentCatalog) {
  const proposedLevelByWord = new Map(proposal.levels.flatMap(level => level.focusWords.map(word => [word, level.level])));
  const currentWordByDisplay = new Map(currentCatalog.words.map(word => [word.display, word]));
  const retainedActiveWords = [];
  const reintroducedExcludedWords = [];
  const parkedActiveWords = [];
  const parkedExcludedWords = [];
  for (const word of currentCatalog.words) {
    const record = { wordId: word.id, word: word.display, currentLevel: word.level };
    if (proposedLevelByWord.has(word.display)) {
      record.proposedLevel = proposedLevelByWord.get(word.display);
      (currentCatalog.excludedWords.has(word.display) ? reintroducedExcludedWords : retainedActiveWords).push(record);
    } else {
      (currentCatalog.excludedWords.has(word.display) ? parkedExcludedWords : parkedActiveWords).push(record);
    }
  }
  const newFocusWords = [...proposedLevelByWord].filter(([word]) => !currentWordByDisplay.has(word))
    .map(([word, proposedLevel]) => ({ word, proposedLevel }));
  const sortAlphabetically = records => records.sort((left, right) => left.word.localeCompare(right.word, 'en'));
  [retainedActiveWords, reintroducedExcludedWords, parkedActiveWords, parkedExcludedWords, newFocusWords].forEach(sortAlphabetically);
  const parkedBuiltInWords = sortAlphabetically([...parkedActiveWords, ...parkedExcludedWords]);
  const counts = {
    proposedLevels: proposal.levels.length,
    proposedFocusWords: proposedLevelByWord.size,
    currentBuiltInWords: currentCatalog.words.length,
    currentActiveWords: currentCatalog.words.length - currentCatalog.excludedWords.size,
    currentExcludedWords: currentCatalog.excludedWords.size,
    retainedActiveWords: retainedActiveWords.length,
    reintroducedExcludedWords: reintroducedExcludedWords.length,
    newFocusWords: newFocusWords.length,
    parkedActiveWords: parkedActiveWords.length,
    parkedExcludedWords: parkedExcludedWords.length,
    parkedBuiltInWords: parkedBuiltInWords.length,
  };
  requireCondition(counts.proposedFocusWords === counts.retainedActiveWords + counts.reintroducedExcludedWords + counts.newFocusWords, 'proposed word coverage does not reconcile.');
  requireCondition(counts.currentBuiltInWords === counts.retainedActiveWords + counts.reintroducedExcludedWords + counts.parkedBuiltInWords, 'current word coverage does not reconcile.');
  return { counts, retainedActiveWords, reintroducedExcludedWords, newFocusWords, parkedActiveWords, parkedExcludedWords, parkedBuiltInWords };
}

function validateProposal(proposal) {
  requireCondition(proposal.status === 'proposed', 'this renderer is for a proposal.');
  requireTextList(proposal.startingWordSuggestions, 'starting word suggestions');
  requireCondition(Array.isArray(proposal.levels) && proposal.levels.length > 0, 'levels are missing.');
  const earlierFocusIds = new Set();
  const earlierWords = new Set(proposal.startingWordSuggestions);
  const focusWords = new Set();
  for (const [index, level] of proposal.levels.entries()) {
    requireCondition(level.level === index + 1, 'level numbers must be sequential.');
    for (const field of ['id', 'phase', 'focus', 'spokenRule', 'artwork']) requireText(level[field], `level ${level.level} ${field}`);
    requireCondition(!earlierFocusIds.has(level.id), `focus id ${level.id} repeats.`);
    requireTextList(level.focusWords, `level ${level.level} focus words`);
    requireTextList(level.prerequisiteFocusIds, 'prerequisite focus ids', true);
    requireTextList(level.reviewWordCandidates, 'review candidates');
    requireTextList(level.notes, 'notes', true);
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

function renderReviewPage(proposal, coverage) {
  const e = htmlEscape;
  const list = values => `<ul>${values.map(value => `<li>${e(value)}</li>`).join('')}</ul>`;
  const levelById = new Map(proposal.levels.map(level => [level.id, level]));
  const levels = proposal.levels.map(level => {
    const prerequisites = level.prerequisiteFocusIds.map(id => levelById.get(id).focus);
    const search = [level.level, level.focus, level.phase, ...level.focusWords].join(' ').toLowerCase();
    return `<article class="level" data-search="${e(search)}" data-phase="${e(level.phase)}">
      <div class="level-number">${level.level}</div><div class="level-body">
      <div class="phase">${e(level.phase)}</div><h3>${e(level.focus)}</h3>
      <p class="focus-words">${level.focusWords.map(word => `<strong>${e(word)}</strong>`).join(' ')}</p>
      <p class="review"><span>Familiar-word candidates:</span> ${level.reviewWordCandidates.map(e).join(', ')} <small>— only if already known</small></p>
      <details><summary>Rule wording &amp; teaching notes</summary><p>“${e(level.spokenRule)}”</p>
      <p>Builds on all earlier levels.${prerequisites.length ? ` Especially: ${prerequisites.map(e).join('; ')}.` : ''}</p>${list(level.notes)}</details>
      </div></article>`;
  }).join('\n');
  const c = coverage.counts;
  const wordCoverageSection = (title, records) => `<details class="coverage-list"><summary>${e(title)} (${records.length})</summary><p>${records.map(record => `${e(record.word)}${record.proposedLevel ? ` <small>L${record.proposedLevel}</small>` : ''}`).join(' · ')}</p></details>`;
  const phaseOptions = [...new Set(proposal.levels.map(level => level.phase))].map(phase => `<option value="${e(phase)}">${e(phase)}</option>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(proposal.title)} — proposed word course</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ee;color:#21333b;font:17px/1.55 system-ui,sans-serif}main{max-width:1050px;margin:auto;padding:38px 24px 70px}h1{font-size:clamp(30px,5vw,48px);line-height:1.12;margin:14px 0}h2{font-size:25px;margin:28px 0 10px}h3{font-size:21px;margin:3px 0 12px}p{margin:10px 0}.badge{display:inline-block;background:#e6e0bf;color:#564c21;padding:5px 12px;border-radius:20px;font-size:14px;font-weight:650}.lede{max-width:780px}.count{font-weight:700;color:#246377}.scope{border-left:4px solid #ae8e43;padding-left:14px;color:#5c542f}.round{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.round>div{background:#e8efed;padding:18px;border-radius:10px}.round strong{display:block;font-size:19px}.panel{background:#fff;border:1px solid #dce1dd;border-radius:12px;padding:20px;margin:18px 0}.filters{display:flex;gap:14px;margin:18px 0;flex-wrap:wrap}.filters label{flex:1;min-width:230px;font-weight:650;font-size:15px}input,select{width:100%;margin-top:5px;padding:11px;border:1px solid #b2bcb9;border-radius:7px;background:white;color:inherit;font:inherit}.level{display:flex;gap:20px;background:white;border:1px solid #dce1dd;border-radius:12px;margin:12px 0;padding:20px}.level-number{flex:0 0 48px;height:48px;display:grid;place-items:center;background:#246377;color:white;font-size:22px;font-weight:700;border-radius:50%}.level-body{min-width:0;flex:1}.phase{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#627674}.focus-words{display:flex;flex-wrap:wrap;gap:9px}.focus-words strong{background:#e6f0ef;border-radius:6px;padding:4px 12px;font-size:21px;color:#153f4a}.review{font-size:15px;color:#5d6b6b}.review span{font-weight:600}small{font-size:13px;color:#627674}summary{cursor:pointer;color:#246377;font-weight:600}details p,details ul{font-size:15px}details{margin-top:10px}li+li{margin-top:7px}a{color:#17617e}code{font-size:13px}footer{margin-top:28px;color:#627674;font-size:14px}.coverage-list p{line-height:1.9}.technical li{margin-bottom:18px}.technical b{display:block}.empty{padding:20px;text-align:center}[hidden]{display:none!important}button{padding:9px 16px;border:1px solid #b2bcb9;border-radius:7px;background:white;color:#246377;font:inherit;cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid #d7ae53;outline-offset:3px}
@media(max-width:600px){main{padding:24px 14px}.round{grid-template-columns:1fr}.level{gap:12px;padding:15px}.level-number{flex-basis:36px;height:36px;font-size:18px}.focus-words strong{font-size:19px;padding:3px 9px}}
@media print{body{background:white;font-size:11pt}main{padding:0;max-width:none}h1{font-size:26pt}.filters,button{display:none}.level{break-inside:avoid;border-radius:0}.focus-words strong{background:none;padding:0;margin-right:8px;font-size:13pt}.level-number{background:none;color:black}.panel{break-inside:avoid}details{font-size:10pt}}
</style></head><body><main>
<header><span class="badge">Proposed · ${e(proposal.createdDate)}</span><h1>${e(proposal.title)}</h1>
<p class="lede">${e(proposal.description)}</p><p class="count">${c.proposedLevels} small levels · ${c.proposedFocusWords} focus words · usually 6 words per level</p>
<p class="scope">${e(proposal.scope)}</p></header>
<section aria-labelledby="practice-heading"><h2 id="practice-heading">A practice round</h2><div class="round">
<div><strong>${proposal.roundRecipe.openingCount} familiar words</strong>${e(proposal.roundRecipe.opening)}</div>
<div><strong>${proposal.roundRecipe.focusCount} focus encounters</strong>${e(proposal.roundRecipe.focus)}</div>
<div><strong>${proposal.roundRecipe.closingCount} familiar words</strong>${e(proposal.roundRecipe.closing)}</div></div>
<p>${e(proposal.completion.description)}</p><p>${e(proposal.completion.familiarWords)} ${e(proposal.completion.earnedProgress)}</p></section>
<section class="panel"><h2>Check the starting point</h2>${list(proposal.startingSkills)}
<p>Possible familiar starters: <b>${proposal.startingWordSuggestions.map(e).join(', ')}</b>.</p><p>${e(proposal.startingWordsNote)}</p>
<details><summary>If these starting skills are not ready</summary><p>${e(proposal.roundRecipe.noKnownWords)}</p></details></section>
<section aria-labelledby="levels-heading"><h2 id="levels-heading">The proposed levels</h2><p>${e(proposal.prerequisitesNote)}</p>
<p>Bold words practise the level’s focus. Familiar-word candidates are optional; use them only after he knows them.</p>
<div class="filters"><label>Find a rule or focus word<input id="word-search" type="search" placeholder="e.g. th, moon, short a"></label>
<label>Show a group<select id="phase-filter"><option value="">All groups</option>${phaseOptions}</select></label></div>
<p id="visible-count" role="status">Showing all ${c.proposedLevels} levels</p><div id="levels">${levels}</div><p id="empty" class="empty" hidden>No levels match. Try another rule or word.</p></section>
<section class="panel"><h2>What happens to the old words?</h2><p>${c.retainedActiveWords + c.reintroducedExcludedWords} existing words are in these banks; ${c.newFocusWords} words are new. ${c.parkedBuiltInWords} existing words are parked outside this core sequence. Their progress records would be preserved.</p>
<p>Some later topics need separate levels: ${proposal.deferredPatterns.map(pattern => e(pattern.pattern.toLowerCase())).join('; ')}.</p>
<details><summary>Deferred topics and reasons</summary>${list(proposal.deferredPatterns.map(pattern => `${pattern.pattern}: ${pattern.reason}`))}</details>
${wordCoverageSection('Existing active words kept', coverage.retainedActiveWords)}
${wordCoverageSection('Previously excluded words introduced here', coverage.reintroducedExcludedWords)}
${wordCoverageSection('New focus words', coverage.newFocusWords)}
${wordCoverageSection('All existing words parked', coverage.parkedBuiltInWords)}
<p><a href="word-levels-coverage.json">Download the coverage list</a> · <a href="word-levels-proposed.json">Download the exact course map</a></p></section>
<section class="panel"><h2>Review before adoption</h2>${list(proposal.reviewNotes)}<p>${e(proposal.completion.selfCheck)}</p><p>${e(proposal.completion.restart)}</p>
<p>This draft uses the principle of a systematic progression. It is a custom map, not a validated teaching programme.</p>
${proposal.sources.map(source => `<p><a href="${e(source.url)}">${e(source.title)}</a><br><small>${e(source.purpose)}</small></p>`).join('')}</section>
<details class="panel technical"><summary>Changes needed in the app before adoption</summary>
<p>${e(proposal.completion.ruleChips)}</p><ol>${proposal.implementationNotes.map(note => `<li><b>OLD:</b>${e(note.before)}<b>CHANGES_TO:</b>${e(note.after)}<b>REASON:</b>${e(note.reason)}</li>`).join('')}</ol>
<details><summary>Explicit artwork reuse map</summary>${list(proposal.levels.map(level => `Level ${level.level}: ${level.artwork}`))}</details></details>
<footer>Course map ${e(proposal.courseId)} · Generated from the reviewed word-list file. Structural validation checks counts, unique words and earlier prerequisites; it does not validate pronunciation.</footer>
</main><script>
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

const proposal = JSON.parse(readFileSync(proposalFile, 'utf8'));
validateProposal(proposal);
const coverage = compareWordCoverage(proposal, readCurrentWordCatalog());
writeFileSync(coverageFile, JSON.stringify({ courseId: proposal.courseId, createdDate: proposal.createdDate, ...coverage }, null, 2) + '\n');
writeFileSync(reviewPageFile, renderReviewPage(proposal, coverage));
console.log(JSON.stringify({ validation: 'passed', ...coverage.counts }, null, 2));
