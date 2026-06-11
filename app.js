'use strict';

// ============================================================
// CONTENT
// ============================================================

const NUMBERS_CONTENT = [
  { id: 'num:1',  display: '1',  accepted: ['one','won','1'] },
  { id: 'num:2',  display: '2',  accepted: ['two','to','too','2'] },
  { id: 'num:3',  display: '3',  accepted: ['three','3'] },
  { id: 'num:4',  display: '4',  accepted: ['four','for','fore','4'] },
  { id: 'num:5',  display: '5',  accepted: ['five','5'] },
  { id: 'num:6',  display: '6',  accepted: ['six','6'] },
  { id: 'num:7',  display: '7',  accepted: ['seven','7'] },
  { id: 'num:8',  display: '8',  accepted: ['eight','ate','8'] },
  { id: 'num:9',  display: '9',  accepted: ['nine','9'] },
  { id: 'num:10', display: '10', accepted: ['ten','10'] },
  { id: 'num:11', display: '11', accepted: ['eleven','11'] },
  { id: 'num:12', display: '12', accepted: ['twelve','12'] },
  { id: 'num:13', display: '13', accepted: ['thirteen','13'] },
  { id: 'num:14', display: '14', accepted: ['fourteen','14'] },
  { id: 'num:15', display: '15', accepted: ['fifteen','15'] },
  { id: 'num:16', display: '16', accepted: ['sixteen','16'] },
  { id: 'num:17', display: '17', accepted: ['seventeen','17'] },
  { id: 'num:18', display: '18', accepted: ['eighteen','18'] },
  { id: 'num:19', display: '19', accepted: ['nineteen','19'] },
  { id: 'num:20', display: '20', accepted: ['twenty','20'] },
];

const WORDS_CONTENT = [
  { id: 'word:a',      display: 'a',      accepted: ['a','uh','ah'] },
  { id: 'word:and',    display: 'and',    accepted: ['and'] },
  { id: 'word:away',   display: 'away',   accepted: ['away'] },
  { id: 'word:big',    display: 'big',    accepted: ['big'] },
  { id: 'word:blue',   display: 'blue',   accepted: ['blue','blew'] },
  { id: 'word:can',    display: 'can',    accepted: ['can'] },
  { id: 'word:come',   display: 'come',   accepted: ['come'] },
  { id: 'word:down',   display: 'down',   accepted: ['down'] },
  { id: 'word:find',   display: 'find',   accepted: ['find','fined'] },
  { id: 'word:for',    display: 'for',    accepted: ['for','four','fore'] },
  { id: 'word:funny',  display: 'funny',  accepted: ['funny'] },
  { id: 'word:go',     display: 'go',     accepted: ['go'] },
  { id: 'word:help',   display: 'help',   accepted: ['help'] },
  { id: 'word:here',   display: 'here',   accepted: ['here','hear'] },
  { id: 'word:i',      display: 'I',      accepted: ['i','eye','ay'] },
  { id: 'word:in',     display: 'in',     accepted: ['in','inn'] },
  { id: 'word:is',     display: 'is',     accepted: ['is'] },
  { id: 'word:it',     display: 'it',     accepted: ['it'] },
  { id: 'word:jump',   display: 'jump',   accepted: ['jump'] },
  { id: 'word:little', display: 'little', accepted: ['little'] },
  { id: 'word:look',   display: 'look',   accepted: ['look'] },
  { id: 'word:make',   display: 'make',   accepted: ['make'] },
  { id: 'word:me',     display: 'me',     accepted: ['me'] },
  { id: 'word:my',     display: 'my',     accepted: ['my'] },
  { id: 'word:not',    display: 'not',    accepted: ['not','knot'] },
  { id: 'word:one',    display: 'one',    accepted: ['one','won'] },
  { id: 'word:play',   display: 'play',   accepted: ['play'] },
  { id: 'word:red',    display: 'red',    accepted: ['red','read'] },
  { id: 'word:run',    display: 'run',    accepted: ['run'] },
  { id: 'word:said',   display: 'said',   accepted: ['said','sed'] },
  { id: 'word:see',    display: 'see',    accepted: ['see','sea'] },
  { id: 'word:the',    display: 'the',    accepted: ['the','da','duh'] },
  { id: 'word:three',  display: 'three',  accepted: ['three'] },
  { id: 'word:to',     display: 'to',     accepted: ['to','two','too'] },
  { id: 'word:two',    display: 'two',    accepted: ['two','to','too'] },
  { id: 'word:up',     display: 'up',     accepted: ['up'] },
  { id: 'word:we',     display: 'we',     accepted: ['we','wee'] },
  { id: 'word:where',  display: 'where',  accepted: ['where','wear','were'] },
  { id: 'word:yellow', display: 'yellow', accepted: ['yellow'] },
  { id: 'word:you',    display: 'you',    accepted: ['you'] },
];

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
  audioFadeThreshold: 3,
  retryCap: 2,
  grownUpDecides: false,
  voiceName: null,
  speechRate: 0.9,
};

function makeItem(c) {
  return {
    id: c.id,
    kind: c.id.startsWith('num:') ? 'number' : 'word',
    display: c.display,
    accepted: [...c.accepted],
    mode: 'audio',
    successStreak: 0,
    silentCorrect: 0,
    totalCorrect: 0,
    totalAttempts: 0,
    mastered: false,
    lastSeenRound: null,
    lastResult: null,
  };
}

function freshState() {
  const items = {};
  for (const c of NUMBERS_CONTENT) items[c.id] = makeItem(c);
  for (const c of WORDS_CONTENT)   items[c.id] = makeItem(c);
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
    // Merge any new content items not yet in storage
    const fresh = freshState();
    for (const id of Object.keys(fresh.items)) {
      if (!parsed.items[id]) parsed.items[id] = fresh.items[id];
    }
    // Merge missing settings keys
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (parsed.settings[k] === undefined) parsed.settings[k] = DEFAULT_SETTINGS[k];
    }
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
      <p style="color:#a0a0c0;font-size:0.85rem">
        A grown-up can reset all progress using the button below.<br>
        Storage key: <code style="color:#e94560">${STORAGE_KEY}</code>
      </p>
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

let voices = [];

function loadVoices() {
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  populateVoiceSelect();
}

if (window.speechSynthesis) {
  if (speechSynthesis.onvoiceschanged !== undefined) {
    speechSynthesis.onvoiceschanged = loadVoices;
  }
  // Chrome loads voices asynchronously; Safari loads them synchronously
  loadVoices();
}

function getVoice() {
  // Explicit user choice
  if (stored?.settings?.voiceName) {
    const v = voices.find(v => v.name === stored.settings.voiceName);
    if (v) return v;
  }
  // Prefer en-GB (UK accent)
  const gbFemale = voices.find(v =>
    v.lang === 'en-GB' && /female|serena|kate|emily|fiona|amy/i.test(v.name)
  );
  if (gbFemale) return gbFemale;
  const gb = voices.find(v => v.lang === 'en-GB');
  if (gb) return gb;
  // Fall back to any English voice
  return voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
}

// Chrome garbage-collects utterances whose only reference is local, and then
// never fires onend — keep a live reference, and add a watchdog so a dropped
// onend can't stall the app (e.g. mic stuck in 'waiting' forever).
let currentUtterance = null;

function speak(text, rate, onEnd) {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  currentUtterance = utt;
  utt.voice  = getVoice();
  utt.rate   = rate ?? stored?.settings?.speechRate ?? 0.9;
  utt.pitch  = 1.1;
  utt.volume = 1;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(watchdog);
    if (currentUtterance === utt) currentUtterance = null;
    onEnd?.();
  };
  utt.onend   = finish;
  utt.onerror = finish;
  const watchdog = setTimeout(finish, 3000 + text.length * 250);

  speechSynthesis.speak(utt);
}

const speakWord     = (w, cb) => speak(w, stored.settings.speechRate, cb);
const speakPraise   = (cb)    => speak(PRAISE[Math.random() * PRAISE.length | 0], 1.1, cb);
const speakCorrect  = (w, cb) => speak(`Good try! This says ${w}. Now you try.`, 0.85, cb);

// ============================================================
// SPEECH RECOGNITION
// ============================================================

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition       = null;
let heardTranscripts  = []; // everything heard during the current listen (interim + final)
let listenEvaluated   = false;
let settleTimer       = null; // grace period after release for late final results
let maxListenTimer    = null; // hard cap on a single listen
let sessionMicBlocked = false; // mic denied this session — not persisted

// 'waiting':    TTS playing or processing — button disabled
// 'ready':      child's turn — button enabled (red)
// 'listening':  mic open — button green
// 'evaluating': released, waiting for recognition to flush final results
let micState = 'waiting';

function initRecognition() {
  if (!SpeechRecognitionAPI) return;
  recognition = new SpeechRecognitionAPI();
  recognition.lang = 'en-GB';
  // Chrome needs ~0.5 s to spin up the mic and only finalizes results after a
  // silence gap. continuous + interim lets us buffer everything said during
  // the hold instead of losing it when stop() lands too early.
  recognition.continuous      = true;
  recognition.interimResults  = true;
  recognition.maxAlternatives = 5;

  recognition.onresult = (e) => {
    if (micState !== 'listening' && micState !== 'evaluating') return;
    for (let r = 0; r < e.results.length; r++) {
      for (let a = 0; a < e.results[r].length; a++) {
        const t = e.results[r][a].transcript?.trim();
        if (t && !heardTranscripts.includes(t)) heardTranscripts.push(t);
      }
    }
    // A final result can land after the child released — evaluate right away.
    if (micState === 'evaluating') evaluateListen();
  };

  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      listenEvaluated = true;
      clearTimeout(settleTimer);
      clearTimeout(maxListenTimer);
      onMicDenied();
      return;
    }
    // no-speech / aborted / network: judge whatever was buffered (often nothing)
    evaluateListen();
  };

  recognition.onend = () => evaluateListen();
}

function startListening() {
  if (sessionMicBlocked || stored.settings.grownUpDecides) { showFallback(); return; }
  if (!recognition) { onRecognitionFallback(); return; }

  heardTranscripts = [];
  listenEvaluated  = false;
  try {
    recognition.start();
    setMicState('listening');
    maxListenTimer = setTimeout(requestStopAndEvaluate, 10000);
  } catch (e) {
    // InvalidStateError: previous session still closing — kill it and re-arm.
    listenEvaluated = true;
    try { recognition.abort(); } catch (_) {}
    setMicState('ready');
  }
}

// Child released (or tapped again in toggle mode): stop capturing, then give
// Chrome a moment to flush the final transcript before judging.
function requestStopAndEvaluate() {
  if (micState !== 'listening') return;
  clearTimeout(maxListenTimer);
  setMicState('evaluating');
  try { recognition.stop(); } catch (_) {}
  settleTimer = setTimeout(evaluateListen, 1500);
}

function evaluateListen() {
  if (listenEvaluated) return;
  if (micState !== 'listening' && micState !== 'evaluating') return;
  listenEvaluated = true;
  clearTimeout(settleTimer);
  clearTimeout(maxListenTimer);
  try { recognition.stop(); } catch (_) {}

  if (heardTranscripts.length) {
    setMicState('waiting');
    onRecognitionResult([...heardTranscripts]);
  } else {
    setMicState('ready'); // child can immediately try again by voice
    onRecognitionFallback();
  }
}

// ============================================================
// ANSWER MATCHING
// ============================================================

function editDist(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const cur = dp[i];
      dp[i] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, dp[i], dp[i-1]);
      prev = cur;
    }
  }
  return dp[m];
}

function normText(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchAnswer(transcripts, item) {
  if (!transcripts?.length) return false;
  for (const raw of transcripts) {
    const t = normText(raw);
    if (!t) continue;
    for (const acc of item.accepted) {
      const a = normText(acc);
      if (t === a) return true;
      if (t.includes(a)) return true;
      // 1-char tolerance for words 4+ chars
      if (a.length >= 4 && editDist(t, a) <= 1) return true;
    }
  }
  return false;
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

function buildRound(set) {
  roundNumber++;
  const prefix = set === 'numbers' ? 'num:' : 'word:';
  const all = Object.values(stored.items).filter(i => i.id.startsWith(prefix));
  const size = stored.settings.roundSize;

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

  // Fill remainder from anything
  if (round.length < Math.min(size, all.length)) addUp(shuffle(all), size);

  return shuffle(round.slice(0, size));
}

// ============================================================
// GAME STATE
// ============================================================

const gs = {
  currentSet:    null,
  queue:         [],
  originalSize:  0,
  completedCount:0,
  roundCorrect:  0,
  currentItem:   null,
  retryCount:    0,
  recycled:      new Set(),
  awaitingResult:false,
};

function startRound(set) {
  const items = buildRound(set);
  gs.currentSet     = set;
  gs.queue          = [...items];
  gs.originalSize   = items.length;
  gs.completedCount = 0;
  gs.roundCorrect   = 0;
  gs.currentItem    = null;
  gs.retryCount     = 0;
  gs.recycled       = new Set();
  gs.awaitingResult = false;

  showScreen('practice');
  nextItem();
}

function nextItem() {
  if (gs.queue.length === 0) { endRound(); return; }
  gs.currentItem = gs.queue.shift();
  gs.retryCount  = 0;
  gs.currentItem.lastSeenRound = roundNumber;
  gs.awaitingResult = false;
  presentItem(gs.currentItem); // presentItem owns mic state from here
}

function presentItem(item) {
  renderDots();
  setMicState('waiting'); // block mic until TTS is done
  hideFallback();

  const el = document.getElementById('word-display');
  const len = item.display.length;
  el.style.fontSize =
    len <= 2  ? 'clamp(6rem, 25vmin, 14rem)' :
    len <= 4  ? 'clamp(5rem, 20vmin, 10rem)' :
    len <= 7  ? 'clamp(4rem, 15vmin,  8rem)' :
                'clamp(3rem, 11vmin,  5.5rem)';
  el.textContent = item.display;
  el.className   = 'word-display' + (item.mode === 'audio' ? ' audio-mode' : '');

  if (item.mode === 'audio') {
    speakWord(item.display, () => {
      if (gs.currentItem !== item) return;
      setTimeout(() => speak("Your turn!", 1.0, () => {
        if (gs.currentItem === item && !gs.awaitingResult) setMicState('ready');
      }), 200);
    });
  } else {
    // Silent mode: no TTS — mic is ready immediately
    setMicState('ready');
  }
}

function handleAnswer(correct) {
  if (gs.awaitingResult) return;
  gs.awaitingResult = true;
  setMicState('waiting'); // block mic while praise/correction TTS plays
  hideFallback();

  const item = gs.currentItem;
  item.totalAttempts++;

  if (correct) {
    item.totalCorrect++;
    item.successStreak++;
    item.lastResult = 'correct';

    if (item.mode === 'silent') item.silentCorrect++;

    if (item.mode === 'audio' && item.successStreak >= stored.settings.audioFadeThreshold) {
      item.mode = 'silent';
    }
    if (item.mode === 'silent' && item.silentCorrect >= 2) {
      item.mastered = true;
    }

    gs.roundCorrect++;
    gs.completedCount++;
    saveStored();
    flashScreen(true);

    speakPraise(() => {
      gs.awaitingResult = false;
      nextItem();
    });

  } else {
    item.successStreak = 0;
    item.lastResult    = 'miss';

    if (item.mode === 'silent') {
      item.mode        = 'audio';
      item.silentCorrect = 0;
    }

    saveStored();
    flashScreen(false);

    if (gs.retryCount < stored.settings.retryCap) {
      gs.retryCount++;
      speakCorrect(item.display, () => {
        gs.awaitingResult = false;
        presentItem(item);
      });
    } else {
      // Cap reached: say word warmly, recycle once, move on
      gs.completedCount++;
      if (!gs.recycled.has(item.id)) {
        gs.recycled.add(item.id);
        gs.queue.push(item); // comes back later this round
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
    id:         new Date().toISOString(),
    set:        gs.currentSet,
    endedAt:    new Date().toISOString(),
    correct:    gs.roundCorrect,
    total:      gs.completedCount,
  });
  saveStored();
  showAllDone();
}

// ============================================================
// RECOGNITION CALLBACKS
// ============================================================

function onRecognitionResult(transcripts) {
  handleAnswer(matchAnswer(transcripts, gs.currentItem));
}

function onRecognitionFallback() {
  if (gs.awaitingResult) return;
  speak("I didn't quite hear that. Did they say it right?", 0.9);
  showFallback();
}

function onMicDenied() {
  // Session-only: a transient denial must not permanently disable the mic.
  sessionMicBlocked = true;
  setMicState('ready');
  speak("Microphone not available. Please use the buttons below.", 0.9);
  showFallback();
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
  micState = state;
  const btn = document.getElementById('mic-button');
  const lbl = document.getElementById('mic-status');
  btn.classList.remove('listening', 'waiting');
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

function showFallback()  { document.getElementById('fallback-controls').classList.remove('hidden'); }
function hideFallback()  { document.getElementById('fallback-controls').classList.add('hidden'); }

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

function showAllDone() {
  showScreen('alldone');
  const correct = gs.roundCorrect;
  const total   = gs.completedCount;
  const stars   = Math.max(1, Math.round((correct / Math.max(total, 1)) * 5));

  document.getElementById('stars-burst').textContent  = '⭐'.repeat(stars);
  document.getElementById('alldone-title').textContent = shuffle(['Amazing work!','Well done!','Great job!','You did it!','Fantastic!'])[0];
  document.getElementById('alldone-score').textContent = `${correct} out of ${total}`;

  setTimeout(() => speak(
    `Well done! You got ${correct} right. Play again tomorrow!`, 0.9
  ), 600);
}

// ============================================================
// GROWN-UP SETTINGS
// ============================================================

function openGrownUp() {
  renderSettings();
  renderProgress();
  populateVoiceSelect();
  showScreen('grownup');
}

function populateVoiceSelect() {
  const sel = document.getElementById('s-voice');
  // voiceschanged can fire before init() has loaded storage
  if (!sel || !stored) return;
  sel.innerHTML = '<option value="">Auto (en-GB preferred)</option>';
  for (const v of voices) {
    if (!v.lang.startsWith('en')) continue;
    const opt = document.createElement('option');
    opt.value    = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    opt.selected = v.name === stored.settings.voiceName;
    sel.appendChild(opt);
  }
}

function renderSettings() {
  const s = stored.settings;
  document.getElementById('s-round-size').value      = s.roundSize;
  document.getElementById('s-fade-threshold').value  = s.audioFadeThreshold;
  document.getElementById('s-retry-cap').value       = s.retryCap;
  document.getElementById('s-grownup-decides').checked = s.grownUpDecides;
  document.getElementById('s-speech-rate').value     = s.speechRate;
  document.getElementById('s-rate-value').textContent = s.speechRate + '×';
}

function saveSettings() {
  const s   = stored.settings;
  s.roundSize          = Math.max(4, parseInt(document.getElementById('s-round-size').value)     || 10);
  s.audioFadeThreshold = Math.max(1, parseInt(document.getElementById('s-fade-threshold').value) || 3);
  s.retryCap           = Math.max(1, parseInt(document.getElementById('s-retry-cap').value)      || 2);
  s.grownUpDecides     = document.getElementById('s-grownup-decides').checked;
  s.speechRate         = parseFloat(document.getElementById('s-speech-rate').value)              || 0.9;
  s.voiceName          = document.getElementById('s-voice').value || null;
  saveStored();
}

function renderProgress() {
  const grid    = document.getElementById('progress-grid');
  const summary = document.getElementById('progress-summary');
  if (!grid || !summary) return;

  let counts = { new: 0, learning: 0, silent: 0, mastered: 0 };
  grid.innerHTML = '';

  for (const item of Object.values(stored.items)) {
    const cell = document.createElement('div');
    cell.className = 'progress-cell';
    cell.title     = item.display;
    const label    = item.display.length <= 4 ? item.display : item.display.slice(0, 4);
    cell.textContent = label;

    if (item.mastered) {
      cell.classList.add('mastered'); counts.mastered++;
    } else if (item.totalAttempts === 0) {
      cell.classList.add('new');      counts.new++;
    } else if (item.mode === 'audio') {
      cell.classList.add('learning'); counts.learning++;
    } else {
      cell.classList.add('silent');   counts.silent++;
    }
    grid.appendChild(cell);
  }

  summary.innerHTML = `
    ⬜ New: ${counts.new} &nbsp;
    🔊 Learning: ${counts.learning} &nbsp;
    🤫 Silent: ${counts.silent} &nbsp;
    ⭐ Mastered: ${counts.mastered}
  `;
}

// ============================================================
// GROWN-UP GATE (hold gear icon for 2 s)
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
    // Released too early: teach the gesture instead of doing nothing
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
  // Picker
  document.getElementById('btn-numbers').addEventListener('click', () => {
    speak('Numbers!', 1.0, () => startRound('numbers'));
  });
  document.getElementById('btn-words').addEventListener('click', () => {
    speak('Words!', 1.0, () => startRound('words'));
  });

  // Mic button — push-and-hold (primary) + tap-to-toggle (accommodation)
  const micBtn = document.getElementById('mic-button');
  let holdStart = 0;

  micBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { micBtn.setPointerCapture(e.pointerId); } catch (_) {}
    if (micState === 'ready') {
      holdStart = Date.now();
      startListening();                // green immediately on press-down
    } else if (micState === 'listening') {
      requestStopAndEvaluate();        // second tap of toggle mode: submit
    }
    // 'waiting'/'evaluating': ignore
  });

  micBtn.addEventListener('pointerup', () => {
    if (micState !== 'listening') return;
    if (Date.now() - holdStart >= 250) {
      requestStopAndEvaluate();        // hold-release: evaluate what was said
    }
    // quick tap (< 250 ms): stay green — child speaks, then taps again to submit
  });

  micBtn.addEventListener('pointercancel', () => {
    if (micState === 'listening') requestStopAndEvaluate();
  });

  // Grown-up fallback
  document.getElementById('btn-correct').addEventListener('click', () => {
    hideFallback();
    handleAnswer(true);
  });
  document.getElementById('btn-retry').addEventListener('click', () => {
    hideFallback();
    setMicState('waiting');
    // Re-speak the word, then hand the turn back to the child
    speakWord(gs.currentItem.display, () => {
      setMicState('ready');
      if (sessionMicBlocked || stored.settings.grownUpDecides) showFallback();
    });
  });

  // All-done
  document.getElementById('btn-tomorrow').addEventListener('click', () => {
    speak('See you next time! Bye bye!', 0.9, () => showScreen('picker'));
  });

  // Grown-up back
  document.getElementById('btn-back').addEventListener('click', () => {
    saveSettings();
    showScreen('picker');
  });

  // Settings live-save
  document.getElementById('s-speech-rate').addEventListener('input', (e) => {
    document.getElementById('s-rate-value').textContent = parseFloat(e.target.value).toFixed(1) + '×';
    saveSettings();
  });
  for (const id of ['s-round-size','s-fade-threshold','s-retry-cap']) {
    document.getElementById(id).addEventListener('change', saveSettings);
  }
  document.getElementById('s-grownup-decides').addEventListener('change', saveSettings);
  document.getElementById('s-voice').addEventListener('change', () => {
    saveSettings();
    // Preview selected voice
    speak('Hello! This is how I sound.', 0.9);
  });

  // Reset
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm(`This will erase all progress in "${STORAGE_KEY}". Are you sure?`)) return;
    localStorage.removeItem(STORAGE_KEY);
    stored = freshState();
    saveStored();
    renderSettings();
    renderProgress();
    speak('All progress has been reset. Ready to start fresh!', 0.9);
  });

  setupGate();
}

// ============================================================
// INIT
// ============================================================

function init() {
  console.log('[ReadingLearner] build v6');
  loadStored();
  if (!stored) return; // storage error replaced body content
  loadVoices(); // re-run: voiceschanged may have fired before storage existed

  // Flash overlay
  const flash = document.createElement('div');
  flash.id        = 'flash-overlay';
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);

  initRecognition();
  setupEvents();
  showScreen('picker');
}

document.addEventListener('DOMContentLoaded', init);
