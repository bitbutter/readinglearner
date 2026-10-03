// Extract every WORDS_CONTENT entry from app.js, segment each word with the
// app's own logic, and report what sound each unit would play today.
// Usage: node logs/tools/extract_words.mjs > word_segments.json

import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');

// ── Pull WORDS_CONTENT display+level pairs ──────────────────────────────────
const words = [];
const wcRe = /id:\s*'word:[^']+',\s*display:\s*'([^']+)'[^}]*?level:\s*(\d+)/g;
let m;
while ((m = wcRe.exec(src)) !== null) words.push({ display: m[1], level: Number(m[2]) });

// ── Replicate app.js segmentation (copy of the live tables) ─────────────────
const SEGMENT_OVERRIDES = {
  school:   ['s', 'c', 'h', 'oo', 'l'],
  who:      ['w', 'h', 'o'],
  door:     ['d', 'o', 'o', 'r'],
  floor:    ['f', 'l', 'o', 'o', 'r'],
  around:   ['a', 'r', 'o', 'u', 'n', 'd'],
  carry:    ['c', 'a', 'r', 'r', 'y'],
  warm:     ['w', 'a', 'r', 'm'],
  work:     ['w', 'o', 'r', 'k'],
  tomorrow: ['t', 'o', 'm', 'o', 'r', 'r', 'o', 'w'],
  here:     ['h', 'e', 'r', 'e'],
  there:    ['th', 'e', 'r', 'e'],
  where:    ['wh', 'e', 'r', 'e'],
  wherever: ['wh', 'e', 'r', 'e', 'v', 'er'],
  their:    ['th', 'e', 'i', 'r'],
  very:     ['v', 'e', 'r', 'y'],
  every:    ['e', 'v', 'e', 'r', 'y'],
  eight:    ['e', 'i', 'g', 'h', 't'],
  going:    ['g', 'o', 'i', 'ng'],
  queen:    ['qu', 'ee', 'n'],
  earth:    ['e', 'a', 'r', 'th'],
};
const DIGRAPH_TTS = {
  igh: 'eye',  air: 'air', ear: 'air',  ue: 'new',
  sh: 'shh',  ch: 'chuh', th: 'thh', ng: 'ng',  ee: 'eee',  oo: 'ooo',
  qu: 'kwuh', ay: 'ay',   oa: 'oh',  oy: 'oy',  oi: 'oy',   ar: 'ar',
  or: 'or',   er: 'er',   ir: 'er',  wh: 'wuh', ck: 'kuh',  ll: 'lll',
  ss: 'sss',  tt: 'tuh',
};
const DIGRAPHS = Object.keys(DIGRAPH_TTS).sort((a, b) => b.length - a.length);
const LETTER_SOUNDS = {
  a: 'ah',  b: 'buh', c: 'kuh', d: 'duh', e: 'eh',  f: 'fff',
  g: 'guh', h: 'huh', i: 'ih',  j: 'juh', k: 'kuh', l: 'lll',
  m: 'mmm', n: 'nnn', o: 'oh',  p: 'puh', q: 'kwuh', r: 'rrr',
  s: 'sss', t: 'tuh', u: 'uh',  v: 'vvv', w: 'wuh', x: 'ks',
  y: 'yuh', z: 'zzz',
};
const TEAM_SOUND_OVERRIDES = {
  year: { ear: 'ear' }, ear: { ear: 'ear' }, dear: { ear: 'ear' },
  near: { ear: 'ear' }, hear: { ear: 'ear' }, fear: { ear: 'ear' },
};
const MAGIC_E_CLIP = { a: 'ay', i: 'igh', o: 'oa', u: 'ue', e: 'ee' };
const NOT_MAGIC_E = new Set(['have', 'live', 'give', 'gave', 'wore', 'love', 'come', 'some', 'done', 'none', 'came', 'here', 'there', 'where', 'shore', 'store']);
const VOWEL_SET = new Set(['a', 'e', 'i', 'o', 'u']);

function segmentDisplay(display) {
  const lower = display.toLowerCase();
  const override = SEGMENT_OVERRIDES[lower];
  const segs = [];
  if (override) {
    let pos = 0;
    for (const o of override) { segs.push(display.slice(pos, pos + o.length)); pos += o.length; }
    return segs;
  }
  let i = 0;
  while (i < lower.length) {
    const d = DIGRAPHS.find(d => lower.startsWith(d, i));
    const len = d ? d.length : 1;
    segs.push(display.slice(i, i + len));
    i += len;
  }
  return segs;
}
const soundFallback = (key) => LETTER_SOUNDS[key] || DIGRAPH_TTS[key] || null;

function isCVCEShape(segs) {
  if (segs.length !== 4 || segs[3] !== 'e') return false;
  let vowels = 0;
  for (let i = 0; i < 3; i++) if (VOWEL_SET.has(segs[i])) vowels++;
  return vowels === 1;
}

// ── For each word: segments + what each unit plays today ────────────────────
const out = words.map(({ display, level }) => {
  const lower = display.toLowerCase();
  const segs = segmentDisplay(display);
  const cvce = isCVCEShape(segs);
  const magicE = cvce && !NOT_MAGIC_E.has(lower);
  const silentE = NOT_MAGIC_E.has(lower) && segs[segs.length - 1].toLowerCase() === 'e';
  const vowelIdx = cvce ? segs.findIndex(s => VOWEL_SET.has(s)) : -1;
  const lastIdx = segs.length - 1;
  const units = segs.map((seg, idx) => {
    const key = seg.toLowerCase();
    let plays = null, status = 'default';
    if (magicE && idx === vowelIdx) { plays = MAGIC_E_CLIP[key] + '.mp3'; status = 'magic-e-vowel'; }
    else if ((magicE || silentE) && idx === lastIdx) { plays = '(silent)'; status = 'silent-e'; }
    else if (TEAM_SOUND_OVERRIDES[lower]?.[key]) { plays = 'TTS:' + TEAM_SOUND_OVERRIDES[lower][key]; status = 'team-override'; }
    else if (soundFallback(key)) { plays = key + '.mp3'; status = key === 'ear' || key === 'ue' ? 'default-no-clip(tts)' : 'default'; }
    else plays = '(nothing)';
    return { unit: key, plays, status };
  });
  return { word: display, level, segs: segs.map(s => s.toLowerCase()), units };
});

console.log(JSON.stringify(out, null, 1));
console.error(`words: ${words.length}`);
