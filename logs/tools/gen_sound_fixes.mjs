// Emits the app-side data tables (SOUND_FIXES + EXCLUDED_WORDS) from the
// validated audit annotations. The audit file is the single source of truth:
// re-run this after changing it, paste the output into app.js.
//   node logs/tools/gen_sound_fixes.mjs
import { AUDIT } from './sound_audit_data.mjs';

// Sound-family annotations retained for spelling-group rendering.
// The active level declaration alone supplies the displayed rule chip.
const ANNOTATED_SOUND_FAMILIES = new Set([
  'open-syllable', 'final-y', 'y-long-i', 's-says-z', 'voiced-th',
  'ea-team', 'ea-short-e', 'all-family', 'aw-team', 'ow-team', 'ow-says-oh',
  'soft-c', 'soft-g', 'old-family', 'ind-family', 'r-controlled',
  'wa-family', 'ear-near', 'o-says-oh', 'a-says-aw',
]);

const fixes = {};
const excluded = [];
for (const [word, e] of Object.entries(AUDIT)) {
  if (word.startsWith('_')) continue;
  const entry = {};
  if (e.seg) entry.seg = e.seg;
  if (e.speech) entry.speech = { ...e.speech };
  const fams = [];
  if (e.over) {
    entry.over = {};
    for (const [unit, [ipa, clip, tag]] of Object.entries(e.over)) {
      entry.over[unit] = clip.endsWith('!') ? clip.slice(0, -1) : clip;
      if (ANNOTATED_SOUND_FAMILIES.has(tag) && !fams.some(x => x.fam === tag)) fams.push({ fam: tag, unit: unit.split("#")[0] });
    }
  }
  if (e.silent?.length) entry.silent = e.silent;
  if (fams.length) entry.fams = fams;
  const wordTricky = e.tag === 'tricky' || Object.values(e.over || {}).some(v => v[2] === 'tricky');
  if (wordTricky) excluded.push(word);
  else fixes[word] = entry;
}

// Parked irregular words without a complete sound guide.
// Practice eligibility is defined by the active course, independently.
console.log('const EXCLUDED_WORDS = new Set(' + JSON.stringify(excluded.sort()) + ');\n');
console.log('const SOUND_FIXES = ' + JSON.stringify(fixes) + ';');
