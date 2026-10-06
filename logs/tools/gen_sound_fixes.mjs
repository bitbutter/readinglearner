// Emits the app-side data tables (SOUND_FIXES + EXCLUDED_WORDS) from the
// validated audit annotations. The audit file is the single source of truth:
// re-run this after changing it, paste the output into app.js.
//   node logs/tools/gen_sound_fixes.mjs
import { AUDIT } from './sound_audit_data.mjs';

// Families that get a rule chip + rule-block clustering. 'schwa' is an
// approximation (no chip), 'magic-e' has its own long-standing visual
// language, 'silent-e'/'tricky' are not teaching families here.
const CHIP_FAMS = new Set([
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
  const fams = [];
  if (e.over) {
    entry.over = {};
    for (const [unit, [ipa, clip, tag]] of Object.entries(e.over)) {
      entry.over[unit] = clip.endsWith('!') ? clip.slice(0, -1) : clip;
      if (CHIP_FAMS.has(tag) && !fams.some(x => x.fam === tag)) fams.push({ fam: tag, unit: unit.split("#")[0] });
    }
  }
  if (e.silent?.length) entry.silent = e.silent;
  if (fams.length) entry.fams = fams;
  const wordTricky = e.tag === 'tricky' || Object.values(e.over || {}).some(v => v[2] === 'tricky');
  if (wordTricky) excluded.push(word);
  else fixes[word] = entry;
}

// Words excluded from practice (the 29 rule-breakers) — kept here so the
// table below only holds words the child will actually meet.
console.log('const EXCLUDED_WORDS = new Set(' + JSON.stringify(excluded.sort()) + ');\n');
console.log('const SOUND_FIXES = ' + JSON.stringify(fixes) + ';');
