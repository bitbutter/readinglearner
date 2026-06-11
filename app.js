'use strict';

// ============================================================
// DEBUG
// ============================================================

const DBG_BUF = [];
const DBG_T0  = Date.now();

function DBG(tag, info) {
  const line = `+${String(Date.now() - DBG_T0).padStart(6)}ms [${tag}]` +
               (info !== undefined ? ' ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '');
  DBG_BUF.push(line);
  if (DBG_BUF.length > 500) DBG_BUF.shift();
  console.log(line);
}

window.rlDump = function () {
  const text = DBG_BUF.join('\n');
  try { console.log('%c===== ReadingLearner debug dump =====', 'font-weight:bold'); } catch (_) {}
  console.log(text);
  return text;
};

// ============================================================
// HELPERS
// ============================================================

function numberToWords(n) {
  const ones = ['','one','two','three','four','five','six','seven','eight','nine',
                 'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
                 'seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  if (n < 20) return ones[n];
  if (n < 100) return tens[n / 10 | 0] + (n % 10 ? ' ' + ones[n % 10] : '');
  const h = n / 100 | 0;
  const r = n % 100;
  return ones[h] + ' hundred' + (r ? ' and ' + numberToWords(r) : '');
}

// Isolated phonetic letter sounds (phonics, not letter names — "sss" for s,
// not "ess"). Primary source is the bespoke recordings in audio/letters/
// (generated from IPA via logs/tools/generate_letter_sounds.ps1, so the sound
// can't be "spelled out"). The strings below are only the TTS fallback if an
// audio file fails to load, and they may be mangled by some voices.
const LETTER_SOUNDS = {
  a: 'ah',  b: 'buh', c: 'kuh', d: 'duh', e: 'eh',  f: 'fff',
  g: 'guh', h: 'huh', i: 'ih',  j: 'juh', k: 'kuh', l: 'lll',
  m: 'mmm', n: 'nnn', o: 'oh',  p: 'puh', q: 'kwuh', r: 'rrr',
  s: 'sss', t: 'tuh', u: 'uh',  v: 'vvv', w: 'wuh', x: 'ks',
  y: 'yuh', z: 'zzz',
};

// Compound letter sounds (digraphs/trigraphs) with a reasonably unambiguous
// pronunciation. Each has its own clip in audio/letters/ and a TTS fallback.
// Deliberately left out as too ambiguous in this app's vocabulary:
// ea (eat/weather), ow (now/show), ou (out/your), ai (said/again), ur (our/hour).
const DIGRAPH_TTS = {
  igh: 'eye',  air: 'air',
  sh: 'shh',  ch: 'chuh', th: 'thh', ng: 'ng',  ee: 'eee',  oo: 'ooo',
  qu: 'kwuh', ay: 'ay',   oa: 'oh',  oy: 'oy',  oi: 'oy',   ar: 'ar',
  or: 'or',   er: 'er',   ir: 'er',  wh: 'wuh', ck: 'kuh',  ll: 'lll',
  ss: 'sss',  tt: 'tuh',
};

// Longest first so 'igh'/'air' win over their 2- and 1-letter prefixes.
const DIGRAPHS = Object.keys(DIGRAPH_TTS).sort((a, b) => b.length - a.length);

// Words whose greedy left-to-right segmentation would group letters that do
// NOT make that sound there (the 'ch' in school, the 'er' in here/there, the
// 'igh' hiding inside eight…). Spelled-out segmentations, lowercase.
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
  year:     ['y', 'e', 'a', 'r'],
  earth:    ['e', 'a', 'r', 'th'],
};

// Split a display word into tappable sound units, preserving original casing.
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

const DIGIT_NAMES = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four',
  5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine',
};

// TTS fallback string for a sound unit, or null if the unit isn't speakable.
function soundFallback(key) {
  return LETTER_SOUNDS[key] || DIGRAPH_TTS[key] || null;
}

const letterAudioCache = {};

function playLetterSound(seg) {
  const key = seg.toLowerCase();
  const fallback = soundFallback(key);
  if (fallback) {
    let a = letterAudioCache[key];
    if (!a) {
      a = new Audio('./audio/letters/' + key + '.mp3');
      letterAudioCache[key] = a;
    }
    try { speechSynthesis.cancel(); } catch (_) {}
    a.currentTime = 0;
    a.play().catch((e) => {
      DBG('letterAudio', key + ' failed: ' + e.name + ' — falling back to TTS');
      speak(fallback, 0.8);
    });
    return;
  }
  if (DIGIT_NAMES[key]) speak(DIGIT_NAMES[key], 0.8);
}

// ============================================================
// CONTENT
// ============================================================

const NUMBERS_CONTENT = [
  // Level 1: 1–10
  { id: 'num:1',  display: '1',  accepted: ['one','won'],        level: 1 },
  { id: 'num:2',  display: '2',  accepted: ['two','to','too'],   level: 1 },
  { id: 'num:3',  display: '3',  accepted: ['three'],             level: 1 },
  { id: 'num:4',  display: '4',  accepted: ['four','for','fore'], level: 1 },
  { id: 'num:5',  display: '5',  accepted: ['five'],              level: 1 },
  { id: 'num:6',  display: '6',  accepted: ['six'],               level: 1 },
  { id: 'num:7',  display: '7',  accepted: ['seven'],             level: 1 },
  { id: 'num:8',  display: '8',  accepted: ['eight','ate'],       level: 1 },
  { id: 'num:9',  display: '9',  accepted: ['nine'],              level: 1 },
  { id: 'num:10', display: '10', accepted: ['ten'],               level: 1 },
  // Level 2: 11–20
  { id: 'num:11', display: '11', accepted: ['eleven'],            level: 2 },
  { id: 'num:12', display: '12', accepted: ['twelve'],            level: 2 },
  { id: 'num:13', display: '13', accepted: ['thirteen'],          level: 2 },
  { id: 'num:14', display: '14', accepted: ['fourteen'],          level: 2 },
  { id: 'num:15', display: '15', accepted: ['fifteen'],           level: 2 },
  { id: 'num:16', display: '16', accepted: ['sixteen'],           level: 2 },
  { id: 'num:17', display: '17', accepted: ['seventeen'],         level: 2 },
  { id: 'num:18', display: '18', accepted: ['eighteen'],          level: 2 },
  { id: 'num:19', display: '19', accepted: ['nineteen'],          level: 2 },
  { id: 'num:20', display: '20', accepted: ['twenty'],            level: 2 },
  // Level 3: 21–30
  { id: 'num:21', display: '21', accepted: ['twenty one'],        level: 3 },
  { id: 'num:22', display: '22', accepted: ['twenty two'],        level: 3 },
  { id: 'num:23', display: '23', accepted: ['twenty three'],      level: 3 },
  { id: 'num:24', display: '24', accepted: ['twenty four'],       level: 3 },
  { id: 'num:25', display: '25', accepted: ['twenty five'],       level: 3 },
  { id: 'num:26', display: '26', accepted: ['twenty six'],        level: 3 },
  { id: 'num:27', display: '27', accepted: ['twenty seven'],      level: 3 },
  { id: 'num:28', display: '28', accepted: ['twenty eight'],      level: 3 },
  { id: 'num:29', display: '29', accepted: ['twenty nine'],       level: 3 },
  { id: 'num:30', display: '30', accepted: ['thirty'],            level: 3 },
  // Level 4: 31–40
  { id: 'num:31', display: '31', accepted: ['thirty one'],        level: 4 },
  { id: 'num:32', display: '32', accepted: ['thirty two'],        level: 4 },
  { id: 'num:33', display: '33', accepted: ['thirty three'],      level: 4 },
  { id: 'num:34', display: '34', accepted: ['thirty four'],       level: 4 },
  { id: 'num:35', display: '35', accepted: ['thirty five'],       level: 4 },
  { id: 'num:36', display: '36', accepted: ['thirty six'],        level: 4 },
  { id: 'num:37', display: '37', accepted: ['thirty seven'],      level: 4 },
  { id: 'num:38', display: '38', accepted: ['thirty eight'],      level: 4 },
  { id: 'num:39', display: '39', accepted: ['thirty nine'],       level: 4 },
  { id: 'num:40', display: '40', accepted: ['forty'],             level: 4 },
  // Level 5: 41–50
  { id: 'num:41', display: '41', accepted: ['forty one'],         level: 5 },
  { id: 'num:42', display: '42', accepted: ['forty two'],         level: 5 },
  { id: 'num:43', display: '43', accepted: ['forty three'],       level: 5 },
  { id: 'num:44', display: '44', accepted: ['forty four'],        level: 5 },
  { id: 'num:45', display: '45', accepted: ['forty five'],        level: 5 },
  { id: 'num:46', display: '46', accepted: ['forty six'],         level: 5 },
  { id: 'num:47', display: '47', accepted: ['forty seven'],       level: 5 },
  { id: 'num:48', display: '48', accepted: ['forty eight'],       level: 5 },
  { id: 'num:49', display: '49', accepted: ['forty nine'],        level: 5 },
  { id: 'num:50', display: '50', accepted: ['fifty'],             level: 5 },
  // Level 6: 51–60
  { id: 'num:51', display: '51', accepted: ['fifty one'],         level: 6 },
  { id: 'num:52', display: '52', accepted: ['fifty two'],         level: 6 },
  { id: 'num:53', display: '53', accepted: ['fifty three'],       level: 6 },
  { id: 'num:54', display: '54', accepted: ['fifty four'],        level: 6 },
  { id: 'num:55', display: '55', accepted: ['fifty five'],        level: 6 },
  { id: 'num:56', display: '56', accepted: ['fifty six'],         level: 6 },
  { id: 'num:57', display: '57', accepted: ['fifty seven'],       level: 6 },
  { id: 'num:58', display: '58', accepted: ['fifty eight'],       level: 6 },
  { id: 'num:59', display: '59', accepted: ['fifty nine'],        level: 6 },
  { id: 'num:60', display: '60', accepted: ['sixty'],             level: 6 },
  // Level 7: 61–70
  { id: 'num:61', display: '61', accepted: ['sixty one'],         level: 7 },
  { id: 'num:62', display: '62', accepted: ['sixty two'],         level: 7 },
  { id: 'num:63', display: '63', accepted: ['sixty three'],       level: 7 },
  { id: 'num:64', display: '64', accepted: ['sixty four'],        level: 7 },
  { id: 'num:65', display: '65', accepted: ['sixty five'],        level: 7 },
  { id: 'num:66', display: '66', accepted: ['sixty six'],         level: 7 },
  { id: 'num:67', display: '67', accepted: ['sixty seven'],       level: 7 },
  { id: 'num:68', display: '68', accepted: ['sixty eight'],       level: 7 },
  { id: 'num:69', display: '69', accepted: ['sixty nine'],        level: 7 },
  { id: 'num:70', display: '70', accepted: ['seventy'],           level: 7 },
  // Level 8: 71–80
  { id: 'num:71', display: '71', accepted: ['seventy one'],       level: 8 },
  { id: 'num:72', display: '72', accepted: ['seventy two'],       level: 8 },
  { id: 'num:73', display: '73', accepted: ['seventy three'],     level: 8 },
  { id: 'num:74', display: '74', accepted: ['seventy four'],      level: 8 },
  { id: 'num:75', display: '75', accepted: ['seventy five'],      level: 8 },
  { id: 'num:76', display: '76', accepted: ['seventy six'],       level: 8 },
  { id: 'num:77', display: '77', accepted: ['seventy seven'],     level: 8 },
  { id: 'num:78', display: '78', accepted: ['seventy eight'],     level: 8 },
  { id: 'num:79', display: '79', accepted: ['seventy nine'],      level: 8 },
  { id: 'num:80', display: '80', accepted: ['eighty'],            level: 8 },
  // Level 9: 81–90
  { id: 'num:81', display: '81', accepted: ['eighty one'],        level: 9 },
  { id: 'num:82', display: '82', accepted: ['eighty two'],        level: 9 },
  { id: 'num:83', display: '83', accepted: ['eighty three'],      level: 9 },
  { id: 'num:84', display: '84', accepted: ['eighty four'],       level: 9 },
  { id: 'num:85', display: '85', accepted: ['eighty five'],       level: 9 },
  { id: 'num:86', display: '86', accepted: ['eighty six'],        level: 9 },
  { id: 'num:87', display: '87', accepted: ['eighty seven'],      level: 9 },
  { id: 'num:88', display: '88', accepted: ['eighty eight'],      level: 9 },
  { id: 'num:89', display: '89', accepted: ['eighty nine'],       level: 9 },
  { id: 'num:90', display: '90', accepted: ['ninety'],            level: 9 },
  // Level 10: 91–100
  { id: 'num:91',  display: '91',  accepted: ['ninety one'],          level: 10 },
  { id: 'num:92',  display: '92',  accepted: ['ninety two'],          level: 10 },
  { id: 'num:93',  display: '93',  accepted: ['ninety three'],        level: 10 },
  { id: 'num:94',  display: '94',  accepted: ['ninety four'],         level: 10 },
  { id: 'num:95',  display: '95',  accepted: ['ninety five'],         level: 10 },
  { id: 'num:96',  display: '96',  accepted: ['ninety six'],          level: 10 },
  { id: 'num:97',  display: '97',  accepted: ['ninety seven'],        level: 10 },
  { id: 'num:98',  display: '98',  accepted: ['ninety eight'],        level: 10 },
  { id: 'num:99',  display: '99',  accepted: ['ninety nine'],         level: 10 },
  { id: 'num:100', display: '100', accepted: ['one hundred','a hundred'], level: 10 },
];

const WORDS_CONTENT = [
  // Level 1: Dolch Pre-Primer
  { id: 'word:a',       display: 'a',       accepted: ['a','uh','ah'],          level: 1 },
  { id: 'word:and',     display: 'and',     accepted: ['and'],                   level: 1 },
  { id: 'word:away',    display: 'away',    accepted: ['away'],                  level: 1 },
  { id: 'word:big',     display: 'big',     accepted: ['big'],                   level: 1 },
  { id: 'word:blue',    display: 'blue',    accepted: ['blue','blew'],           level: 1 },
  { id: 'word:can',     display: 'can',     accepted: ['can'],                   level: 1 },
  { id: 'word:come',    display: 'come',    accepted: ['come'],                  level: 1 },
  { id: 'word:down',    display: 'down',    accepted: ['down'],                  level: 1 },
  { id: 'word:find',    display: 'find',    accepted: ['find','fined'],          level: 1 },
  { id: 'word:for',     display: 'for',     accepted: ['for','four','fore'],     level: 1 },
  { id: 'word:funny',   display: 'funny',   accepted: ['funny'],                 level: 1 },
  { id: 'word:go',      display: 'go',      accepted: ['go'],                    level: 1 },
  { id: 'word:help',    display: 'help',    accepted: ['help'],                  level: 1 },
  { id: 'word:here',    display: 'here',    accepted: ['here','hear'],           level: 1 },
  { id: 'word:i',       display: 'I',       accepted: ['i','eye','ay'],          level: 1 },
  { id: 'word:in',      display: 'in',      accepted: ['in','inn'],              level: 1 },
  { id: 'word:is',      display: 'is',      accepted: ['is'],                    level: 1 },
  { id: 'word:it',      display: 'it',      accepted: ['it'],                    level: 1 },
  { id: 'word:jump',    display: 'jump',    accepted: ['jump'],                  level: 1 },
  { id: 'word:little',  display: 'little',  accepted: ['little'],                level: 1 },
  { id: 'word:look',    display: 'look',    accepted: ['look'],                  level: 1 },
  { id: 'word:make',    display: 'make',    accepted: ['make'],                  level: 1 },
  { id: 'word:me',      display: 'me',      accepted: ['me'],                    level: 1 },
  { id: 'word:my',      display: 'my',      accepted: ['my'],                    level: 1 },
  { id: 'word:not',     display: 'not',     accepted: ['not','knot'],            level: 1 },
  { id: 'word:one',     display: 'one',     accepted: ['one','won'],             level: 1 },
  { id: 'word:play',    display: 'play',    accepted: ['play'],                  level: 1 },
  { id: 'word:red',     display: 'red',     accepted: ['red','read'],            level: 1 },
  { id: 'word:run',     display: 'run',     accepted: ['run'],                   level: 1 },
  { id: 'word:said',    display: 'said',    accepted: ['said','sed'],            level: 1 },
  { id: 'word:see',     display: 'see',     accepted: ['see','sea'],             level: 1 },
  { id: 'word:the',     display: 'the',     accepted: ['the','da','duh'],        level: 1 },
  { id: 'word:three',   display: 'three',   accepted: ['three'],                 level: 1 },
  { id: 'word:to',      display: 'to',      accepted: ['to','two','too'],        level: 1 },
  { id: 'word:two',     display: 'two',     accepted: ['two','to','too'],        level: 1 },
  { id: 'word:up',      display: 'up',      accepted: ['up'],                    level: 1 },
  { id: 'word:we',      display: 'we',      accepted: ['we','wee'],              level: 1 },
  { id: 'word:where',   display: 'where',   accepted: ['where','wear','were'],   level: 1 },
  { id: 'word:yellow',  display: 'yellow',  accepted: ['yellow'],                level: 1 },
  { id: 'word:you',     display: 'you',     accepted: ['you'],                   level: 1 },
  { id: 'word:beowulf', display: 'Beowulf', accepted: ['beowulf'],               level: 1 },
  // Level 2: Dolch Primer
  { id: 'word:all',     display: 'all',     accepted: ['all'],                   level: 2 },
  { id: 'word:am',      display: 'am',      accepted: ['am'],                    level: 2 },
  { id: 'word:are',     display: 'are',     accepted: ['are'],                   level: 2 },
  { id: 'word:at',      display: 'at',      accepted: ['at'],                    level: 2 },
  { id: 'word:ate',     display: 'ate',     accepted: ['ate'],                   level: 2 },
  { id: 'word:be',      display: 'be',      accepted: ['be','bee'],              level: 2 },
  { id: 'word:black',   display: 'black',   accepted: ['black'],                 level: 2 },
  { id: 'word:brown',   display: 'brown',   accepted: ['brown'],                 level: 2 },
  { id: 'word:but',     display: 'but',     accepted: ['but'],                   level: 2 },
  { id: 'word:came',    display: 'came',    accepted: ['came'],                  level: 2 },
  { id: 'word:did',     display: 'did',     accepted: ['did'],                   level: 2 },
  { id: 'word:do',      display: 'do',      accepted: ['do','dew','due'],        level: 2 },
  { id: 'word:eat',     display: 'eat',     accepted: ['eat'],                   level: 2 },
  { id: 'word:four',    display: 'four',    accepted: ['four','for','fore'],     level: 2 },
  { id: 'word:get',     display: 'get',     accepted: ['get'],                   level: 2 },
  { id: 'word:good',    display: 'good',    accepted: ['good'],                  level: 2 },
  { id: 'word:have',    display: 'have',    accepted: ['have'],                  level: 2 },
  { id: 'word:he',      display: 'he',      accepted: ['he'],                    level: 2 },
  { id: 'word:into',    display: 'into',    accepted: ['into'],                  level: 2 },
  { id: 'word:like',    display: 'like',    accepted: ['like'],                  level: 2 },
  { id: 'word:must',    display: 'must',    accepted: ['must'],                  level: 2 },
  { id: 'word:new',     display: 'new',     accepted: ['new','knew'],            level: 2 },
  { id: 'word:no',      display: 'no',      accepted: ['no','know'],             level: 2 },
  { id: 'word:now',     display: 'now',     accepted: ['now'],                   level: 2 },
  { id: 'word:on',      display: 'on',      accepted: ['on'],                    level: 2 },
  { id: 'word:our',     display: 'our',     accepted: ['our','hour'],            level: 2 },
  { id: 'word:out',     display: 'out',     accepted: ['out'],                   level: 2 },
  { id: 'word:please',  display: 'please',  accepted: ['please'],                level: 2 },
  { id: 'word:pretty',  display: 'pretty',  accepted: ['pretty'],                level: 2 },
  { id: 'word:ran',     display: 'ran',     accepted: ['ran'],                   level: 2 },
  { id: 'word:ride',    display: 'ride',    accepted: ['ride'],                  level: 2 },
  { id: 'word:saw',     display: 'saw',     accepted: ['saw'],                   level: 2 },
  { id: 'word:say',     display: 'say',     accepted: ['say'],                   level: 2 },
  { id: 'word:she',     display: 'she',     accepted: ['she'],                   level: 2 },
  { id: 'word:so',      display: 'so',      accepted: ['so','sew'],              level: 2 },
  { id: 'word:soon',    display: 'soon',    accepted: ['soon'],                  level: 2 },
  { id: 'word:that',    display: 'that',    accepted: ['that'],                  level: 2 },
  { id: 'word:there',   display: 'there',   accepted: ['there','their'],         level: 2 },
  { id: 'word:they',    display: 'they',    accepted: ['they'],                  level: 2 },
  { id: 'word:this',    display: 'this',    accepted: ['this'],                  level: 2 },
  { id: 'word:too',     display: 'too',     accepted: ['too','to','two'],        level: 2 },
  { id: 'word:under',   display: 'under',   accepted: ['under'],                 level: 2 },
  { id: 'word:want',    display: 'want',    accepted: ['want'],                  level: 2 },
  { id: 'word:was',     display: 'was',     accepted: ['was'],                   level: 2 },
  { id: 'word:well',    display: 'well',    accepted: ['well'],                  level: 2 },
  { id: 'word:went',    display: 'went',    accepted: ['went'],                  level: 2 },
  { id: 'word:what',    display: 'what',    accepted: ['what'],                  level: 2 },
  { id: 'word:white',   display: 'white',   accepted: ['white'],                 level: 2 },
  { id: 'word:who',     display: 'who',     accepted: ['who'],                   level: 2 },
  { id: 'word:will',    display: 'will',    accepted: ['will'],                  level: 2 },
  { id: 'word:with',    display: 'with',    accepted: ['with'],                  level: 2 },
  { id: 'word:yes',     display: 'yes',     accepted: ['yes'],                   level: 2 },
  // Level 3: Dolch Grade 1
  { id: 'word:after',   display: 'after',   accepted: ['after'],                 level: 3 },
  { id: 'word:again',   display: 'again',   accepted: ['again'],                 level: 3 },
  { id: 'word:an',      display: 'an',      accepted: ['an'],                    level: 3 },
  { id: 'word:any',     display: 'any',     accepted: ['any'],                   level: 3 },
  { id: 'word:as',      display: 'as',      accepted: ['as'],                    level: 3 },
  { id: 'word:ask',     display: 'ask',     accepted: ['ask'],                   level: 3 },
  { id: 'word:by',      display: 'by',      accepted: ['by','bye','buy'],        level: 3 },
  { id: 'word:could',   display: 'could',   accepted: ['could'],                 level: 3 },
  { id: 'word:every',   display: 'every',   accepted: ['every'],                 level: 3 },
  { id: 'word:fly',     display: 'fly',     accepted: ['fly'],                   level: 3 },
  { id: 'word:from',    display: 'from',    accepted: ['from'],                  level: 3 },
  { id: 'word:give',    display: 'give',    accepted: ['give'],                  level: 3 },
  { id: 'word:going',   display: 'going',   accepted: ['going'],                 level: 3 },
  { id: 'word:had',     display: 'had',     accepted: ['had'],                   level: 3 },
  { id: 'word:has',     display: 'has',     accepted: ['has'],                   level: 3 },
  { id: 'word:her',     display: 'her',     accepted: ['her'],                   level: 3 },
  { id: 'word:him',     display: 'him',     accepted: ['him'],                   level: 3 },
  { id: 'word:his',     display: 'his',     accepted: ['his'],                   level: 3 },
  { id: 'word:how',     display: 'how',     accepted: ['how'],                   level: 3 },
  { id: 'word:just',    display: 'just',    accepted: ['just'],                  level: 3 },
  { id: 'word:know',    display: 'know',    accepted: ['know','no'],             level: 3 },
  { id: 'word:let',     display: 'let',     accepted: ['let'],                   level: 3 },
  { id: 'word:live',    display: 'live',    accepted: ['live'],                  level: 3 },
  { id: 'word:may',     display: 'may',     accepted: ['may'],                   level: 3 },
  { id: 'word:of',      display: 'of',      accepted: ['of'],                    level: 3 },
  { id: 'word:old',     display: 'old',     accepted: ['old'],                   level: 3 },
  { id: 'word:once',    display: 'once',    accepted: ['once'],                  level: 3 },
  { id: 'word:open',    display: 'open',    accepted: ['open'],                  level: 3 },
  { id: 'word:over',    display: 'over',    accepted: ['over'],                  level: 3 },
  { id: 'word:put',     display: 'put',     accepted: ['put'],                   level: 3 },
  { id: 'word:round',   display: 'round',   accepted: ['round'],                 level: 3 },
  { id: 'word:some',    display: 'some',    accepted: ['some','sum'],            level: 3 },
  { id: 'word:stop',    display: 'stop',    accepted: ['stop'],                  level: 3 },
  { id: 'word:take',    display: 'take',    accepted: ['take'],                  level: 3 },
  { id: 'word:thank',   display: 'thank',   accepted: ['thank'],                 level: 3 },
  { id: 'word:them',    display: 'them',    accepted: ['them'],                  level: 3 },
  { id: 'word:think',   display: 'think',   accepted: ['think'],                 level: 3 },
  { id: 'word:walk',    display: 'walk',    accepted: ['walk'],                  level: 3 },
  { id: 'word:were',    display: 'were',    accepted: ['were','where','wear'],   level: 3 },
  { id: 'word:when',    display: 'when',    accepted: ['when'],                  level: 3 },
  // Level 4: Dolch Grade 2
  { id: 'word:always',  display: 'always',  accepted: ['always'],                level: 4 },
  { id: 'word:around',  display: 'around',  accepted: ['around'],                level: 4 },
  { id: 'word:because', display: 'because', accepted: ['because'],               level: 4 },
  { id: 'word:been',    display: 'been',    accepted: ['been','bin'],            level: 4 },
  { id: 'word:before',  display: 'before',  accepted: ['before'],                level: 4 },
  { id: 'word:best',    display: 'best',    accepted: ['best'],                  level: 4 },
  { id: 'word:both',    display: 'both',    accepted: ['both'],                  level: 4 },
  { id: 'word:buy',     display: 'buy',     accepted: ['buy','by','bye'],        level: 4 },
  { id: 'word:call',    display: 'call',    accepted: ['call'],                  level: 4 },
  { id: 'word:cold',    display: 'cold',    accepted: ['cold'],                  level: 4 },
  { id: 'word:does',    display: 'does',    accepted: ['does','duz'],            level: 4 },
  { id: 'word:dont',    display: "don't",   accepted: ["don't",'dont'],          level: 4 },
  { id: 'word:fast',    display: 'fast',    accepted: ['fast'],                  level: 4 },
  { id: 'word:first',   display: 'first',   accepted: ['first'],                 level: 4 },
  { id: 'word:five',    display: 'five',    accepted: ['five'],                  level: 4 },
  { id: 'word:found',   display: 'found',   accepted: ['found'],                 level: 4 },
  { id: 'word:gave',    display: 'gave',    accepted: ['gave'],                  level: 4 },
  { id: 'word:goes',    display: 'goes',    accepted: ['goes'],                  level: 4 },
  { id: 'word:green',   display: 'green',   accepted: ['green'],                 level: 4 },
  { id: 'word:its',     display: 'its',     accepted: ['its'],                   level: 4 },
  { id: 'word:made',    display: 'made',    accepted: ['made','maid'],           level: 4 },
  { id: 'word:many',    display: 'many',    accepted: ['many'],                  level: 4 },
  { id: 'word:off',     display: 'off',     accepted: ['off'],                   level: 4 },
  { id: 'word:or',      display: 'or',      accepted: ['or','ore','oar'],        level: 4 },
  { id: 'word:pull',    display: 'pull',    accepted: ['pull'],                  level: 4 },
  { id: 'word:read',    display: 'read',    accepted: ['read','red'],            level: 4 },
  { id: 'word:right',   display: 'right',   accepted: ['right','write'],         level: 4 },
  { id: 'word:sing',    display: 'sing',    accepted: ['sing'],                  level: 4 },
  { id: 'word:sit',     display: 'sit',     accepted: ['sit'],                   level: 4 },
  { id: 'word:sleep',   display: 'sleep',   accepted: ['sleep'],                 level: 4 },
  { id: 'word:tell',    display: 'tell',    accepted: ['tell'],                  level: 4 },
  { id: 'word:their',   display: 'their',   accepted: ['their','there'],         level: 4 },
  { id: 'word:these',   display: 'these',   accepted: ['these'],                 level: 4 },
  { id: 'word:those',   display: 'those',   accepted: ['those'],                 level: 4 },
  { id: 'word:upon',    display: 'upon',    accepted: ['upon'],                  level: 4 },
  { id: 'word:us',      display: 'us',      accepted: ['us'],                    level: 4 },
  { id: 'word:use',     display: 'use',     accepted: ['use','yooz'],            level: 4 },
  { id: 'word:very',    display: 'very',    accepted: ['very'],                  level: 4 },
  { id: 'word:wash',    display: 'wash',    accepted: ['wash'],                  level: 4 },
  { id: 'word:which',   display: 'which',   accepted: ['which','witch'],         level: 4 },
  { id: 'word:why',     display: 'why',     accepted: ['why'],                   level: 4 },
  { id: 'word:wish',    display: 'wish',    accepted: ['wish'],                  level: 4 },
  { id: 'word:work',    display: 'work',    accepted: ['work'],                  level: 4 },
  { id: 'word:would',   display: 'would',   accepted: ['would','wood'],          level: 4 },
  { id: 'word:write',   display: 'write',   accepted: ['write','right'],         level: 4 },
  { id: 'word:your',    display: 'your',    accepted: ['your','you\'re'],        level: 4 },
  // Level 5: Dolch Grade 3
  { id: 'word:about',    display: 'about',    accepted: ['about'],               level: 5 },
  { id: 'word:better',   display: 'better',   accepted: ['better'],              level: 5 },
  { id: 'word:bring',    display: 'bring',    accepted: ['bring'],               level: 5 },
  { id: 'word:carry',    display: 'carry',    accepted: ['carry'],               level: 5 },
  { id: 'word:clean',    display: 'clean',    accepted: ['clean'],               level: 5 },
  { id: 'word:cut',      display: 'cut',      accepted: ['cut'],                 level: 5 },
  { id: 'word:done',     display: 'done',     accepted: ['done','dun'],          level: 5 },
  { id: 'word:draw',     display: 'draw',     accepted: ['draw'],                level: 5 },
  { id: 'word:drink',    display: 'drink',    accepted: ['drink'],               level: 5 },
  { id: 'word:eight',    display: 'eight',    accepted: ['eight','ate'],         level: 5 },
  { id: 'word:fall',     display: 'fall',     accepted: ['fall'],                level: 5 },
  { id: 'word:far',      display: 'far',      accepted: ['far'],                 level: 5 },
  { id: 'word:full',     display: 'full',     accepted: ['full'],                level: 5 },
  { id: 'word:got',      display: 'got',      accepted: ['got'],                 level: 5 },
  { id: 'word:grow',     display: 'grow',     accepted: ['grow'],                level: 5 },
  { id: 'word:hold',     display: 'hold',     accepted: ['hold'],                level: 5 },
  { id: 'word:hot',      display: 'hot',      accepted: ['hot'],                 level: 5 },
  { id: 'word:hurt',     display: 'hurt',     accepted: ['hurt'],                level: 5 },
  { id: 'word:if',       display: 'if',       accepted: ['if'],                  level: 5 },
  { id: 'word:keep',     display: 'keep',     accepted: ['keep'],                level: 5 },
  { id: 'word:kind',     display: 'kind',     accepted: ['kind'],                level: 5 },
  { id: 'word:laugh',    display: 'laugh',    accepted: ['laugh','laf'],         level: 5 },
  { id: 'word:light',    display: 'light',    accepted: ['light'],               level: 5 },
  { id: 'word:long',     display: 'long',     accepted: ['long'],                level: 5 },
  { id: 'word:much',     display: 'much',     accepted: ['much'],                level: 5 },
  { id: 'word:myself',   display: 'myself',   accepted: ['myself'],              level: 5 },
  { id: 'word:never',    display: 'never',    accepted: ['never'],               level: 5 },
  { id: 'word:only',     display: 'only',     accepted: ['only'],                level: 5 },
  { id: 'word:own',      display: 'own',      accepted: ['own'],                 level: 5 },
  { id: 'word:pick',     display: 'pick',     accepted: ['pick'],                level: 5 },
  { id: 'word:seven',    display: 'seven',    accepted: ['seven'],               level: 5 },
  { id: 'word:shall',    display: 'shall',    accepted: ['shall'],               level: 5 },
  { id: 'word:show',     display: 'show',     accepted: ['show'],                level: 5 },
  { id: 'word:six',      display: 'six',      accepted: ['six'],                 level: 5 },
  { id: 'word:small',    display: 'small',    accepted: ['small'],               level: 5 },
  { id: 'word:start',    display: 'start',    accepted: ['start'],               level: 5 },
  { id: 'word:ten',      display: 'ten',      accepted: ['ten'],                 level: 5 },
  { id: 'word:today',    display: 'today',    accepted: ['today'],               level: 5 },
  { id: 'word:together', display: 'together', accepted: ['together'],            level: 5 },
  { id: 'word:try',      display: 'try',      accepted: ['try'],                 level: 5 },
  { id: 'word:warm',     display: 'warm',     accepted: ['warm'],                level: 5 },
  // Level 6: High-frequency words
  { id: 'word:time',     display: 'time',     accepted: ['time'],                level: 6 },
  { id: 'word:water',    display: 'water',    accepted: ['water'],               level: 6 },
  { id: 'word:people',   display: 'people',   accepted: ['people'],              level: 6 },
  { id: 'word:year',     display: 'year',     accepted: ['year'],                level: 6 },
  { id: 'word:back',     display: 'back',     accepted: ['back'],                level: 6 },
  { id: 'word:home',     display: 'home',     accepted: ['home'],                level: 6 },
  { id: 'word:place',    display: 'place',    accepted: ['place'],               level: 6 },
  { id: 'word:end',      display: 'end',      accepted: ['end'],                 level: 6 },
  { id: 'word:land',     display: 'land',     accepted: ['land'],                level: 6 },
  { id: 'word:air',      display: 'air',      accepted: ['air','ere'],           level: 6 },
  { id: 'word:animal',   display: 'animal',   accepted: ['animal'],              level: 6 },
  { id: 'word:mother',   display: 'mother',   accepted: ['mother'],              level: 6 },
  { id: 'word:face',     display: 'face',     accepted: ['face'],                level: 6 },
  { id: 'word:family',   display: 'family',   accepted: ['family'],              level: 6 },
  { id: 'word:school',   display: 'school',   accepted: ['school'],              level: 6 },
  { id: 'word:father',   display: 'father',   accepted: ['father'],              level: 6 },
  { id: 'word:body',     display: 'body',     accepted: ['body'],                level: 6 },
  { id: 'word:food',     display: 'food',     accepted: ['food'],                level: 6 },
  { id: 'word:more',     display: 'more',     accepted: ['more'],                level: 6 },
  { id: 'word:door',     display: 'door',     accepted: ['door'],                level: 6 },
  // Level 7: Nature and everyday life
  { id: 'word:music',    display: 'music',    accepted: ['music'],               level: 7 },
  { id: 'word:colour',   display: 'colour',   accepted: ['colour','color'],      level: 7 },
  { id: 'word:sun',      display: 'sun',      accepted: ['sun','son'],           level: 7 },
  { id: 'word:fish',     display: 'fish',     accepted: ['fish'],                level: 7 },
  { id: 'word:dog',      display: 'dog',      accepted: ['dog'],                 level: 7 },
  { id: 'word:horse',    display: 'horse',    accepted: ['horse'],               level: 7 },
  { id: 'word:river',    display: 'river',    accepted: ['river'],               level: 7 },
  { id: 'word:sea',      display: 'sea',      accepted: ['sea','see'],           level: 7 },
  { id: 'word:bird',     display: 'bird',     accepted: ['bird'],                level: 7 },
  { id: 'word:tree',     display: 'tree',     accepted: ['tree'],                level: 7 },
  { id: 'word:mountain', display: 'mountain', accepted: ['mountain'],            level: 7 },
  { id: 'word:morning',  display: 'morning',  accepted: ['morning'],             level: 7 },
  { id: 'word:night',    display: 'night',    accepted: ['night','nite'],        level: 7 },
  { id: 'word:city',     display: 'city',     accepted: ['city'],                level: 7 },
  { id: 'word:road',     display: 'road',     accepted: ['road','rode'],         level: 7 },
  { id: 'word:room',     display: 'room',     accepted: ['room'],                level: 7 },
  { id: 'word:book',     display: 'book',     accepted: ['book'],                level: 7 },
  { id: 'word:page',     display: 'page',     accepted: ['page'],                level: 7 },
  { id: 'word:story',    display: 'story',    accepted: ['story'],               level: 7 },
  { id: 'word:friend',   display: 'friend',   accepted: ['friend'],              level: 7 },
  // Level 8: Home and school
  { id: 'word:children', display: 'children', accepted: ['children'],            level: 8 },
  { id: 'word:brother',  display: 'brother',  accepted: ['brother'],             level: 8 },
  { id: 'word:sister',   display: 'sister',   accepted: ['sister'],              level: 8 },
  { id: 'word:teacher',  display: 'teacher',  accepted: ['teacher'],             level: 8 },
  { id: 'word:window',   display: 'window',   accepted: ['window'],              level: 8 },
  { id: 'word:table',    display: 'table',    accepted: ['table'],               level: 8 },
  { id: 'word:chair',    display: 'chair',    accepted: ['chair'],               level: 8 },
  { id: 'word:floor',    display: 'floor',    accepted: ['floor'],               level: 8 },
  { id: 'word:wall',     display: 'wall',     accepted: ['wall'],                level: 8 },
  { id: 'word:clock',    display: 'clock',    accepted: ['clock'],               level: 8 },
  { id: 'word:paper',    display: 'paper',    accepted: ['paper'],               level: 8 },
  { id: 'word:pencil',   display: 'pencil',   accepted: ['pencil'],              level: 8 },
  { id: 'word:picture',  display: 'picture',  accepted: ['picture'],             level: 8 },
  { id: 'word:street',   display: 'street',   accepted: ['street'],              level: 8 },
  { id: 'word:garden',   display: 'garden',   accepted: ['garden'],              level: 8 },
  { id: 'word:kitchen',  display: 'kitchen',  accepted: ['kitchen'],             level: 8 },
  { id: 'word:weather',  display: 'weather',  accepted: ['weather','whether'],   level: 8 },
  { id: 'word:sound',    display: 'sound',    accepted: ['sound'],               level: 8 },
  { id: 'word:earth',    display: 'earth',    accepted: ['earth'],               level: 8 },
  { id: 'word:idea',     display: 'idea',     accepted: ['idea'],                level: 8 },
  // Level 9: Descriptive and abstract
  { id: 'word:important',  display: 'important',  accepted: ['important'],       level: 9 },
  { id: 'word:different',  display: 'different',  accepted: ['different'],       level: 9 },
  { id: 'word:special',    display: 'special',    accepted: ['special'],         level: 9 },
  { id: 'word:beautiful',  display: 'beautiful',  accepted: ['beautiful'],       level: 9 },
  { id: 'word:birthday',   display: 'birthday',   accepted: ['birthday'],        level: 9 },
  { id: 'word:tomorrow',   display: 'tomorrow',   accepted: ['tomorrow'],        level: 9 },
  { id: 'word:yesterday',  display: 'yesterday',  accepted: ['yesterday'],       level: 9 },
  { id: 'word:quickly',    display: 'quickly',    accepted: ['quickly'],         level: 9 },
  { id: 'word:slowly',     display: 'slowly',     accepted: ['slowly'],          level: 9 },
  { id: 'word:outside',    display: 'outside',    accepted: ['outside'],         level: 9 },
  { id: 'word:inside',     display: 'inside',     accepted: ['inside'],          level: 9 },
  { id: 'word:everything', display: 'everything', accepted: ['everything'],      level: 9 },
  { id: 'word:everyone',   display: 'everyone',   accepted: ['everyone'],        level: 9 },
  { id: 'word:anything',   display: 'anything',   accepted: ['anything'],        level: 9 },
  { id: 'word:nothing',    display: 'nothing',    accepted: ['nothing'],         level: 9 },
  { id: 'word:between',    display: 'between',    accepted: ['between'],         level: 9 },
  { id: 'word:another',    display: 'another',    accepted: ['another'],         level: 9 },
  { id: 'word:behind',     display: 'behind',     accepted: ['behind'],          level: 9 },
  { id: 'word:second',     display: 'second',     accepted: ['second'],          level: 9 },
  { id: 'word:almost',     display: 'almost',     accepted: ['almost'],          level: 9 },
  // Level 10: Advanced vocabulary
  { id: 'word:adventure',  display: 'adventure',  accepted: ['adventure'],       level: 10 },
  { id: 'word:discover',   display: 'discover',   accepted: ['discover'],        level: 10 },
  { id: 'word:imagine',    display: 'imagine',    accepted: ['imagine'],         level: 10 },
  { id: 'word:wonderful',  display: 'wonderful',  accepted: ['wonderful'],       level: 10 },
  { id: 'word:amazing',    display: 'amazing',    accepted: ['amazing'],         level: 10 },
  { id: 'word:fantastic',  display: 'fantastic',  accepted: ['fantastic'],       level: 10 },
  { id: 'word:impossible', display: 'impossible', accepted: ['impossible'],      level: 10 },
  { id: 'word:remember',   display: 'remember',   accepted: ['remember'],        level: 10 },
  { id: 'word:favourite',  display: 'favourite',  accepted: ['favourite','favorite'], level: 10 },
  { id: 'word:excellent',  display: 'excellent',  accepted: ['excellent'],       level: 10 },
  { id: 'word:actually',   display: 'actually',   accepted: ['actually'],        level: 10 },
  { id: 'word:suddenly',   display: 'suddenly',   accepted: ['suddenly'],        level: 10 },
  { id: 'word:probably',   display: 'probably',   accepted: ['probably'],        level: 10 },
  { id: 'word:usually',    display: 'usually',    accepted: ['usually'],         level: 10 },
  { id: 'word:already',    display: 'already',    accepted: ['already'],         level: 10 },
  { id: 'word:whenever',   display: 'whenever',   accepted: ['whenever'],        level: 10 },
  { id: 'word:wherever',   display: 'wherever',   accepted: ['wherever'],        level: 10 },
  { id: 'word:interesting',display: 'interesting',accepted: ['interesting'],     level: 10 },
  { id: 'word:question',   display: 'question',   accepted: ['question'],        level: 10 },
  { id: 'word:perhaps',    display: 'perhaps',    accepted: ['perhaps'],         level: 10 },
];

// ============================================================
// ACCEPTED OVERRIDES
// ============================================================
//
// Extra accepted answers discovered by auditioning on a real voice (grown-up
// tuning screen) and promoted into the canonical app. Keyed by item id; merged
// into each item's accepted list at load, so they reach BOTH fresh installs and
// devices that already have saved progress (the seed only fills missing items,
// it never touches an existing item's accepted list).
//
// To add to this: on your dev machine, audition terms in Settings → "Audition &
// edit all terms", then run rlExportAccepted() in the console (or tap Export on
// that screen) and paste the `acceptedAdditions` entries below.
const ACCEPTED_OVERRIDES = {
  // Promoted from dev-machine auditioning. Items that end up with more than
  // MAX_ACCEPTED_FOR_ACTIVE accepted forms are auto-hidden from practice.
  // Pure-digit number matches from the export were dropped: the practice grammar
  // only emits [a-z] tokens, so a digit string can never be returned.
  'word:and':    ['at'],
  'word:big':    ['pick', 'pig'],
  'word:can':    ['cap', 'cant', 'cat'],
  'word:find':   ['for', 'fine', 'try'],
  'word:for':    ['fall'],
  'word:funny':  ['front'],
  'word:i':      ['oh'],
  'word:in':     ['a', 'and'],
  'word:is':     ['a', 'his', 'if', 'this'],
  'word:jump':   ['john'],
  'word:not':    ['now'],  // 'the not' now covered by token-run matching
  'word:one':    ['what', 'why'],
  'word:red':    ['right'],
  'word:three':  ['free'],
  'word:to':     ['so'],
  'word:up':     ['okay', 'oh'],
  'word:where':  ['well'],
  'word:yellow': ['yeah flow', 'joe', 'yeah low', 'yeah', 'jello', 'hello'],
  'word:you':    ['yeah'],
  'word:all':    ['oh'],
  'word:am':     ['im', 'my', 'month', 'ah', 'up', 'by', 'back'],  // 'am i' covered by token-run matching
  'word:are':    ['ah', 'our'],
  'word:ate':    ['eight'],
  'word:be':     ['the'],
  'word:came':   ['game'],
  'word:eat':    ['it', 'a', 'eight', 'he'],
  'word:four':   ['fall'],
  'word:have':   ['ha', 'tough'],
  'word:into':   ['and to'],
  'word:must':   ['most'],
  'word:new':    ['near'],
  'word:no':     ['now'],
  'word:out':    ['oh'],
  'word:ran':    ['rap', 'run', 'right', 'ram'],
  'word:ride':   ['right'],
  'word:saw':    ['so', 'saul'],
  'word:soon':   ['so'],
  'word:that':   ['the'],
  'word:there':  ['that', 'the'],
  'word:under':  ['on the', 'honda'],
  'word:well':   ['wow'],
  'word:white':  ['why'],
  'word:will':   ['well'],
  'word:with':   ['well', 'quiz', 'wheres'],
  'word:yes':    ['yeah'],
  'word:beowulf': ['bell', 'the off', 'they were'],
  'word:help':   ['hell'],
  'word:play':   ['please'],
};

function applyAcceptedOverrides(items) {
  for (const [id, terms] of Object.entries(ACCEPTED_OVERRIDES)) {
    const item = items[id];
    if (!item) continue;
    for (const term of terms) {
      const n = normText(term);
      if (n && !item.accepted.some(a => normText(a) === n)) item.accepted.push(n);
    }
  }
}

// Dump accepted-term additions (vs. canonical defaults + overrides already in
// source) plus any custom items, ready to paste back into ACCEPTED_OVERRIDES /
// the content arrays. Copied to clipboard; also printed to the console.
window.rlExportAccepted = function () {
  const canon = {};
  for (const c of NUMBERS_CONTENT) canon[c.id] = c.accepted.map(normText);
  for (const c of WORDS_CONTENT)   canon[c.id] = c.accepted.map(normText);

  const acceptedAdditions = {};
  const customItems = [];

  for (const item of Object.values(stored.items)) {
    if (item.id.startsWith('custom:')) {
      customItems.push({
        id: item.id, kind: item.kind, display: item.display,
        accepted: item.accepted.map(normText), level: item.level || 1,
      });
      continue;
    }
    const base  = new Set([
      ...(canon[item.id] || []),
      ...((ACCEPTED_OVERRIDES[item.id] || []).map(normText)),
    ]);
    const extra = [];
    for (const a of item.accepted) {
      const n = normText(a);
      if (n && !base.has(n) && !extra.includes(n)) extra.push(n);
    }
    if (extra.length) acceptedAdditions[item.id] = extra;
  }

  const out  = { acceptedAdditions, customItems };
  const json = JSON.stringify(out, null, 2);
  try { console.log('%c===== ReadingLearner accepted export =====', 'font-weight:bold'); } catch (_) {}
  console.log(json);
  try { navigator.clipboard.writeText(json).then(() => console.log('(copied to clipboard)')); } catch (_) {}
  return out;
};

const PRAISE = [
  'Yes!', 'Great job!', 'You got it!', 'Well done!', 'Amazing!',
  'Wonderful!', "That's right!", 'Brilliant!', 'Super!', 'Perfect!',
  'Fantastic!', 'Lovely!',
];

// ============================================================
// STORAGE
// ============================================================

const STORAGE_KEY = 'readingLearner.v1';

const DEFAULT_SETTINGS = {
  roundSize: 10,
  retryCap: 2,
  masteryThreshold: 3,
  wordLevel: 1,
  numberLevel: 1,
  voiceName: null,
  speechRate: 0.9,
};

const MAX_LEVEL = 10;

// Items needing more than this many accepted forms are too ambiguous for the
// recognizer to verify, so they are "soft excluded": kept in the app (and in the
// tuning list) but hidden from practice rounds, left out of the practice grammar,
// and not counted toward level completion. Prune an item's accepted list back to
// <= this in the tuning screen to bring it back.
const MAX_ACCEPTED_FOR_ACTIVE = 3;

// Items where the adult's audition attempts consistently yield low Vosk confidence
// are also soft-excluded. Requires at least MIN_CONF_ATTEMPTS recorded results
// before the exclusion kicks in.
const MIN_CONF_ATTEMPTS  = 3;
const MIN_CONF_THRESHOLD = 0.45;

function isItemActive(item) {
  if ((item.accepted ? item.accepted.length : 0) > MAX_ACCEPTED_FOR_ACTIVE) return false;
  const confs = item.auditionConfs || [];
  if (confs.length >= MIN_CONF_ATTEMPTS) {
    const mean = confs.reduce((s, c) => s + c, 0) / confs.length;
    if (mean < MIN_CONF_THRESHOLD) return false;
  }
  return true;
}

function makeItem(c, kind) {
  return {
    id: c.id,
    kind: kind || (c.id.startsWith('num:') ? 'number' : 'word'),
    display: c.display,
    accepted: [...c.accepted],
    level: c.level || 1,
    successStreak: 0,
    unaidedStreak: 0,
    silentCorrect: 0,
    totalCorrect: 0,
    totalAttempts: 0,
    mastered: false,
    lastSeenRound: null,
    lastResult: null,
    auditionConfs: [],
  };
}

function freshState() {
  const items = {};
  for (const c of NUMBERS_CONTENT) items[c.id] = makeItem(c, 'number');
  for (const c of WORDS_CONTENT)   items[c.id] = makeItem(c, 'word');
  applyAcceptedOverrides(items);
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_SETTINGS },
    items,
    rounds: [],
  };
}

let stored = null;

function loadStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { stored = freshState(); saveStored(); return; }
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) throw new Error('Unexpected storage version.');
    const fresh = freshState();
    for (const id of Object.keys(fresh.items)) {
      if (!parsed.items[id]) parsed.items[id] = fresh.items[id];
    }
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (parsed.settings[k] === undefined) parsed.settings[k] = DEFAULT_SETTINGS[k];
    }
    const threshold = parsed.settings.masteryThreshold || DEFAULT_SETTINGS.masteryThreshold;
    for (const item of Object.values(parsed.items)) {
      if (!item.kind) item.kind = item.id.startsWith('num:') ? 'number' : 'word';
      if (item.level === undefined) item.level = 1;
      if (item.unaidedStreak === undefined) {
        item.unaidedStreak = item.mastered ? threshold : (item.silentCorrect || 0);
      }
      if (!item.auditionConfs) item.auditionConfs = [];
    }
    applyAcceptedOverrides(parsed.items);
    stored = parsed;
  } catch (e) {
    showStorageError(e.message);
  }
}

function saveStored() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch (e) {
    console.error('Save failed:', e);
  }
}

function showStorageError(msg) {
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;background:#0f0c29;color:#fff;display:flex;
      flex-direction:column;align-items:center;justify-content:center;padding:2rem;
      gap:1.5rem;font-family:sans-serif;text-align:center;max-width:480px;margin:auto;">
      <h2 style="font-size:1.5rem">Something went wrong</h2>
      <p style="color:#a0a0c0;font-size:0.95rem">${msg}</p>
      <button
        onclick="localStorage.removeItem('${STORAGE_KEY}');location.reload()"
        style="padding:1rem 2rem;background:#e94560;color:white;border:none;
          border-radius:1rem;font-size:1rem;cursor:pointer;font-family:sans-serif;font-weight:700;">
        Reset progress &amp; reload
      </button>
    </div>`;
}

// ============================================================
// SPEECH SYNTHESIS
// ============================================================

let levelImages = {};
let pickerImageUrl = null;

async function loadImageManifest() {
  try {
    const resp = await fetch('./images/manifest.json');
    if (resp.ok) levelImages = await resp.json();
  } catch (_) {}
  pickerImageUrl = await new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve('./images/picker.png');
    img.onerror = () => resolve(null);
    img.src = './images/picker.png';
  });
}

let voices = [];

function loadVoices() {
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  populateVoiceSelect();
}

if (window.speechSynthesis) {
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  loadVoices();
}

function getVoice() {
  if (stored?.settings?.voiceName) {
    const v = voices.find(v => v.name === stored.settings.voiceName);
    if (v) return v;
  }
  const en = voices.filter(v => v.lang.startsWith('en'));
  // Prefer online/neural voices — much higher quality (e.g. Google UK English Female on Chrome)
  const onlineGB = en.find(v => v.lang === 'en-GB' && !v.localService);
  if (onlineGB) return onlineGB;
  const onlineEN = en.find(v => !v.localService);
  if (onlineEN) return onlineEN;
  const localGBFemale = en.find(v => v.lang === 'en-GB' && /female|serena|kate|emily|fiona|amy/i.test(v.name));
  if (localGBFemale) return localGBFemale;
  const localGB = en.find(v => v.lang === 'en-GB');
  if (localGB) return localGB;
  return en[0] || voices[0] || null;
}

let currentUtterance = null;

function speak(text, rate, onEnd) {
  const snippet = text.length > 24 ? text.slice(0, 24) + '…' : text;
  if (!window.speechSynthesis) { DBG('speak', 'NO speechSynthesis'); onEnd?.(); return; }
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  currentUtterance = utt;
  const v = getVoice();
  utt.voice  = v;
  utt.rate   = rate ?? stored?.settings?.speechRate ?? 0.9;
  utt.pitch  = 1.1;
  utt.volume = 1;
  DBG('speak.start', { text: snippet, voice: v ? v.name : 'NONE' });

  let done = false;
  const finish = (how) => {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    if (currentUtterance === utt) currentUtterance = null;
    DBG('speak.end', { text: snippet, how });
    onEnd?.();
  };
  utt.onend   = () => finish('onend');
  utt.onerror = (ev) => finish('onerror:' + (ev.error || '?'));
  const watchdog = setTimeout(() => finish('WATCHDOG'), 3000 + text.length * 250);

  speechSynthesis.speak(utt);
}

const speakWord   = (w, cb) => speak(w, stored.settings.speechRate, cb);
const speakPraise = (cb)    => speak(PRAISE[Math.random() * PRAISE.length | 0], 1.1, cb);
const speakCorrect = (w, cb) => speak(`Good try! This says ${w}. Now you try.`, 0.85, cb);

// ============================================================
// VOSK SPEECH RECOGNITION
// ============================================================

let voskModel       = null;
let voskRecognizer  = null;
let micStream       = null;
let audioCtx        = null;
let scriptProc      = null;
let voskReady       = false;
let micOpening      = false;

let heardTranscripts  = [];
let listenEvaluated   = false;
let settleTimer       = null;
let maxListenTimer    = null;
let sessionMicBlocked = false;

// 'waiting' | 'ready' | 'listening' | 'evaluating'
let micState = 'waiting';

// ── Audition (grown-up tuning screen) — open-vocabulary recognizer ──
let auditionRecognizer = null;
let auditionState      = 'idle';   // 'idle' | 'listening' | 'evaluating'
let auditionRowId      = null;
let auditionHeard      = [];
let auditionConfScores = [];   // mean Vosk conf per result event this session
let auditionEvaluated  = false;
let auditionMaxTimer   = null;
let auditionSettleTimer = null;

async function initVosk() {
  if (!window.Vosk) { DBG('vosk', 'Vosk not loaded'); return; }
  try {
    DBG('vosk', 'loading model…');
    const modelUrl = new URL('./model.tar.gz', window.location.href).href;
    voskModel = await Vosk.createModel(modelUrl);
    voskModel.setLogLevel(-1);
    voskReady = true;
    DBG('vosk', 'model ready');
  } catch (e) {
    DBG('vosk', 'load FAILED: ' + e.message);
  }
}

function buildGrammar(set) {
  const kind = set === 'numbers' ? 'number' : 'word';
  const tokens = new Set(['[unk]']);
  for (const item of Object.values(stored.items)) {
    if (item.kind !== kind) continue;
    if (!isItemActive(item)) continue;  // hidden items don't shape the grammar
    for (const acc of item.accepted) {
      for (const token of acc.toLowerCase().split(/\s+/)) {
        if (token && /^[a-z]+$/.test(token)) tokens.add(token);
      }
    }
  }
  return JSON.stringify([...tokens]);
}

function createRoundRecognizer(set) {
  if (voskRecognizer) { try { voskRecognizer.remove(); } catch (_) {} voskRecognizer = null; }
  if (!voskReady) return;

  const grammar = buildGrammar(set);
  DBG('vosk', 'grammar tokens: ' + JSON.parse(grammar).length);
  voskRecognizer = new voskModel.KaldiRecognizer(16000, grammar);

  voskRecognizer.on('result', (msg) => {
    const text = (msg.result.text || '').trim();
    DBG('vosk.result', { text, micState });
    if (micState !== 'listening' && micState !== 'evaluating') return;
    if (text && text !== '[unk]' && !heardTranscripts.includes(text)) {
      heardTranscripts.push(text);
    }
    if (micState === 'evaluating') evaluateVosk();
  });

  voskRecognizer.on('partialresult', (msg) => {
    DBG('vosk.partial', (msg.result.partial || ''));
  });
}

// Open-vocabulary recognizer (no grammar) used only on the tuning screen, so
// the grown-up hears what Vosk *actually* detects — including mishearings that
// aren't yet in any accepted list and so can't appear under the practice grammar.
function createAuditionRecognizer() {
  if (auditionRecognizer) { try { auditionRecognizer.remove(); } catch (_) {} auditionRecognizer = null; }
  if (!voskReady) return;
  auditionRecognizer = new voskModel.KaldiRecognizer(16000);

  auditionRecognizer.on('result', (msg) => {
    const text = (msg.result.text || '').trim();
    DBG('audition.result', { text, auditionState });
    if (auditionState !== 'listening' && auditionState !== 'evaluating') return;
    if (text && text !== '[unk]' && !auditionHeard.includes(text)) auditionHeard.push(text);
    const words = (msg.result.result || []).filter(w => w.conf != null);
    if (words.length) {
      auditionConfScores.push(words.reduce((s, w) => s + w.conf, 0) / words.length);
    }
    if (auditionState === 'evaluating') finishAudition();
  });
}

async function openMicStream() {
  if (micStream || micOpening) return;
  micOpening = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    // Capture at the recognizer's rate (16 kHz) so the declared and actual
    // sample rates can never disagree; Chrome resamples the mic natively.
    try { audioCtx = new AudioContext({ sampleRate: 16000 }); }
    catch (_) { audioCtx = new AudioContext(); }
    const src  = audioCtx.createMediaStreamSource(micStream);
    scriptProc = audioCtx.createScriptProcessor(4096, 1, 1);
    scriptProc.onaudioprocess = (e) => {
      if (auditionState === 'listening' && auditionRecognizer) {
        try { auditionRecognizer.acceptWaveform(e.inputBuffer); } catch (_) {}
        return;
      }
      if (micState !== 'listening' || !voskRecognizer) return;
      try { voskRecognizer.acceptWaveform(e.inputBuffer); } catch (_) {}
    };
    src.connect(scriptProc);
    scriptProc.connect(audioCtx.destination);
    DBG('mic', 'open sampleRate=' + audioCtx.sampleRate);
  } catch (e) {
    DBG('mic', 'getUserMedia failed: ' + e.name);
    micStream = null;
    if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
      sessionMicBlocked = true;
      onMicDenied();
    }
  } finally {
    micOpening = false;
  }
}

function closeMicStream() {
  if (scriptProc) { try { scriptProc.disconnect(); } catch (_) {} scriptProc = null; }
  if (audioCtx)   { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
  if (micStream)  { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (voskRecognizer) { try { voskRecognizer.remove(); } catch (_) {} voskRecognizer = null; }
  DBG('mic', 'closed');
}

function startListening() {
  DBG('startListening', { sessionMicBlocked, voskReady });
  if (sessionMicBlocked) { onMicDenied(); return; }
  if (!voskReady || !voskRecognizer) { onRecognitionFallback(); return; }
  if (!micStream) {
    onRecognitionFallback();
    return;
  }
  heardTranscripts = [];
  listenEvaluated  = false;
  setMicState('listening');
  maxListenTimer = setTimeout(() => { DBG('maxListen', 'FIRED'); requestStopAndEvaluate(); }, 10000);
}

function requestStopAndEvaluate() {
  DBG('requestStopAndEvaluate', { micState });
  if (micState !== 'listening') return;
  clearTimeout(maxListenTimer);
  setMicState('evaluating');
  if (voskRecognizer) voskRecognizer.retrieveFinalResult();
  settleTimer = setTimeout(() => { DBG('settleTimer', 'FIRED'); evaluateVosk(); }, 2000);
}

function evaluateVosk() {
  DBG('evaluateVosk', { listenEvaluated, heard: heardTranscripts.slice() });
  if (listenEvaluated) return;
  if (micState !== 'evaluating' && micState !== 'listening') return;
  listenEvaluated = true;
  clearTimeout(settleTimer);
  clearTimeout(maxListenTimer);

  if (heardTranscripts.length) {
    setMicState('waiting');
    onRecognitionResult([...heardTranscripts]);
  } else {
    setMicState('ready');
    // A non-reader gets no feedback from a silently reset button — tell them.
    if (gs.currentItem && !gs.awaitingResult) {
      speak("I didn't hear you. Try again!", 1.0);
    }
  }
}

// ============================================================
// ANSWER MATCHING
// ============================================================

function normText(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

// True when `run` appears as a consecutive whole-token sequence in `tokens`.
function containsTokenRun(tokens, run) {
  outer:
  for (let i = 0; i + run.length <= tokens.length; i++) {
    for (let j = 0; j < run.length; j++) {
      if (tokens[i + j] !== run[j]) continue outer;
    }
    return true;
  }
  return false;
}

function matchAnswer(transcripts, item) {
  if (!transcripts?.length) return false;
  const acceptedRuns = item.accepted
    .map(a => normText(a).split(' ').filter(Boolean))
    .filter(r => r.length);
  for (const raw of transcripts) {
    // normText turns "[unk]" into "unk"; drop those filler tokens so a
    // transcript like "[unk] cat [unk]" still matches "cat".
    const tokens = normText(raw).split(' ').filter(t => t && t !== 'unk');
    if (!tokens.length) continue;
    for (const run of acceptedRuns) {
      if (containsTokenRun(tokens, run)) return true;
    }
  }
  return false;
}

// Single mutation path for accepted terms (grown-up tuning screen only).
// Returns true if added.
function addAcceptedTerm(item, rawTerm) {
  const term = normText(rawTerm);
  if (!term || term === '[unk]') return false;
  if (item.accepted.some(a => normText(a) === term)) return false;
  item.accepted.push(term);
  saveStored();
  DBG('addAcceptedTerm', { id: item.id, term });
  return true;
}

// ============================================================
// AUDITION (grown-up tuning)
// ============================================================

function armAudition(itemId) {
  DBG('armAudition', { itemId, auditionState });
  if (auditionState !== 'idle') return;
  if (sessionMicBlocked) { setRowResult(itemId, 'miss', 'microphone blocked'); return; }
  if (!voskReady || !auditionRecognizer || !micStream) {
    setRowResult(itemId, 'miss', 'no microphone');
    return;
  }
  auditionRowId      = itemId;
  auditionHeard      = [];
  auditionConfScores = [];
  auditionEvaluated  = false;
  auditionState     = 'listening';
  setRowListening(itemId, true);
  auditionMaxTimer  = setTimeout(stopAudition, 6000);
}

function stopAudition() {
  if (auditionState !== 'listening') return;
  clearTimeout(auditionMaxTimer);
  auditionState = 'evaluating';
  if (auditionRecognizer) auditionRecognizer.retrieveFinalResult();
  auditionSettleTimer = setTimeout(finishAudition, 2500);
}

function finishAudition() {
  if (auditionEvaluated) return;
  if (auditionState !== 'evaluating' && auditionState !== 'listening') return;
  auditionEvaluated = true;
  clearTimeout(auditionSettleTimer);
  clearTimeout(auditionMaxTimer);

  const id   = auditionRowId;
  const item = stored.items[id];
  auditionState = 'idle';
  auditionRowId = null;
  setRowListening(id, false);
  if (!item) return;

  const heard   = [...auditionHeard];
  const best    = heard.find(t => t && t !== '[unk]') || '';
  const matched = matchAnswer(heard, item);

  let sessionConf = null;
  if (auditionConfScores.length) {
    sessionConf = auditionConfScores.reduce((s, c) => s + c, 0) / auditionConfScores.length;
    item.auditionConfs.push(Math.round(sessionConf * 100) / 100);
    if (item.auditionConfs.length > 20) item.auditionConfs.splice(0, item.auditionConfs.length - 20);
    saveStored();
  }

  DBG('audition.judge', { id, best, matched, sessionConf });
  renderAuditionResult(id, best, matched, item, sessionConf);
}

// ============================================================
// ROUND BUILDING
// ============================================================

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.random() * (i + 1) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let roundNumber = 0;

function buildRound(set, level) {
  roundNumber++;
  const kind = set === 'numbers' ? 'number' : 'word';
  const all  = Object.values(stored.items).filter(i => i.kind === kind && i.level === level && isItemActive(i));
  const size = Math.min(stored.settings.roundSize, all.length);

  const missed     = shuffle(all.filter(i => i.lastResult === 'miss' && !i.mastered));
  const newItems   = shuffle(all.filter(i => i.totalAttempts === 0));
  const inProgress = shuffle(all.filter(i => i.totalAttempts > 0 && i.successStreak > 0 && !i.mastered && i.lastResult !== 'miss'));
  const mastered   = shuffle(all.filter(i => i.mastered));

  const round = [];
  const addUp = (bucket, limit) => {
    for (const item of bucket) {
      if (round.length >= limit || round.includes(item)) continue;
      round.push(item);
    }
  };

  addUp(missed,     size);
  addUp(newItems,   size);
  addUp(inProgress, size);
  addUp(mastered,   Math.ceil(size * 0.2));

  if (round.length < Math.min(size, all.length)) addUp(shuffle(all), size);

  return shuffle(round.slice(0, size));
}

// ============================================================
// GAME STATE
// ============================================================

const gs = {
  currentSet:          null,
  currentLevel:        1,
  queue:               [],
  originalSize:        0,
  completedCount:      0,
  roundCorrect:        0,
  roundSilentCorrect:  0,
  currentItem:         null,
  retryCount:          0,
  recycled:            new Set(),
  awaitingResult:      false,
  hearPressed:         false,
};

function startRound(set, level) {
  const items = buildRound(set, level);
  gs.currentSet          = set;
  gs.currentLevel        = level;
  gs.queue               = [...items];
  gs.originalSize        = items.length;
  gs.completedCount      = 0;
  gs.roundCorrect        = 0;
  gs.roundSilentCorrect  = 0;
  gs.currentItem         = null;
  gs.retryCount          = 0;
  gs.recycled            = new Set();
  gs.awaitingResult      = false;
  gs.hearPressed         = false;

  setLevelBackground(level, set);
  showScreen('practice');
  createRoundRecognizer(set);
  openMicStream();

  // Announce the level at the start of the session
  speak(`Level ${level}!`, 1.1, () => nextItem());
}

function nextItem() {
  if (gs.queue.length === 0) { endRound(); return; }
  gs.currentItem        = gs.queue.shift();
  gs.retryCount         = 0;
  gs.hearPressed        = false;
  gs.currentItem.lastSeenRound = roundNumber;
  gs.awaitingResult = false;
  presentItem(gs.currentItem);
}

function presentItem(item) {
  renderDots();

  const el  = document.getElementById('word-display');
  const len = item.display.length;
  el.style.fontSize =
    len <= 2  ? 'clamp(6rem, 25vmin, 14rem)' :
    len <= 4  ? 'clamp(5rem, 20vmin, 10rem)' :
    len <= 7  ? 'clamp(4rem, 15vmin,  8rem)' :
                'clamp(3rem, 11vmin,  5.5rem)';
  el.className = 'word-display' + (item.kind === 'number' ? ' number-display' : '');

  // The word is split into sound units — single letters and compound sounds
  // like "sh"/"ee"/"igh". Tapping one flashes the whole group and plays its
  // isolated phonetic sound, so the child can sound the word out himself.
  // When a word contains a compound group, alternating units get a subtle
  // tint so the child can see which letters belong together.
  el.innerHTML = '';
  const segs = segmentDisplay(item.display);
  const hasGroups = segs.some(s => s.length > 1);
  segs.forEach((seg, idx) => {
    const span = document.createElement('span');
    span.className   = 'letter';
    span.textContent = seg;
    if (hasGroups && idx % 2 === 1) span.classList.add('alt');
    const key = seg.toLowerCase();
    if (soundFallback(key) || DIGIT_NAMES[key]) {
      span.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (gs.awaitingResult || micState === 'listening' || micState === 'evaluating') return;
        span.classList.remove('tapped');
        void span.offsetWidth;  // restart the flash animation
        span.classList.add('tapped');
        playLetterSound(seg);
      });
    }
    el.appendChild(span);
  });

  clearHeardDisplay();
  DBG('presentItem', { id: item.id });
  setMicState('ready'); // mic and hear button ready immediately — child controls pacing
}

function handleAnswer(correct) {
  if (gs.awaitingResult) return;
  gs.awaitingResult = true;
  setMicState('waiting');

  const item = gs.currentItem;
  item.totalAttempts++;

  if (correct) {
    item.totalCorrect++;
    item.successStreak++;
    item.lastResult = 'correct';

    // Only a clean first-try answer without "Hear it" advances the unaided
    // streak — but an aided correct answer no longer wipes it (misses still do).
    if (!gs.hearPressed && gs.retryCount === 0) {
      item.unaidedStreak++;
      item.silentCorrect++;
      gs.roundSilentCorrect++;
    }

    item.mastered = item.unaidedStreak >= stored.settings.masteryThreshold;

    gs.roundCorrect++;
    gs.completedCount++;
    saveStored();
    playPling();
    burstStars();
    flashScreen(true);

    speakPraise(() => {
      gs.awaitingResult = false;
      nextItem();
    });

  } else {
    item.successStreak = 0;
    item.unaidedStreak = 0;
    item.mastered      = false;
    item.lastResult    = 'miss';

    saveStored();
    flashScreen(false);

    if (gs.retryCount < stored.settings.retryCap) {
      gs.retryCount++;
      speakCorrect(item.display, () => {
        gs.awaitingResult = false;
        presentItem(item);
      });
    } else {
      gs.completedCount++;
      if (!gs.recycled.has(item.id)) {
        gs.recycled.add(item.id);
        gs.queue.push(item);
      }
      speak(`This says ${item.display}.`, 0.85, () => {
        gs.awaitingResult = false;
        nextItem();
      });
    }
  }

  renderDots();
}

function endRound() {
  stored.rounds.push({
    id:      new Date().toISOString(),
    set:     gs.currentSet,
    level:   gs.currentLevel,
    endedAt: new Date().toISOString(),
    correct: gs.roundCorrect,
    total:   gs.completedCount,
  });
  saveStored();
  closeMicStream();

  const levelKey   = gs.currentSet === 'numbers' ? 'numberLevel' : 'wordLevel';
  const wasOnCurrent = gs.currentLevel === stored.settings[levelKey];
  const levelResult = wasOnCurrent ? checkLevelComplete() : null;
  showAllDone(levelResult);
}

function checkLevelComplete() {
  const levelKey = gs.currentSet === 'numbers' ? 'numberLevel' : 'wordLevel';
  const kind     = gs.currentSet === 'numbers' ? 'number' : 'word';
  const level    = gs.currentLevel;
  const items    = Object.values(stored.items).filter(i => i.kind === kind && i.level === level && isItemActive(i));
  if (!items.length) return null;
  if (!items.every(i => i.mastered)) return null;
  if (level >= MAX_LEVEL) return 'all_defeated';
  stored.settings[levelKey] = level + 1;
  saveStored();
  return 'level_complete';
}

// ============================================================
// RECOGNITION CALLBACKS
// ============================================================

function onRecognitionResult(transcripts) {
  const matched = matchAnswer(transcripts, gs.currentItem);
  DBG('judge', { expected: gs.currentItem?.display, heard: transcripts, matched });
  const best = transcripts.find(t => t && t !== '[unk]') || '';
  setHeardDisplay(best);

  handleAnswer(matched);
}

function onRecognitionFallback() {
  DBG('onRecognitionFallback', { awaitingResult: gs.awaitingResult });
  if (gs.awaitingResult) return;
  setMicState('ready');
}

function onMicDenied() {
  sessionMicBlocked = true;
  setMicState('ready');
  speak("Microphone not available. Please allow microphone access and try again.", 0.9);
}

// ============================================================
// UI
// ============================================================

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(el =>
    el.classList.toggle('hidden', el.id !== 'screen-' + name)
  );
}

function setMicState(state) {
  DBG('micState', `${micState} -> ${state}`);
  micState = state;
  const btn     = document.getElementById('mic-button');
  const lbl     = document.getElementById('mic-status');
  const hearBtn = document.getElementById('hear-button');
  btn.classList.remove('listening', 'waiting');
  if (hearBtn) hearBtn.classList.toggle('disabled', state !== 'ready');
  if (state === 'listening') {
    btn.classList.add('listening');
    lbl.textContent = 'Listening…';
  } else if (state === 'evaluating') {
    btn.classList.add('waiting');
    lbl.textContent = '…';
  } else if (state === 'waiting') {
    btn.classList.add('waiting');
    lbl.textContent = '';
  } else {
    lbl.textContent = 'Hold and speak';
  }
}

function setHeardDisplay(text) {
  const el = document.getElementById('heard-display');
  if (!el) return;
  el.textContent = text ? `Heard: "${text}"` : '';
}
function clearHeardDisplay() { setHeardDisplay(''); }

function playPling() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    // C major chord upper register: C6, E6, G6
    [[1046.5, 0.3], [1318.5, 0.22], [1568.0, 0.14]].forEach(([freq, vol]) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
      osc.start(t);
      osc.stop(t + 0.55);
    });
    setTimeout(() => { try { ctx.close(); } catch (_) {} }, 700);
  } catch (_) {}
}

function burstStars() {
  const wordEl = document.getElementById('word-display');
  if (!wordEl) return;
  const rect = wordEl.getBoundingClientRect();
  const cx = rect.left + rect.width  / 2;
  const cy = rect.top  + rect.height / 2;

  const canvas = document.createElement('canvas');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:999';
  document.body.appendChild(canvas);
  const c = canvas.getContext('2d');

  const COLORS   = ['#ff6b6b','#ffd166','#06d6a0','#a78bfa','#ff9f1c','#4cc9f0','#f72585','#80ffdb','#ffbe0b'];
  const GRAVITY  = 0.22;
  const DURATION = 1800;

  const particles = Array.from({length: 40}, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 9;
    return {
      x:        cx + (Math.random() - 0.5) * rect.width  * 0.5,
      y:        cy + (Math.random() - 0.5) * rect.height * 0.3,
      vx:       Math.cos(angle) * speed,
      vy:       Math.sin(angle) * speed - 5,
      size:     8 + Math.random() * 14,
      color:    COLORS[Math.floor(Math.random() * COLORS.length)],
      rot:      Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.28,
      isStar:   Math.random() < 0.6,
    };
  });

  function drawStar(x, y, r, rot) {
    const inner = r * 0.42;
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const a  = rot + (i * Math.PI) / 5;
      const ri = i % 2 === 0 ? r : inner;
      if (i === 0) c.moveTo(x + ri * Math.cos(a), y + ri * Math.sin(a));
      else         c.lineTo(x + ri * Math.cos(a), y + ri * Math.sin(a));
    }
    c.closePath();
  }

  const start = performance.now();
  (function tick(now) {
    const t = (now - start) / DURATION;
    if (t >= 1) { canvas.remove(); return; }
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.globalAlpha = Math.max(0, 1 - t * 1.1);
    for (const p of particles) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.vy += GRAVITY;
      p.rot += p.rotSpeed;
      c.fillStyle = p.color;
      if (p.isStar) { drawStar(p.x, p.y, p.size / 2, p.rot); }
      else          { c.beginPath(); c.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); }
      c.fill();
    }
    c.globalAlpha = 1;
    requestAnimationFrame(tick);
  })(start);
}

let flashTimer = null;
function flashScreen(correct) {
  const el = document.getElementById('flash-overlay');
  if (!el) return;
  el.className = 'flash-overlay ' + (correct ? 'correct' : 'incorrect') + ' show';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = 'flash-overlay'; }, 400);
}

function renderDots() {
  const el = document.getElementById('round-progress');
  if (!el) return;
  const total = gs.originalSize;
  const done  = gs.completedCount;
  const cur   = Math.min(done, total - 1);

  el.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.className = 'progress-dot' + (i < done ? ' done' : i === cur && !gs.awaitingResult ? ' current' : '');
    el.appendChild(d);
  }
}

function showAllDone(levelResult) {
  if (levelResult) {
    showLevelUp(levelResult);
    return;
  }

  showScreen('alldone');
  const total  = gs.originalSize;
  const silent = gs.roundSilentCorrect;
  const noun   = gs.currentSet === 'numbers' ? 'number' : 'word';
  const stars  = Math.max(1, Math.round(
    (silent > 0 ? silent : gs.roundCorrect) / Math.max(total, 1) * 5
  ));

  document.getElementById('alldone-title').textContent = `You practised ${total} ${noun}${total !== 1 ? 's' : ''}`;

  let scoreText, speakText;
  if (silent >= total && total > 0) {
    scoreText = 'Read them all by yourself!';
    speakText = `You practised ${total} ${noun}s, and read them all by yourself. See you again tomorrow!`;
  } else if (silent > 0) {
    scoreText = `Got ${silent} right without hearing!`;
    speakText = `You practised ${total} ${noun}s, and got ${silent} right without hearing them first. See you again tomorrow!`;
  } else {
    scoreText = "You're learning — keep it up!";
    speakText = `You practised ${total} ${noun}s today. See you again tomorrow!`;
  }

  document.getElementById('alldone-score').textContent = scoreText;
  setTimeout(() => speak(speakText, 0.85), 600);
}

function showLevelUp(result) {
  showScreen('levelup');
  const set    = gs.currentSet;
  const level  = gs.currentLevel;
  const isMax  = result === 'all_defeated';
  const newLevel = isMax ? level : level + 1;

  if (isMax) {
    document.getElementById('levelup-title').textContent = '🏆 Champion!';
    document.getElementById('levelup-body').textContent  =
      `You've conquered all ${MAX_LEVEL} levels of ${set}! Keep practising to stay sharp!`;
    speak(`Champion! You have conquered all ${MAX_LEVEL} levels of ${set}! You are amazing!`, 1.0);
  } else {
    document.getElementById('levelup-title').textContent = `🎉 Level ${level} complete!`;
    document.getElementById('levelup-body').textContent  =
      `Brilliant! You've unlocked Level ${newLevel} of ${set}!`;
    speak(`Level ${level} complete! You unlocked level ${newLevel}! Well done!`, 1.0);
  }
  setLevelBackground(isMax ? level : newLevel, gs.currentSet);
}

// ============================================================
// LEVEL BACKGROUND & PICKER
// ============================================================

const LEVEL_GRADIENTS = [
  '',
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',  // L1 – original deep purple
  'linear-gradient(135deg, #1a0533 0%, #3a0ca3 50%, #1a0566 100%)',  // L2 – indigo
  'linear-gradient(135deg, #003049 0%, #0077b6 50%, #023e8a 100%)',  // L3 – ocean blue
  'linear-gradient(135deg, #004b23 0%, #007f5f 50%, #1b4332 100%)',  // L4 – forest green
  'linear-gradient(135deg, #2d0000 0%, #9d0208 50%, #370617 100%)',  // L5 – deep red
  'linear-gradient(135deg, #3d2c00 0%, #b5830a 50%, #4d3800 100%)',  // L6 – amber
  'linear-gradient(135deg, #1a001a 0%, #7209b7 50%, #3a0068 100%)',  // L7 – violet
  'linear-gradient(135deg, #001a33 0%, #0096c7 50%, #00335e 100%)',  // L8 – cyan
  'linear-gradient(135deg, #001a00 0%, #52b788 50%, #1b4332 100%)',  // L9 – teal
  'linear-gradient(135deg, #1a1200 0%, #e9c46a 50%, #3d2c00 100%)',  // L10 – gold
];

function setLevelBackground(level, set) {
  const gradient = LEVEL_GRADIENTS[level] || LEVEL_GRADIENTS[1];
  document.body.style.background = gradient;
  const setImages = (set && levelImages[set]) ? levelImages[set] : levelImages;
  const filename = setImages[level] || setImages[String(level)];
  if (!filename) return;
  const imgPath = `./images/${filename}`;
  const img = new Image();
  img.onload = () => {
    document.body.style.background =
      `linear-gradient(rgba(10,8,30,0.62), rgba(10,8,30,0.62)), url('${imgPath}') center/cover no-repeat`;
  };
  img.src = imgPath;
}

function renderPicker() {
  if (pickerImageUrl) {
    document.body.style.background =
      `linear-gradient(rgba(10,8,30,0.62), rgba(10,8,30,0.62)), url('${pickerImageUrl}') center/cover no-repeat`;
  } else {
    document.body.style.background = LEVEL_GRADIENTS[1];
  }
}

function renderLevelRow(containerId, set) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const levelKey   = set === 'numbers' ? 'numberLevel' : 'wordLevel';
  const unlocked   = stored.settings[levelKey];
  container.innerHTML = '';

  for (let l = 1; l <= MAX_LEVEL; l++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    if (l < unlocked) {
      btn.classList.add('done');
      btn.textContent = `L${l} ✓`;
      btn.addEventListener('click', () => {
        speak(`Level ${l}!`, 1.1, () => startRound(set, l));
      });
    } else if (l === unlocked) {
      btn.classList.add('current');
      btn.textContent = `L${l}`;
      btn.addEventListener('click', () => {
        speak(`Level ${l}!`, 1.1, () => startRound(set, l));
      });
    } else {
      btn.classList.add('locked');
      btn.textContent = `L${l}`;
      btn.setAttribute('aria-label', `Level ${l} locked`);
      btn.addEventListener('click', () => {
        speak(`Finish level ${l - 1} first!`, 1.0);
      });
    }
    container.appendChild(btn);
  }
}

function renderSettingsLevelRows() {
  renderSettingsLevelRow('s-word-level-row',   'wordLevel');
  renderSettingsLevelRow('s-num-level-row',    'numberLevel');
}

function renderSettingsLevelRow(containerId, levelKey) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const current = stored.settings[levelKey];
  container.innerHTML = '';
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    if      (l < current)  { btn.classList.add('done');    btn.textContent = `L${l} ✓`; }
    else if (l === current) { btn.classList.add('current'); btn.textContent = `L${l}`; }
    else                    { btn.classList.add('locked');  btn.textContent = `L${l}`; }
    btn.addEventListener('click', () => {
      stored.settings[levelKey] = l;
      saveStored();
      renderSettingsLevelRow(containerId, levelKey);
    });
    container.appendChild(btn);
  }
}

// ============================================================
// CUSTOM ITEMS
// ============================================================

function clampLevel(level) {
  const n = parseInt(level, 10);
  return Math.min(MAX_LEVEL, Math.max(1, isNaN(n) ? 1 : n));
}

function addCustomWord(displayText, level) {
  const display = displayText.trim();
  if (!display) return;
  const lower = display.toLowerCase();
  const dupe  = Object.values(stored.items).find(i => i.kind === 'word' && i.display.toLowerCase() === lower);
  if (dupe) { speak('That word is already in the list.', 1.0); return; }

  const id = 'custom:word:' + lower.replace(/[^a-z0-9]/g, '_');
  stored.items[id] = makeItem({ id, display, accepted: [lower], level: clampLevel(level) }, 'word');
  saveStored();
  renderTuneList();
}

function addCustomNumber(numStr, level) {
  const num = parseInt(numStr, 10);
  if (isNaN(num) || num < 1 || num > 999) { speak('Please enter a number between 1 and 999.', 1.0); return; }
  const dupe = Object.values(stored.items).find(i => i.kind === 'number' && i.display === String(num));
  if (dupe) { speak('That number is already in the list.', 1.0); return; }

  const id = 'custom:num:' + num;
  stored.items[id] = makeItem({ id, display: String(num), accepted: [numberToWords(num)], level: clampLevel(level) }, 'number');
  saveStored();
  renderTuneList();
}

function removeCustomItem(id) {
  if (!id.startsWith('custom:')) return;
  delete stored.items[id];
  saveStored();
  renderTuneList();
}

// ============================================================
// TUNING LIST (audition every term, edit accepted lists)
// ============================================================

let tuneTab    = 'words';
let tuneSearch = '';

function openTuning() {
  showScreen('tuning');
  tuneSearch = '';
  const search = document.getElementById('tune-search');
  if (search) search.value = '';
  renderTuneList();
  createAuditionRecognizer();
  openMicStream();
}

function closeTuning() {
  if (auditionState === 'listening') stopAudition();
  if (auditionRecognizer) { try { auditionRecognizer.remove(); } catch (_) {} auditionRecognizer = null; }
  auditionState = 'idle';
  closeMicStream();
  openGrownUp();
}

function setTuneTab(tab) {
  tuneTab = tab;
  document.getElementById('tune-tab-words').classList.toggle('active', tab === 'words');
  document.getElementById('tune-tab-numbers').classList.toggle('active', tab === 'numbers');
  renderTuneList();
}

function renderTuneList() {
  const list = document.getElementById('tune-list');
  if (!list) return;
  const kind = tuneTab === 'numbers' ? 'number' : 'word';
  const q    = tuneSearch.trim().toLowerCase();
  const scrollTop = list.scrollTop;
  list.innerHTML = '';

  const all       = Object.values(stored.items).filter(i => i.kind === kind);
  const canonical = all.filter(i => !i.id.startsWith('custom:'));
  const customs   = all.filter(i =>  i.id.startsWith('custom:'));
  const matchesQ  = (i) => !q || i.display.toLowerCase().includes(q) ||
                           i.accepted.some(a => a.toLowerCase().includes(q));

  for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
    const items = canonical.filter(i => (i.level || 1) === lvl && matchesQ(i));
    if (!items.length) continue;
    list.appendChild(makeTuneHeader('Level ' + lvl));
    for (const item of items) list.appendChild(buildTuneRow(item, false));
  }

  list.appendChild(makeTuneHeader(kind === 'number' ? 'Custom numbers' : 'Custom words'));
  for (const item of customs.filter(matchesQ)) list.appendChild(buildTuneRow(item, true));
  list.appendChild(buildCustomAddRow(kind));

  list.scrollTop = scrollTop;
}

function makeTuneHeader(text) {
  const h = document.createElement('div');
  h.className   = 'tune-group-header';
  h.textContent = text;
  return h;
}

function buildTuneRow(item, isCustom) {
  const row = document.createElement('div');
  row.className   = 'tune-row';
  row.dataset.id  = item.id;

  const preview = document.createElement('button');
  preview.className   = 'tune-preview';
  preview.textContent = '🔊';
  preview.setAttribute('aria-label', 'Hear ' + item.display);
  preview.addEventListener('click', () => speakWord(item.display));

  const disp = document.createElement('span');
  disp.className   = 'tune-display' + (item.kind === 'number' ? ' is-number' : '');
  disp.textContent = item.display;

  const badge = document.createElement('span');
  badge.className   = 'tune-hidden-badge';
  badge.textContent = 'hidden';
  const confs = item.auditionConfs || [];
  const lowConf = confs.length >= MIN_CONF_ATTEMPTS &&
    confs.reduce((s, c) => s + c, 0) / confs.length < MIN_CONF_THRESHOLD;
  badge.title = lowConf
    ? 'Hidden from practice (recognizer confidence too low — avg ' +
      Math.round(confs.reduce((s, c) => s + c, 0) / confs.length * 100) + '% across ' + confs.length + ' tries)'
    : 'Hidden from practice (more than ' + MAX_ACCEPTED_FOR_ACTIVE + ' accepted answers)';

  const terms = document.createElement('div');
  terms.className = 'tune-terms';
  fillTermChips(terms, item);

  const addTerm = document.createElement('button');
  addTerm.className   = 'tune-add-term';
  addTerm.textContent = '＋';
  addTerm.setAttribute('aria-label', 'Add accepted term to ' + item.display);
  addTerm.addEventListener('click', () => revealTermInput(row, item));

  const audi = document.createElement('button');
  audi.className   = 'tune-audition';
  audi.textContent = '🎤';
  audi.setAttribute('aria-label', 'Audition ' + item.display);
  audi.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { audi.setPointerCapture(e.pointerId); } catch (_) {}
    armAudition(item.id);
  });
  audi.addEventListener('pointerup',     () => stopAudition());
  audi.addEventListener('pointercancel', () => stopAudition());

  const result = document.createElement('span');
  result.className = 'tune-result';

  row.append(preview, disp, badge);

  if (isCustom) {
    const lvlSel = makeLevelSelect(item.level || 1);
    lvlSel.title = 'Level this custom item is practised in';
    lvlSel.addEventListener('change', () => {
      item.level = clampLevel(lvlSel.value);
      saveStored();
    });
    row.append(lvlSel);
  }

  row.append(terms, addTerm, audi);

  if (isCustom) {
    const del = document.createElement('button');
    del.className   = 'tune-del';
    del.textContent = '🗑';
    del.setAttribute('aria-label', 'Delete ' + item.display);
    del.addEventListener('click', () => removeCustomItem(item.id));
    row.append(del);
  }

  row.append(result);  // full-width, must stay last so it wraps cleanly
  refreshRowExcluded(row, item);
  return row;
}

function makeLevelSelect(selected) {
  const sel = document.createElement('select');
  sel.className = 'tune-level-select';
  for (let l = 1; l <= MAX_LEVEL; l++) {
    const o = document.createElement('option');
    o.value = String(l);
    o.textContent = 'L' + l;
    if (l === selected) o.selected = true;
    sel.appendChild(o);
  }
  return sel;
}

function fillTermChips(container, item) {
  container.innerHTML = '';
  for (const term of item.accepted) {
    const chip  = document.createElement('span');
    chip.className = 'term-chip';
    const label = document.createElement('span');
    label.textContent = term;
    chip.appendChild(label);
    const x = document.createElement('button');
    x.className   = 'term-chip-del';
    x.textContent = '×';
    x.setAttribute('aria-label', 'Remove ' + term);
    x.addEventListener('click', () => {
      if (item.accepted.length <= 1) { speak('Keep at least one accepted answer.', 1.0); return; }
      item.accepted = item.accepted.filter(a => a !== term);
      saveStored();
      fillTermChips(container, item);
    });
    chip.appendChild(x);
    container.appendChild(chip);
  }
  const row = container.closest('.tune-row');
  if (row) refreshRowExcluded(row, item);
}

// Colour-mark rows whose item is soft-excluded (too many accepted answers).
function refreshRowExcluded(row, item) {
  row.classList.toggle('excluded', !isItemActive(item));
}

function revealTermInput(row, item) {
  const existing = row.querySelector('.tune-term-input');
  if (existing) { existing.focus(); return; }
  const input = document.createElement('input');
  input.type         = 'text';
  input.className     = 'tune-term-input';
  input.placeholder   = 'new term';
  input.autocomplete = 'off';
  input.spellcheck   = false;
  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const val = input.value;
    input.remove();
    if (addAcceptedTerm(item, val)) fillTermChips(row.querySelector('.tune-terms'), item);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') { committed = true; input.remove(); }
  });
  input.addEventListener('blur', commit);
  row.querySelector('.tune-terms').after(input);
  input.focus();
}

function buildCustomAddRow(kind) {
  const wrap = document.createElement('div');
  wrap.className = 'tune-custom-add';
  const input = document.createElement('input');
  input.className = 'tune-custom-input';
  if (kind === 'number') {
    input.type = 'number'; input.min = '1'; input.max = '999'; input.placeholder = 'e.g. 21';
  } else {
    input.type = 'text'; input.maxLength = 30; input.placeholder = 'e.g. Peppa';
    input.autocomplete = 'off'; input.spellcheck = false;
  }
  const defaultLevel = kind === 'number' ? stored.settings.numberLevel : stored.settings.wordLevel;
  const levelSel = makeLevelSelect(clampLevel(defaultLevel));
  levelSel.title = 'Level the new item goes into';

  const btn = document.createElement('button');
  btn.className   = 'custom-add-btn';
  btn.textContent = 'Add';
  const add = () => {
    const lvl = clampLevel(levelSel.value);
    if (kind === 'number') addCustomNumber(input.value, lvl);
    else                   addCustomWord(input.value, lvl);
    input.value = '';
  };
  btn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
  wrap.append(input, levelSel, btn);
  return wrap;
}

function tuneRowEl(id) {
  return document.querySelector('.tune-row[data-id="' + CSS.escape(id) + '"]');
}

function setRowListening(id, on) {
  const row = tuneRowEl(id);
  if (!row) return;
  row.querySelector('.tune-audition').classList.toggle('listening', on);
  if (on) {
    const r = row.querySelector('.tune-result');
    r.className   = 'tune-result listening';
    r.textContent = 'Listening…';
  }
}

function setRowResult(id, cls, text) {
  const row = tuneRowEl(id);
  if (!row) return;
  const r = row.querySelector('.tune-result');
  r.className   = 'tune-result ' + cls;
  r.textContent = text;
}

function confLabel(conf) {
  if (conf == null) return '';
  const pct = Math.round(conf * 100);
  return ' (' + pct + '% conf)';
}

function meanConfLabel(item) {
  const confs = item.auditionConfs || [];
  if (!confs.length) return '';
  const mean = confs.reduce((s, c) => s + c, 0) / confs.length;
  return ' avg ' + Math.round(mean * 100) + '%';
}

function renderAuditionResult(id, best, matched, item, sessionConf) {
  const row = tuneRowEl(id);
  if (!row) return;
  const r = row.querySelector('.tune-result');
  r.innerHTML = '';
  if (!best) {
    r.className   = 'tune-result miss';
    r.textContent = '— nothing heard' + meanConfLabel(item);
    return;
  }
  if (matched) {
    r.className   = 'tune-result ok';
    r.textContent = '✓ “' + best + '”' + confLabel(sessionConf) + meanConfLabel(item);
    return;
  }
  r.className = 'tune-result miss';
  const span = document.createElement('span');
  span.textContent = '✗ “' + best + '”' + confLabel(sessionConf) + meanConfLabel(item) + ' ';
  const add = document.createElement('button');
  add.className   = 'tune-result-add';
  add.textContent = 'Add';
  add.addEventListener('click', () => {
    if (addAcceptedTerm(item, best)) fillTermChips(row.querySelector('.tune-terms'), item);
    r.className   = 'tune-result ok';
    r.textContent = '✓ added';
  });
  r.append(span, add);
}

// ============================================================
// GROWN-UP SETTINGS
// ============================================================

function openGrownUp() {
  renderSettings();
  renderSettingsLevelRows();
  renderProgress();
  populateVoiceSelect();
  showScreen('grownup');
}

function populateVoiceSelect() {
  const sel = document.getElementById('s-voice');
  if (!sel || !stored) return;
  sel.innerHTML = '<option value="">Auto (prefers online voices)</option>';
  const en = voices.filter(v => v.lang.startsWith('en'));
  const online = en.filter(v => !v.localService);
  const local  = en.filter(v => v.localService);
  for (const v of [...online, ...local]) {
    const opt = document.createElement('option');
    opt.value       = v.name;
    opt.textContent = `${v.localService ? '' : '★ '}${v.name} (${v.lang})`;
    opt.selected    = v.name === stored.settings.voiceName;
    sel.appendChild(opt);
  }
}

function renderSettings() {
  const s = stored.settings;
  document.getElementById('s-round-size').value        = s.roundSize;
  document.getElementById('s-retry-cap').value         = s.retryCap;
  document.getElementById('s-mastery-threshold').value = s.masteryThreshold;
  document.getElementById('s-speech-rate').value       = s.speechRate;
  document.getElementById('s-rate-value').textContent  = s.speechRate + '×';
}

function saveSettings() {
  const s = stored.settings;
  s.roundSize         = Math.max(4,  parseInt(document.getElementById('s-round-size').value)        || 10);
  s.retryCap          = Math.max(1,  parseInt(document.getElementById('s-retry-cap').value)         || 2);
  s.masteryThreshold  = Math.max(1,  parseInt(document.getElementById('s-mastery-threshold').value) || 3);
  s.speechRate        = parseFloat(document.getElementById('s-speech-rate').value)                 || 0.9;
  s.voiceName         = document.getElementById('s-voice').value || null;
  saveStored();
}

function renderProgress() {
  const grid    = document.getElementById('progress-grid');
  const summary = document.getElementById('progress-summary');
  if (!grid || !summary) return;

  let counts = { new: 0, learning: 0, unaided: 0, mastered: 0, hidden: 0 };
  grid.innerHTML = '';

  for (const item of Object.values(stored.items)) {
    const cell     = document.createElement('div');
    cell.className = 'progress-cell';
    cell.title     = item.display;
    cell.textContent = item.display.length <= 4 ? item.display : item.display.slice(0, 4);

    if (!isItemActive(item)) {
      cell.classList.add('excluded'); counts.hidden++;
    } else if (item.mastered) {
      cell.classList.add('mastered'); counts.mastered++;
    } else if (item.totalAttempts === 0) {
      cell.classList.add('new');      counts.new++;
    } else if (item.unaidedStreak === 0) {
      cell.classList.add('learning'); counts.learning++;
    } else {
      cell.classList.add('unaided');  counts.unaided++;
    }
    grid.appendChild(cell);
  }

  summary.innerHTML = `
    ⬜ New: ${counts.new} &nbsp;
    📖 Learning: ${counts.learning} &nbsp;
    🎯 Unaided: ${counts.unaided} &nbsp;
    ⭐ Mastered: ${counts.mastered} &nbsp;
    🚫 Hidden: ${counts.hidden}
  `;
}

// ============================================================
// GROWN-UP GATE
// ============================================================

function setupGate() {
  const gate = document.getElementById('grownup-gate');
  let timer     = null;
  let pressedAt = 0;

  const start = (e) => {
    e.preventDefault();
    pressedAt = Date.now();
    gate.classList.add('holding');
    clearTimeout(timer);
    timer = setTimeout(() => {
      gate.classList.remove('holding');
      pressedAt = 0;
      openGrownUp();
    }, 2000);
  };

  const cancel = () => {
    gate.classList.remove('holding');
    clearTimeout(timer);
    if (pressedAt && Date.now() - pressedAt < 2000) {
      speak('Hold the gear button for two seconds to open the grown-up settings.', 1.0);
    }
    pressedAt = 0;
  };

  gate.addEventListener('pointerdown',   start);
  gate.addEventListener('pointerup',     cancel);
  gate.addEventListener('pointerleave',  cancel);
  gate.addEventListener('pointercancel', cancel);
}

// ============================================================
// EVENTS
// ============================================================

function setupEvents() {

  document.getElementById('btn-mode-words').addEventListener('click', () => {
    startRound('words', stored.settings.wordLevel);
  });
  document.getElementById('btn-mode-numbers').addEventListener('click', () => {
    startRound('numbers', stored.settings.numberLevel);
  });

  // Hear button — tap to speak the current word/number
  const hearBtn = document.getElementById('hear-button');
  hearBtn.addEventListener('click', () => {
    if (micState !== 'ready' || !gs.currentItem) return;
    gs.hearPressed = true;
    setMicState('waiting');
    speakWord(gs.currentItem.display, () => {
      if (gs.currentItem && !gs.awaitingResult) setMicState('ready');
    });
  });

  const micBtn = document.getElementById('mic-button');
  let holdStart = 0;

  micBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    DBG('pointerdown', { micState, type: e.pointerType });
    try { micBtn.setPointerCapture(e.pointerId); } catch (_) {}
    if (micState === 'ready') {
      holdStart = Date.now();
      startListening();
    } else if (micState === 'listening') {
      requestStopAndEvaluate();
    }
  });

  micBtn.addEventListener('pointerup', () => {
    const held = Date.now() - holdStart;
    DBG('pointerup', { micState, heldMs: held });
    if (micState !== 'listening') return;
    if (held >= 250) requestStopAndEvaluate();
    // quick tap stays green: child speaks, taps again to submit
  });

  micBtn.addEventListener('pointercancel', () => {
    DBG('pointercancel', { micState });
    if (micState === 'listening') requestStopAndEvaluate();
  });

  document.getElementById('tomorrow-text').addEventListener('click', () => {
    renderPicker();
    showScreen('picker');
  });

  document.getElementById('btn-levelup-continue').addEventListener('click', () => {
    renderPicker();
    showScreen('picker');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    saveSettings();
    renderPicker();
    showScreen('picker');
  });

  document.getElementById('s-speech-rate').addEventListener('input', (e) => {
    document.getElementById('s-rate-value').textContent = parseFloat(e.target.value).toFixed(1) + '×';
    saveSettings();
  });
  for (const id of ['s-round-size','s-retry-cap','s-mastery-threshold']) {
    document.getElementById(id).addEventListener('change', saveSettings);
  }
  document.getElementById('s-voice').addEventListener('change', () => {
    saveSettings();
    speak('Hello! This is how I sound.', 0.9);
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm(`This will erase all progress in "${STORAGE_KEY}". Are you sure?`)) return;
    localStorage.removeItem(STORAGE_KEY);
    stored = freshState();
    saveStored();
    renderSettings();
    renderProgress();
    renderTuneList();
    speak('All progress has been reset. Ready to start fresh!', 0.9);
  });

  // Tuning screen (audition & edit every term)
  document.getElementById('btn-open-tuning').addEventListener('click', openTuning);
  document.getElementById('btn-tune-back').addEventListener('click', closeTuning);
  document.getElementById('btn-tune-export').addEventListener('click', () => {
    const out  = window.rlExportAccepted();
    const adds = Object.keys(out.acceptedAdditions).length;
    const cust = out.customItems.length;
    alert(
      `Exported to clipboard (and console):\n` +
      `• ${adds} item(s) with new accepted terms\n` +
      `• ${cust} custom item(s)\n\n` +
      `Paste it in to bake these into the canonical app.`
    );
  });
  document.getElementById('tune-tab-words').addEventListener('click', () => setTuneTab('words'));
  document.getElementById('tune-tab-numbers').addEventListener('click', () => setTuneTab('numbers'));
  document.getElementById('tune-search').addEventListener('input', (e) => {
    tuneSearch = e.target.value;
    renderTuneList();
  });

  setupGate();
}

// ============================================================
// INIT
// ============================================================

async function init() {
  console.log('[ReadingLearner] build v19 — alternating tint marks sound-unit groups. Type rlDump() / rlExportAccepted().');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js')
      .catch(e => DBG('sw', 'register failed: ' + e.message));
  }

  loadStored();
  if (!stored) return;
  loadVoices();

  const flash = document.createElement('div');
  flash.id        = 'flash-overlay';
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);

  setupEvents();
  showScreen('loading');

  await Promise.all([initVosk(), loadImageManifest()]);

  renderPicker();
  showScreen('picker');
}

document.addEventListener('DOMContentLoaded', init);
