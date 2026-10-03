// Validate the audit annotations against the extracted word list:
//  - every audited word exists in WORDS_CONTENT
//  - every seg override sums to the word's letters
//  - every overridden/silenced unit exists in the (possibly new) segmentation
//  - positional 'x#n' keys only used when the unit occurs n+ times
//  - clips either are NEW (trailing '!') or exist in audio/letters/
// Then print summary stats. Exit 1 on any error.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { AUDIT } from './sound_audit_data.mjs';

const words = JSON.parse(readFileSync(new URL('./word_segments.json', import.meta.url), 'utf8'));
const byWord = Object.fromEntries(words.map(w => [w.word.toLowerCase(), w]));
const clips = new Set(readdirSync(new URL('../../audio/letters/', import.meta.url)).map(f => f.replace('.mp3', '')));

const errs = [];
let devUnits = 0, newClipWords = new Set(), reused = new Map();
const tagCounts = new Map();

for (const [word, e] of Object.entries(AUDIT)) {
  if (word.startsWith('_')) continue;
  const w = byWord[word];
  if (!w) { errs.push(`${word}: not in WORDS_CONTENT`); continue; }
  const segs = e.seg || w.segs;
  if (e.seg && e.seg.reduce((a, u) => a + u.length, 0) !== word.length)
    errs.push(`${word}: seg override length ${e.seg.reduce((a, u) => a + u.length, 0)} != word length ${word.length} (units slice the display, like SEGMENT_OVERRIDES does)`);
  const resolve = (key) => {
    const m = key.match(/^(.*)#(\d+)$/);
    if (!m) return [key, 1];
    return [m[1], Number(m[2])];
  };
  const units = [...(Object.keys(e.over || {})), ...(e.silent || [])];
  for (const key of units) {
    const [unit, n] = resolve(key);
    const occurrences = segs.filter(s => s === unit).length;
    if (occurrences === 0) errs.push(`${word}: unit "${unit}" not in segs [${segs}]`);
    if (key.includes('#') && occurrences < 2) errs.push(`${word}: positional "${key}" but "${unit}" occurs ${occurrences}x`);
    if (!key.includes('#') && occurrences > 1) errs.push(`${word}: "${unit}" occurs ${occurrences}x — use positional notation`);
  }
  for (const [key, [ipa, clip, tag]] of Object.entries(e.over || {})) {
    devUnits++;
    tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    if (clip.endsWith('!')) { newClipWords.add(word); continue; }
    if (clip === 'ue' || clip === 'ear') continue; // known TTS-only fallbacks
    if (!clips.has(clip)) errs.push(`${word}.${key}: clip "${clip}.mp3" missing in audio/letters (TTS-only?)`);
    else reused.set(clip, (reused.get(clip) || 0) + 1);
  }
}

// summary
const audited = Object.keys(AUDIT).filter(k => !k.startsWith('_')).length;
console.log(`words in vocabulary:        ${words.length}`);
console.log(`words with deviations:      ${audited} (${(audited / words.length * 100).toFixed(0)}%)`);
console.log(`fully default-decodable:    ${words.length - audited}`);
console.log(`deviating units total:      ${devUnits}`);
console.log(`words needing NEW clips:    ${[...newClipWords].length}  [${[...newClipWords].join(', ')}]`);
console.log(`\nby tag:`);
[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${String(n).padStart(2)}  ${t}`));
console.log(`\nreused existing clips:`);
[...reused.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(`  ${String(n).padStart(2)}  ${c}.mp3`));

if (errs.length) { console.error(`\nERRORS (${errs.length}):`); errs.forEach(e => console.error('  ' + e)); process.exit(1); }
console.log('\nVALIDATION CLEAN');
