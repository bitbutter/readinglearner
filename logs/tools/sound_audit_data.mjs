// Phonics audit annotations — phoneme-per-unit deviations from each unit's
// default clip (solo vowel = short sound; s = /s/; c = /k/; g = /g/;
// th = unvoiced; oo = /uː/ moon; ear = air TTS).
//
// Schema per word:
//   seg:     replacement segmentation (units must sum to the word's letters)
//   over:    { unit: [ipa, clip, tag] }  clip 'aw!' = NEW clip needed,
//            otherwise an existing audio/letters/<clip>.mp3
//   silent:  units that should flash but play nothing
//   tag:     classification of the word overall
//   note:    remark for the report
import { WORD_COURSE_SOUND_AUDIT } from './word_course_sound_data.mjs';

const PREVIOUS_WORD_SOUND_AUDIT = {
  // ── existing-data bugs (fix the rule/set, no new entries needed) ──
  _bugs: {
    'gave':   "in NOT_MAGIC_E but IS a magic-e word (/geɪv/) — remove from the set so the a gets the ay clip",
    'came':   "in NOT_MAGIC_E but IS a magic-e word (/keɪm/) — remove from the set",
    'isCVCEShape': "requires exactly 4 segments ending in 'e' — misses CCVCe (write, place), short uCe (use), and r-team+e (are, more, horse): their final e plays /ɛ/ instead of being silent, and write/place never get the long-vowel clip",
    'ea team': "ea is not a digraph, so read/tea/beat/clean/sea/teacher/weather play e=/ɛ/ then a=/æ/ as separate letters",
    'school': "the h unit plays /h/ — school is /skuːl/, h must be silent",
  },

  the:     { over: { th: ['ð', 'thv!', 'voiced-th'] } },
  down:    { seg: ['d','ow','n'], over: { ow: ['aʊ','ow!','ow-team'] } },
  baby:    { over: { a: ['eɪ','ay','open-syllable'], y: ['i','ee','final-y'] } },

  are:     { silent: ['e'], tag: 'tricky', note: 'ar + silent e; sight word' },
  do:      { over: { o: ['uː','oo','tricky'] }, tag: 'tricky' },
  he:      { over: { e: ['iː','ee','open-syllable'] } },
  she:     { over: { e: ['iː','ee','open-syllable'] } },
  be:      { over: { e: ['iː','ee','open-syllable'] } },
  we:      { over: { e: ['iː','ee','open-syllable'] } },
  so:      { over: { o: ['oʊ','oa','open-syllable'] } },
  no:      { over: { o: ['oʊ','oa','open-syllable'] } },

  tiger:   { over: { i: ['aɪ','igh','open-syllable'] } },
  turn:    { seg: ['t','ur','n'], over: { ur: ['ɜːr','er','r-controlled'] } },
  hurt:    { seg: ['h','ur','t'], over: { ur: ['ɜːr','er','r-controlled'] } },
  burn:    { seg: ['b','ur','n'], over: { ur: ['ɜːr','er','r-controlled'] } },
  door:    { seg: ['d','oo','r'], over: { oo: ['ɔːr','or','tricky'] }, tag: 'tricky', note: 'replaces the existing split-letter override' },
  floor:   { seg: ['f','l','oo','r'], over: { oo: ['ɔːr','or','tricky'] }, tag: 'tricky', note: 'replaces the existing split-letter override' },
  more:    { silent: ['e'], tag: 'silent-e' },
  read:    { seg: ['r','ea','d'], over: { ea: ['iː','ee','ea-team'] }, note: 'whole-word TTS may say past-tense /rɛd/ — check' },
  tea:     { seg: ['t','ea'], over: { ea: ['iː','ee','ea-team'] } },
  beat:    { seg: ['b','ea','t'], over: { ea: ['iː','ee','ea-team'] } },
  is:      { over: { s: ['z','z','s-says-z'] } },
  to:      { over: { o: ['uː','oo','tricky'] }, tag: 'tricky' },
  go:      { over: { o: ['oʊ','oa','open-syllable'] } },
  was:     { over: { a: ['ɒ','o','wa-family'], s: ['z','z','s-says-z'] }, note: 'BrE /wɒz/, AmE /wʌz/ — o clip works for BrE' },

  always:  { over: { a: ['ɔː','aw!','all-family'], s: ['z','z','s-says-z'] } },
  around:  { seg: ['a','r','ou','n','d'], over: { a: ['ə','u','schwa'], ou: ['aʊ','ow!','ow-team'] } },
  because: { seg: ['b','e','c','au','s','e'], over: { 'e#1': ['ɪ','i','schwa'], au: ['ɒ','o','tricky'], s: ['z','z','s-says-z'] }, silent: ['e#2'], tag: 'tricky' },
  before:  { over: { 'e#1': ['ɪ','i','schwa'] }, silent: ['e#2'] },
  both:    { over: { o: ['oʊ','oa','o-says-oh'] }, note: 'There is no L here; explain the O in this word without the old-family condition.' },
  buy:     { seg: ['b','uy'], over: { uy: ['aɪ','igh','tricky'] }, tag: 'tricky' },
  call:    { over: { a: ['ɔː','aw!','all-family'] } },
  cold:    { over: { o: ['oʊ','oa','old-family'] } },
  does:    { over: { o: ['ʌ','u','tricky'], s: ['z','z','s-says-z'] }, silent: ['e'], tag: 'tricky' },
  found:   { seg: ['f','ou','n','d'], over: { ou: ['aʊ','ow!','ow-team'] } },
  goes:    { over: { o: ['oʊ','oa','open-syllable'], s: ['z','z','s-says-z'] }, silent: ['e'], tag: 'tricky' },
  many:    { over: { a: ['ɛ','e','tricky'], y: ['i','ee','final-y'] }, tag: 'tricky' },
  pull:    { over: { u: ['ʊ','ooshort!','tricky'] }, tag: 'tricky' },
  their:   { seg: ['th','ei','r'], over: { th: ['ð','thv!','voiced-th'], ei: ['eər','air','tricky'] }, silent: ['r'], tag: 'tricky' },
  these:   { over: { th: ['ð','thv!','voiced-th'], s: ['z','z','s-says-z'] } },
  those:   { over: { th: ['ð','thv!','voiced-th'], s: ['z','z','s-says-z'] } },
  use:     { over: { u: ['juː','ue','open-syllable'], s: ['z','z','s-says-z'] }, silent: ['e'] },
  very:    { over: { y: ['i','ee','final-y'] } },
  wash:    { over: { a: ['ɒ','o','wa-family'] } },
  why:     { over: { y: ['aɪ','igh','y-long-i'] } },
  work:    { seg: ['w','or','k'], over: { or: ['ɜːr','er','tricky'] }, tag: 'tricky' },
  would:   { seg: ['w','ou','l','d'], over: { ou: ['ʊ','ooshort!','tricky'] }, silent: ['l'], tag: 'tricky' },
  write:   { over: { i: ['aɪ','igh','magic-e'] }, silent: ['w','e'], tag: 'magic-e + silent w' },

  about:   { seg: ['a','b','ou','t'], over: { a: ['ə','u','schwa'], ou: ['aʊ','ow!','ow-team'] } },
  carry:   { over: { y: ['i','ee','final-y'] } },
  clean:   { seg: ['c','l','ea','n'], over: { ea: ['iː','ee','ea-team'] } },
  done:    { over: { o: ['ʌ','u','tricky'] }, tag: 'tricky', note: 'already in NOT_MAGIC_E (e silent) ✓' },
  draw:    { seg: ['d','r','aw'], over: { aw: ['ɔː','aw!','aw-team'] } },
  eight:   { seg: ['eigh','t'], over: { eigh: ['eɪ','ay','tricky'] }, tag: 'tricky' },
  fall:    { over: { a: ['ɔː','aw!','all-family'] } },
  full:    { over: { u: ['ʊ','ooshort!','tricky'] }, tag: 'tricky' },
  grow:    { over: { o: ['oʊ','oa','ow-says-oh'] }, silent: ['w'] },
  hold:    { over: { o: ['oʊ','oa','old-family'] } },
  kind:    { over: { i: ['aɪ','igh','ind-family'] } },
  laugh:   { seg: ['l','a','ugh'], over: { ugh: ['f','f','tricky'] }, tag: 'tricky' },
  myself:  { over: { y: ['aɪ','igh','y-long-i'] } },
  only:    { over: { o: ['oʊ','oa','open-syllable'], y: ['i','ee','final-y'] } },
  own:     { over: { o: ['oʊ','oa','ow-says-oh'] }, silent: ['w'] },
  shall:   { note: 'Short /æ/; ordinary A clip. The spelling all does not make the ball vowel here.' },
  show:    { over: { o: ['oʊ','oa','ow-says-oh'] }, silent: ['w'] },
  small:   { over: { a: ['ɔː','aw!','all-family'] } },
  today:   { over: { o: ['ə','u','schwa'] }, note: 'optional: /tɒˈdeɪ/ is tolerable, /ə/ is right' },
  together:{ over: { o: ['ə','u','schwa'], th: ['ð','thv!','voiced-th'] } },
  try:     { over: { y: ['aɪ','igh','y-long-i'] } },
  warm:    { over: { a: ['ɔː','aw!','tricky'] }, tag: 'tricky' },

  water:   { over: { a: ['ɔː','aw!','a-says-aw'] }, note: 'BrE /ˈwɔːtə/; AmE /ˈwɑː/ — aw clip fits BrE; this is not the short wash vowel.' },
  people:  { seg: ['p','eo','p','le'], over: { eo: ['iː','ee','tricky'], le: ['l','l','tricky'] }, tag: 'tricky', note: "le = /əl/; le plays the l clip" },
  year:    { over: { ear: ['ɪər','earnear!','ear-near'] }, note: 'currently TTS "ear" fallback — works, clip preferred' },
  place:   { over: { a: ['eɪ','ay','magic-e'], c: ['s','s','soft-c'] }, silent: ['e'], tag: 'magic-e + soft c' },
  mother:  { over: { o: ['ʌ','u','tricky'], th: ['ð','thv!','voiced-th'] } },
  face:    { over: { c: ['s','s','soft-c'] } },
  family:  { over: { y: ['i','ee','final-y'] } },
  school:  { silent: ['h'], tag: 'tricky' },
  father:  { over: { a: ['ɑː','o','tricky'], th: ['ð','thv!','voiced-th'] }, note: 'approx: /ɑː/ has no clip; o-clip /ɒ/ is closest. Optional new clip' },
  body:    { over: { y: ['i','ee','final-y'] } },

  music:   { over: { u: ['juː','ue','open-syllable'], s: ['z','z','s-says-z'] }, note: 'Final C is /k/ and uses its ordinary clip.' },
  colour:  { over: { 'o#1': ['ʌ','u','tricky'] }, silent: ['u'], tag: 'tricky', note: 'second o is schwa /ə/; /ɒ/ is an acceptable approximation' },
  horse:   { silent: ['e'], tag: 'silent-e' },
  sea:     { seg: ['s','ea'], over: { ea: ['iː','ee','ea-team'] } },
  mountain:{ seg: ['m','ou','n','t','ai','n'], over: { ou: ['aʊ','ow!','ow-team'], ai: ['ə','u','schwa'] } },
  city:    { over: { c: ['s','s','soft-c'], y: ['i','ee','final-y'] } },
  book:    { over: { oo: ['ʊ','ooshort!','tricky'] }, tag: 'tricky' },
  page:    { over: { g: ['dʒ','j','soft-g'] }, note: 'magic-e a→ay ✓ already works' },
  story:   { over: { y: ['i','ee','final-y'] } },
  friend:  { seg: ['f','r','ie','n','d'], over: { ie: ['ɛ','e','tricky'] }, tag: 'tricky' },

  brother: { over: { o: ['ʌ','u','tricky'], th: ['ð','thv!','voiced-th'] } },
  teacher: { seg: ['t','ea','ch','er'], over: { ea: ['iː','ee','ea-team'] } },
  window:  { over: { o: ['oʊ','oa','ow-says-oh'] }, silent: ['w#2'] },
  table:   { over: { a: ['eɪ','ay','open-syllable'] }, silent: ['e'] },
  wall:    { over: { a: ['ɔː','aw!','all-family'] } },
  paper:   { over: { a: ['eɪ','ay','open-syllable'] } },
  pencil:  { over: { c: ['s','s','soft-c'] } },
  picture: { over: { t: ['tʃ','ch','tricky'], u: ['ər','er','tricky'] }, silent: ['r','e'], tag: 'tricky' },
  weather: { seg: ['w','ea','th','er'], over: { ea: ['ɛ','e','ea-short-e'], th: ['ð','thv!','voiced-th'] } },
  sound:   { seg: ['s','ou','n','d'], over: { ou: ['aʊ','ow!','ow-team'] } },
  earth:   { seg: ['ear','th'], over: { ear: ['ɜːr','er','tricky'] }, tag: 'tricky' },
  idea:    { over: { i: ['aɪ','igh','open-syllable'] }, note: 'final a = /ə/, /æ/ is an acceptable kid approximation' },
};

// The new course explicitly teaches these cohorts; its complete annotations
// replace earlier partial definitions, including book's previous exclusion.
// Parked vocabulary and its annotations remain in the same canonical audit.
export const AUDIT = { ...PREVIOUS_WORD_SOUND_AUDIT, ...WORD_COURSE_SOUND_AUDIT };
