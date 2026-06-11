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

// ============================================================
// CONTENT
// ============================================================

const NUMBERS_CONTENT = [
  { id: 'num:1',  display: '1',  accepted: ['one','won'] },
  { id: 'num:2',  display: '2',  accepted: ['two','to','too'] },
  { id: 'num:3',  display: '3',  accepted: ['three'] },
  { id: 'num:4',  display: '4',  accepted: ['four','for','fore'] },
  { id: 'num:5',  display: '5',  accepted: ['five'] },
  { id: 'num:6',  display: '6',  accepted: ['six'] },
  { id: 'num:7',  display: '7',  accepted: ['seven'] },
  { id: 'num:8',  display: '8',  accepted: ['eight','ate'] },
  { id: 'num:9',  display: '9',  accepted: ['nine'] },
  { id: 'num:10', display: '10', accepted: ['ten'] },
  { id: 'num:11', display: '11', accepted: ['eleven'] },
  { id: 'num:12', display: '12', accepted: ['twelve'] },
  { id: 'num:13', display: '13', accepted: ['thirteen'] },
  { id: 'num:14', display: '14', accepted: ['fourteen'] },
  { id: 'num:15', display: '15', accepted: ['fifteen'] },
  { id: 'num:16', display: '16', accepted: ['sixteen'] },
  { id: 'num:17', display: '17', accepted: ['seventeen'] },
  { id: 'num:18', display: '18', accepted: ['eighteen'] },
  { id: 'num:19', display: '19', accepted: ['nineteen'] },
  { id: 'num:20', display: '20', accepted: ['twenty'] },
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
  retryCap: 2,
  grownUpDecides: false,
  voiceName: null,
  speechRate: 0.9,
};

function makeItem(c, kind) {
  return {
    id: c.id,
    kind: kind || (c.id.startsWith('num:') ? 'number' : 'word'),
    display: c.display,
    accepted: [...c.accepted],
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
  for (const c of NUMBERS_CONTENT) items[c.id] = makeItem(c, 'number');
  for (const c of WORDS_CONTENT)   items[c.id] = makeItem(c, 'word');
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
    // Ensure all items have a kind field (migration from v7)
    for (const item of Object.values(parsed.items)) {
      if (!item.kind) item.kind = item.id.startsWith('num:') ? 'number' : 'word';
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

async function openMicStream() {
  if (micStream || micOpening) return;
  micOpening = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    audioCtx   = new AudioContext();
    const src  = audioCtx.createMediaStreamSource(micStream);
    scriptProc = audioCtx.createScriptProcessor(4096, 1, 1);
    scriptProc.onaudioprocess = (e) => {
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
  DBG('startListening', { sessionMicBlocked, grownUpDecides: stored.settings.grownUpDecides, voskReady });
  if (sessionMicBlocked || stored.settings.grownUpDecides) { showFallback(); return; }
  if (!voskReady || !voskRecognizer) { onRecognitionFallback(); return; }
  if (!micStream) {
    // Mic opened in the background at round start; if still pending, show fallback
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
    onRecognitionFallback();
  }
}

// ============================================================
// ANSWER MATCHING
// ============================================================

function normText(s) {
  return s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchAnswer(transcripts, item) {
  if (!transcripts?.length) return false;
  for (const raw of transcripts) {
    const t = normText(raw);
    if (!t || t === '[unk]') continue;
    for (const acc of item.accepted) {
      if (t === normText(acc)) return true;
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
  const kind = set === 'numbers' ? 'number' : 'word';
  const all  = Object.values(stored.items).filter(i => i.kind === kind);
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

  if (round.length < Math.min(size, all.length)) addUp(shuffle(all), size);

  return shuffle(round.slice(0, size));
}

// ============================================================
// GAME STATE
// ============================================================

const gs = {
  currentSet:     null,
  queue:          [],
  originalSize:   0,
  completedCount:      0,
  roundCorrect:        0,
  roundSilentCorrect:  0,
  currentItem:    null,
  retryCount:     0,
  recycled:       new Set(),
  awaitingResult: false,
  hearPressed:    false,
};

function startRound(set) {
  const items = buildRound(set);
  gs.currentSet     = set;
  gs.queue          = [...items];
  gs.originalSize   = items.length;
  gs.completedCount      = 0;
  gs.roundCorrect        = 0;
  gs.roundSilentCorrect  = 0;
  gs.currentItem    = null;
  gs.retryCount     = 0;
  gs.recycled       = new Set();
  gs.awaitingResult = false;
  gs.hearPressed    = false;

  showScreen('practice');
  createRoundRecognizer(set);
  if (!stored.settings.grownUpDecides) openMicStream(); // pre-open; fire and forget
  nextItem();
}

function nextItem() {
  if (gs.queue.length === 0) { endRound(); return; }
  gs.currentItem = gs.queue.shift();
  gs.retryCount  = 0;
  gs.hearPressed = false;
  gs.currentItem.lastSeenRound = roundNumber;
  gs.awaitingResult = false;
  presentItem(gs.currentItem);
}

function presentItem(item) {
  renderDots();
  hideFallback();

  const el  = document.getElementById('word-display');
  const len = item.display.length;
  el.style.fontSize =
    len <= 2  ? 'clamp(6rem, 25vmin, 14rem)' :
    len <= 4  ? 'clamp(5rem, 20vmin, 10rem)' :
    len <= 7  ? 'clamp(4rem, 15vmin,  8rem)' :
                'clamp(3rem, 11vmin,  5.5rem)';
  el.textContent = item.display;
  el.className   = 'word-display';

  DBG('presentItem', { id: item.id });
  setMicState('ready'); // mic and hear button ready immediately — child controls pacing
}

function handleAnswer(correct) {
  if (gs.awaitingResult) return;
  gs.awaitingResult = true;
  setMicState('waiting');
  hideFallback();

  const item = gs.currentItem;
  item.totalAttempts++;

  if (correct) {
    item.totalCorrect++;
    item.successStreak++;
    item.lastResult = 'correct';

    if (!gs.hearPressed) {
      item.silentCorrect++;
      gs.roundSilentCorrect++;
    }

    if (item.silentCorrect >= 2) {
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
    endedAt: new Date().toISOString(),
    correct: gs.roundCorrect,
    total:   gs.completedCount,
  });
  saveStored();
  closeMicStream();
  showAllDone();
}

// ============================================================
// RECOGNITION CALLBACKS
// ============================================================

function onRecognitionResult(transcripts) {
  const matched = matchAnswer(transcripts, gs.currentItem);
  DBG('judge', { expected: gs.currentItem?.display, heard: transcripts, matched });
  handleAnswer(matched);
}

function onRecognitionFallback() {
  DBG('onRecognitionFallback', { awaitingResult: gs.awaitingResult });
  if (gs.awaitingResult) return;
  speak("I didn't quite hear that. Did they say it right?", 0.9);
  showFallback();
}

function onMicDenied() {
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

function showFallback() { document.getElementById('fallback-controls').classList.remove('hidden'); }
function hideFallback() { document.getElementById('fallback-controls').classList.add('hidden'); }

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
  const total  = gs.originalSize;
  const silent = gs.roundSilentCorrect;
  const stars  = Math.max(1, Math.round(
    (silent > 0 ? silent : gs.roundCorrect) / Math.max(total, 1) * 5
  ));

  document.getElementById('stars-burst').textContent = '⭐'.repeat(stars);
  document.getElementById('alldone-title').textContent = `You practised ${total} word${total !== 1 ? 's' : ''}`;

  let scoreText, speakText;
  if (silent >= total && total > 0) {
    scoreText  = 'Read them all by yourself!';
    speakText  = `You practised ${total} words, and read them all by yourself. See you again tomorrow!`;
  } else if (silent > 0) {
    scoreText  = `Got ${silent} right without hearing!`;
    speakText  = `You practised ${total} words, and got ${silent} right without hearing them first. See you again tomorrow!`;
  } else {
    scoreText  = "You're learning — keep it up!";
    speakText  = `You practised ${total} words today. See you again tomorrow!`;
  }

  document.getElementById('alldone-score').textContent = scoreText;
  setTimeout(() => speak(speakText, 0.85), 600);
}

// ============================================================
// CUSTOM WORDS
// ============================================================

function addCustomWord(displayText) {
  const display = displayText.trim();
  if (!display) return;
  const lower = display.toLowerCase();
  const dupe  = Object.values(stored.items).find(i => i.kind === 'word' && i.display.toLowerCase() === lower);
  if (dupe) { speak('That word is already in the list.', 1.0); return; }

  const id = 'custom:word:' + lower.replace(/[^a-z0-9]/g, '_');
  stored.items[id] = {
    id, kind: 'word', display,
    accepted: [lower],
    successStreak: 0, silentCorrect: 0,
    totalCorrect: 0, totalAttempts: 0, mastered: false,
    lastSeenRound: null, lastResult: null,
  };
  saveStored();
  renderCustomItems();
}

function addCustomNumber(numStr) {
  const num = parseInt(numStr, 10);
  if (isNaN(num) || num < 1 || num > 999) { speak('Please enter a number between 1 and 999.', 1.0); return; }
  const dupe = Object.values(stored.items).find(i => i.kind === 'number' && i.display === String(num));
  if (dupe) { speak('That number is already in the list.', 1.0); return; }

  const id = 'custom:num:' + num;
  const spoken = numberToWords(num);
  stored.items[id] = {
    id, kind: 'number', display: String(num),
    accepted: [spoken],
    successStreak: 0, silentCorrect: 0,
    totalCorrect: 0, totalAttempts: 0, mastered: false,
    lastSeenRound: null, lastResult: null,
  };
  saveStored();
  renderCustomItems();
}

function removeCustomItem(id) {
  if (!id.startsWith('custom:')) return;
  delete stored.items[id];
  saveStored();
  renderCustomItems();
}

function renderCustomItems() {
  const wordsList = document.getElementById('s-custom-words-list');
  const numsList  = document.getElementById('s-custom-nums-list');
  if (!wordsList || !numsList) return;

  const customWords = Object.values(stored.items).filter(i => i.kind === 'word' && i.id.startsWith('custom:'));
  const customNums  = Object.values(stored.items).filter(i => i.kind === 'number' && i.id.startsWith('custom:'));

  wordsList.innerHTML = '';
  numsList.innerHTML  = '';

  for (const item of customWords) {
    wordsList.appendChild(makeChip(item));
  }
  for (const item of customNums) {
    numsList.appendChild(makeChip(item));
  }
}

function makeChip(item) {
  const chip = document.createElement('span');
  chip.className = 'custom-chip';
  chip.textContent = item.display + ' ';
  const preview = document.createElement('button');
  preview.className   = 'custom-chip-preview';
  preview.textContent = '🔊';
  preview.setAttribute('aria-label', 'Hear ' + item.display);
  preview.addEventListener('click', () => speakWord(item.display));
  chip.appendChild(preview);
  const del = document.createElement('button');
  del.className   = 'custom-chip-del';
  del.textContent = '×';
  del.setAttribute('aria-label', 'Remove ' + item.display);
  del.addEventListener('click', () => removeCustomItem(item.id));
  chip.appendChild(del);
  return chip;
}

// ============================================================
// GROWN-UP SETTINGS
// ============================================================

function openGrownUp() {
  renderSettings();
  renderProgress();
  renderCustomItems();
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
  document.getElementById('s-round-size').value         = s.roundSize;
  document.getElementById('s-retry-cap').value          = s.retryCap;
  document.getElementById('s-grownup-decides').checked  = s.grownUpDecides;
  document.getElementById('s-speech-rate').value        = s.speechRate;
  document.getElementById('s-rate-value').textContent   = s.speechRate + '×';
}

function saveSettings() {
  const s = stored.settings;
  s.roundSize          = Math.max(4, parseInt(document.getElementById('s-round-size').value)     || 10);
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

  let counts = { new: 0, learning: 0, unaided: 0, mastered: 0 };
  grid.innerHTML = '';

  for (const item of Object.values(stored.items)) {
    const cell     = document.createElement('div');
    cell.className = 'progress-cell';
    cell.title     = item.display;
    cell.textContent = item.display.length <= 4 ? item.display : item.display.slice(0, 4);

    if (item.mastered) {
      cell.classList.add('mastered'); counts.mastered++;
    } else if (item.totalAttempts === 0) {
      cell.classList.add('new');      counts.new++;
    } else if (item.silentCorrect === 0) {
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
    ⭐ Mastered: ${counts.mastered}
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
  document.getElementById('btn-numbers').addEventListener('click', () => {
    speak('Numbers!', 1.0, () => startRound('numbers'));
  });
  document.getElementById('btn-words').addEventListener('click', () => {
    speak('Words!', 1.0, () => startRound('words'));
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

  document.getElementById('btn-correct').addEventListener('click', () => {
    hideFallback(); handleAnswer(true);
  });
  document.getElementById('btn-retry').addEventListener('click', () => {
    hideFallback();
    setMicState('waiting');
    speakWord(gs.currentItem.display, () => {
      setMicState('ready');
      if (sessionMicBlocked || stored.settings.grownUpDecides) showFallback();
    });
  });

  document.getElementById('tomorrow-text').addEventListener('click', () => {
    showScreen('picker');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    saveSettings();
    showScreen('picker');
  });

  document.getElementById('s-speech-rate').addEventListener('input', (e) => {
    document.getElementById('s-rate-value').textContent = parseFloat(e.target.value).toFixed(1) + '×';
    saveSettings();
  });
  for (const id of ['s-round-size','s-retry-cap']) {
    document.getElementById(id).addEventListener('change', saveSettings);
  }
  document.getElementById('s-grownup-decides').addEventListener('change', saveSettings);
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
    renderCustomItems();
    speak('All progress has been reset. Ready to start fresh!', 0.9);
  });

  // Custom words
  const wordInput = document.getElementById('s-custom-word-input');
  document.getElementById('s-custom-word-add').addEventListener('click', () => {
    addCustomWord(wordInput.value);
    wordInput.value = '';
  });
  wordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addCustomWord(wordInput.value); wordInput.value = ''; }
  });

  const numInput = document.getElementById('s-custom-num-input');
  document.getElementById('s-custom-num-add').addEventListener('click', () => {
    addCustomNumber(numInput.value);
    numInput.value = '';
  });
  numInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { addCustomNumber(numInput.value); numInput.value = ''; }
  });

  setupGate();
}

// ============================================================
// INIT
// ============================================================

async function init() {
  console.log('[ReadingLearner] build v8 — Vosk in-browser recognition. Type rlDump() for trace.');
  loadStored();
  if (!stored) return;
  loadVoices();

  const flash = document.createElement('div');
  flash.id        = 'flash-overlay';
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);

  setupEvents();
  showScreen('loading');

  await initVosk();

  showScreen('picker');
}

document.addEventListener('DOMContentLoaded', init);
