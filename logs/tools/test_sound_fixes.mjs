// Verifies the SOUND_FIXES wiring in app.js end-to-end, without a browser:
// extracts the pure table section from app.js, evals it with a minimal DOM
// shim, then walks every vocabulary word and checks that segmentation,
// clips, silents, tappable flags, chips and rule lessons all resolve.
//   node logs/tools/test_sound_fixes.mjs
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const start = src.indexOf('// Isolated phonetic letter sounds');
const end = src.indexOf('function triggerSoundSpan');
if (start < 0 || end < 0) throw new Error('extraction markers not found');
const section = src.slice(start, end);
const ruleLessonDefinition = src.slice(src.indexOf('function ruleLessonFor(fam, display)'), src.indexOf('let ruleLessonPlaybackSequence'));

// Minimal DOM shim for buildSoundUnitSpans.
function el(tag) {
  const classes = new Set();
  return {
    tagName: tag, children: [], dataset: {}, className: '', textContent: '',
    style: { setProperty() {} },
    set classList(v) {}, get classList() {
      return { add: c => classes.add(c), remove: c => classes.delete(c),
               toggle: (c, f) => f ? classes.add(c) : classes.delete(c),
               contains: c => classes.has(c), _set: classes };
    },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); },
    setAttribute() {}, addEventListener() {},
  };
}
const documentShim = {
  createElement: t => el(t),
  createDocumentFragment: () => el('fragment'),
};

const api = new Function('document', section + ruleLessonDefinition + `
  return { LETTER_SOUNDS, DIGRAPH_TTS, TTS_EXTENDED, EXCLUDED_WORDS, SOUND_FIXES,
           PATTERN_META, FAM_COLOUR, CLIP_NAME, SEGMENT_OVERRIDES, DIGIT_NAMES,
           MAGIC_E_CLIP, NOT_MAGIC_E, segmentDisplay, soundFallback,
           isCVCEShape, buildSoundUnitSpans, ruleLessonFor };`)(documentShim);

const words = JSON.parse(readFileSync(new URL('./word_segments.json', import.meta.url), 'utf8'));
const clips = new Set(readdirSync(new URL('../../audio/letters/', import.meta.url)).map(f => f.replace('.mp3', '')));

const errs = [];
let fixWordsChecked = 0, spansTotal = 0, clipPlays = 0, silentSpans = 0;

for (const w of words) {
  const lower = w.word.toLowerCase();
  const excluded = api.EXCLUDED_WORDS.has(lower);
  const fix = api.SOUND_FIXES[lower];
  if (excluded && fix) errs.push(`${lower}: excluded but still in SOUND_FIXES`);
  if (excluded) continue;
  const frag = api.buildSoundUnitSpans(w.word);
  const spans = frag.children;
  spansTotal += spans.length;

  // every span must be tappable (tap plays a sound) or silent
  for (const s of spans) {
    if (!s.classList.contains('tappable') && !s.dataset.silent)
      errs.push(`${lower}: unit "${s.textContent}" neither tappable nor silent`);
  }
  if (!fix) { fixWordsChecked++; continue; }

  // positional resolution of over/silent keys must hit exactly the right spans
  const counts = {};
  for (const s of spans) {
    const k = s.textContent.toLowerCase();
    counts[k] = (counts[k] || 0) + 1;
    if (s.dataset.clip) clipPlays++;
    if (s.dataset.silent) silentSpans++;
  }
  // positional resolution mirrors the app: occurrence counting over the
  // segmented slices (fix keys must equal the lowercased slice text)
  const segsNow = api.segmentDisplay(w.word).map(s => s.toLowerCase());
  const totals = {};
  segsNow.forEach(u => totals[u] = (totals[u] || 0) + 1);
  const occ = {};
  const idxOf = {};   // "unit" or "unit#n" -> seg index
  segsNow.forEach((u, i) => {
    occ[u] = (occ[u] || 0) + 1;
    idxOf[totals[u] > 1 ? u + '#' + occ[u] : u] = i;
  });
  for (const [key, clip] of Object.entries(fix.over || {})) {
    const i = idxOf[key];
    if (i === undefined) { errs.push(`${lower}: over key "${key}" matches no segment (segs: ${segsNow})`); continue; }
    const hit = spans[i];
    if (!hit || hit.dataset.clip !== clip) errs.push(`${lower}: over "${key}"→"${clip}" not applied (got clip=${hit && hit.dataset.clip})`);
    if (!clips.has(clip) && clip !== 'ue')
      errs.push(`${lower}: clip "${clip}" has no audio file (and isn't the ue TTS exception)`);
  }
  for (const key of fix.silent || []) {
    const i = idxOf[key];
    if (i === undefined) { errs.push(`${lower}: silent key "${key}" matches no segment`); continue; }
    if (!spans[i].dataset.silent) errs.push(`${lower}: silent "${key}" not applied`);
  }
  for (const fe of fix.fams || []) {
    if (!api.PATTERN_META[fe.fam]) errs.push(`${lower}: fam "${fe.fam}" has no PATTERN_META`);
    if (!api.FAM_COLOUR[fe.fam]) errs.push(`${lower}: fam "${fe.fam}" has no FAM_COLOUR`);
    const meta = api.PATTERN_META[fe.fam];
    if (meta) {
      const lesson = api.ruleLessonFor(fe.fam, lower);
      if (!lesson[0]?.text) errs.push(`${lower}: empty rule explanation for ${fe.fam}`);
      for (const step of lesson) {
        if (step.kind === 'recorded-sound' && !clips.has(step.clipKey))
          errs.push(`${lower}: rule lesson clip "${step.clipKey}" has no audio file`);
        if (step.kind === 'speech' && !step.text) errs.push(`${lower}: empty spoken lesson step`);
      }
      const demonstration = lesson.find(step => step.kind === 'recorded-sound' || step.text === 'you');
      const expectedClip = fix.over?.[fe.unit];
      if (expectedClip && (demonstration.clipKey || (demonstration.text === 'you' ? 'ue' : null)) !== expectedClip)
        errs.push(`${lower}: rule sound contradicts its unit clip for ${fe.fam}`);
    }
    if (meta && !meta.praise) errs.push(`${lower}: missing praise for ${fe.fam}`);
  }
}

// The app's generated table must remain identical to the canonical audit.
const generatedTables = execFileSync(process.execPath, [fileURLToPath(new URL('./gen_sound_fixes.mjs', import.meta.url))], { encoding:'utf8' });
for (const tableName of ['SOUND_FIXES', 'EXCLUDED_WORDS']) {
  const definition = new RegExp(`^const ${tableName} = .*;$`, 'm');
  if (src.match(definition)?.[0] !== generatedTables.match(definition)?.[0])
    errs.push(`${tableName}: app table differs from the canonical sound audit generator`);
}

// Rule-block sanity: every level's eligible pool and its families.
const perLevel = {};
for (const w of words) {
  if (api.EXCLUDED_WORDS.has(w.word.toLowerCase())) continue;
  const fams = (api.SOUND_FIXES[w.word.toLowerCase()]?.fams || []).map(f => f.fam);
  (perLevel[w.level] = perLevel[w.level] || { n: 0, fams: new Map() });
  perLevel[w.level].n++;
  for (const f of fams) perLevel[w.level].fams.set(f, (perLevel[w.level].fams.get(f) || 0) + 1);
}
console.log('level | eligible words | families present');
for (const [lvl, d] of Object.entries(perLevel))
  console.log(String(lvl).padStart(3), '  |', String(d.n).padStart(6), '         |', [...d.fams.entries()].map(([f, n]) => f + '×' + n).join(', ') || '(simple)');

console.log(`\nspans built: ${spansTotal}, clip-redirected: ${clipPlays}, silent: ${silentSpans}`);
if (errs.length) { console.error(`\nERRORS (${errs.length}):`); errs.forEach(e => console.error('  ' + e)); process.exit(1); }
console.log('ALL CHECKS CLEAN');
