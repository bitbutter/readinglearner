'use strict';

const PAIRS = [
  ['mat', 'mad'], ['cat', 'cut'], ['pen', 'pin'], ['bed', 'bad'],
  ['sit', 'six'], ['hop', 'hot'], ['bus', 'but'], ['was', 'wash'],
];
const ACCEPTED = {
  mat: ['mat', 'matt'], mad: ['mad'], cat: ['cat'], cut: ['cut'], pen: ['pen'], pin: ['pin'],
  bed: ['bed'], bad: ['bad'], sit: ['sit'], six: ['six'], hop: ['hop'], hot: ['hot'],
  bus: ['bus'], but: ['but'], was: ['was'], wash: ['wash'],
  so: ['so', 'sew'], no: ['no', 'know'], go: ['go'], he: ['he'], we: ['we'],
  be: ['be', 'bee'], is: ['is'], it: ['it'], in: ['in'], the: ['the'],
  to: ['to', 'too', 'two'], do: ['do', 'dew', 'due'],
};
const ALL_WORDS = Object.keys(ACCEPTED);
const normText = (text) => text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
const $ = (id) => document.getElementById(id);
let recordingSession = null;
let recordedAttempts = [];
let archiveReady = false;
let operationPending = false;
let microphoneStream = null;
let microphoneAudioContext = null;
let microphoneAnalyser = null;
let meterAnimation = null;
let activeCapture = null;
let pendingAudioSave = null;
let pendingModelSave = null;
let replayUrls = [];

function containsTokenRun(tokens, run) {
  outer: for (let i = 0; i + run.length <= tokens.length; i++) {
    for (let j = 0; j < run.length; j++) if (tokens[i + j] !== run[j]) continue outer;
    return true;
  }
  return false;
}

function matchesWord(transcript, word) {
  const tokens = normText(transcript).split(' ').filter(token => token && token !== 'unk');
  return tokens.length > 0 && ACCEPTED[word].some(spelling => containsTokenRun(tokens, normText(spelling).split(' ')));
}

function scoreTranscript(transcript, prompt) {
  if (matchesWord(transcript, prompt)) return { verdict: 'hit', confusedWith: null };
  const pair = PAIRS.find(words => words.includes(prompt));
  const confusedWith = pair?.find(word => word !== prompt && matchesWord(transcript, word));
  return { verdict: confusedWith ? 'pair-confusion' : 'miss', confusedWith: confusedWith || null };
}

function buildOrder() {
  const words = [...ALL_WORDS];
  for (let i = words.length - 1; i > 0; i--) {
    const otherIndex = Math.floor(Math.random() * (i + 1));
    [words[i], words[otherIndex]] = [words[otherIndex], words[i]];
  }
  return words;
}

function currentAttempt(wordIndex = recordingSession.currentTrialIndex) {
  return recordedAttempts.filter(attempt => attempt.wordIndex === wordIndex)
    .sort((left, right) => right.takeNumber - left.takeNumber)[0] || null;
}

function lastModelRun(attempt) {
  return attempt?.modelRuns?.at(-1) || null;
}

function latestModelRun(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run => run.model === model && run.status === 'complete') || null;
}

function remainingCurrentAttemptsForModel(model) {
  if (!recordingSession) return [];
  return recordingSession.order.map((_, wordIndex) => currentAttempt(wordIndex)).filter(attempt =>
    attempt && !attempt.voided && !attempt.captureError && !latestModelRun(attempt, model));
}

function latestModelError(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run => (run.model === model || run.requestedModel === model) && run.status === 'error') || null;
}

function modelLabel(model) {
  return model === 'chirp_3' ? 'Chirp 3' : model === 'short' ? 'short (V2)' : model;
}

function modelConfigurationVersion(model) {
  return model === 'chirp_3' ? 'recorded-word-en-GB-chirp3-v1' : 'recorded-word-en-GB-short-v1';
}

function showProblem(message) {
  $('problem').textContent = message;
  $('problem').hidden = !message;
}

function refreshControls() {
  const locked = operationPending || !!activeCapture || !!pendingAudioSave || !!pendingModelSave || !archiveReady;
  for (const id of ['prev', 'next', 'redo', 'void', 'finish', 'back2', 'export', 'new-session', 'saved-session', 'recognition-mode', 'gateway-url', 'gateway-token', 'tts']) {
    $(id).disabled = locked;
  }
  $('enable-mic').disabled = locked || !!microphoneStream;
  $('void').disabled = locked || !currentAttempt();
  $('tts').disabled = locked || !window.speechSynthesis || !window.SpeechSynthesisUtterance;
  for (const cell of $('strip').children) cell.disabled = locked;
  // Keep the pressed button enabled until release; disabling it can suppress pointerup.
  $('mic').disabled = operationPending || !!pendingAudioSave || !!pendingModelSave || !archiveReady || !microphoneStream;
  $('transcribe').disabled = locked || !currentAttempt() || !!currentAttempt()?.captureError || $('recognition-mode').value === 'record-only';
  $('transcribe-all').disabled = locked || $('recognition-mode').value === 'record-only' || !remainingCurrentAttemptsForModel($('recognition-mode').value).length;
  $('retry-save').hidden = !pendingAudioSave && !pendingModelSave;
  $('retry-save').disabled = operationPending;
  $('retry-save').textContent = pendingModelSave ? 'Retry saving the model result' : 'Retry saving this recording';
  $('download-unsaved').hidden = !pendingAudioSave;
  $('download-unsaved').disabled = operationPending;
}

async function runOperation(action) {
  if (operationPending) return;
  operationPending = true;
  showProblem('');
  refreshControls();
  try { await action(); }
  catch (error) { showProblem(error.message || String(error)); }
  finally { operationPending = false; refreshControls(); }
}

function releaseReplayUrls() {
  for (const url of replayUrls) URL.revokeObjectURL(url);
  replayUrls = [];
}

function audioPlayer(blob) {
  const player = document.createElement('audio');
  player.controls = true;
  player.preload = 'none';
  player.src = URL.createObjectURL(blob);
  replayUrls.push(player.src);
  return player;
}

function attemptDescription(attempt) {
  if (!attempt) return { text: '', className: '' };
  if (attempt.captureError) return { text: `Recording interrupted: ${attempt.captureError}. Audio saved; not scored.`, className: 'bad' };
  const run = lastModelRun(attempt);
  if (!run) return { text: 'Audio saved — not transcribed yet', className: '' };
  if (run.status === 'error') return { text: `Audio saved. Transcription failed: ${run.error}. Not scored.`, className: 'bad' };
  const score = scoreTranscript(run.transcript, attempt.prompt);
  if (score.verdict === 'hit') return { text: '✓ matches the displayed word', className: 'ok' };
  if (score.verdict === 'pair-confusion') return { text: `⚠ pair confusion — “${score.confusedWith}”`, className: 'conf' };
  return { text: run.transcript ? '✗ does not match the displayed word' : '✗ nothing recognized', className: 'bad' };
}

function renderStrip() {
  $('strip').replaceChildren();
  recordingSession.order.forEach((word, wordIndex) => {
    const attempt = currentAttempt(wordIndex);
    const description = attemptDescription(attempt);
    const cell = document.createElement('button');
    cell.className = 'cell' + (attempt?.voided ? ' voided' : description.className ? ` ${description.className === 'ok' ? 'hit' : description.className === 'conf' ? 'conf' : lastModelRun(attempt)?.status === 'error' || attempt?.captureError ? 'error' : 'miss'}` : attempt ? ' recorded' : '') + (wordIndex === recordingSession.currentTrialIndex ? ' cur' : '');
    cell.textContent = wordIndex + 1;
    cell.title = `${word}: ${attempt ? description.text : 'not recorded'}`;
    cell.disabled = operationPending || !!activeCapture || !!pendingAudioSave || !!pendingModelSave;
    cell.addEventListener('click', () => navigateToWord(wordIndex));
    $('strip').appendChild(cell);
  });
}

function renderTrial() {
  releaseReplayUrls();
  const wordIndex = recordingSession.currentTrialIndex;
  const attempt = currentAttempt();
  const run = lastModelRun(attempt);
  $('prompt').textContent = recordingSession.order[wordIndex];
  const takes = recordedAttempts.filter(recording => recording.wordIndex === wordIndex).length;
  $('counter').textContent = `word ${wordIndex + 1} / ${recordingSession.order.length}` + (takes ? ` — ${takes} saved take${takes === 1 ? '' : 's'}` : '');
  const completedRuns = (attempt?.modelRuns || []).filter(savedRun => savedRun.status === 'complete');
  $('heard').textContent = run?.status === 'complete' ? (run.transcript ? `heard: “${run.transcript}”` : 'heard: (nothing)') : '';
  $('alts').textContent = completedRuns.map(savedRun => {
    const transcript = savedRun.transcript || '(nothing)';
    const verdict = scoreTranscript(savedRun.transcript, attempt.prompt).verdict;
    return `${modelLabel(savedRun.model)}: “${transcript}” — ${verdict} · ${(savedRun.latencyMs / 1000).toFixed(1)}s`;
  }).join(' | ');
  const description = attemptDescription(attempt);
  $('verdict').textContent = description.text + (attempt?.voided ? ' — VOIDED' : '');
  $('verdict').className = 'verdict ' + description.className;
  $('status').textContent = microphoneStream ? 'Hold the button and speak; release to save' : 'Enable the microphone, then hold the button and speak';
  $('replay').replaceChildren();
  if (attempt) $('replay').appendChild(audioPlayer(attempt.audioBlob));
  renderStrip();
  refreshControls();
}

async function refreshSessionChoices() {
  const sessions = await ASRRecordings.listSessions();
  $('saved-session').replaceChildren();
  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = session.id;
    option.textContent = new Date(session.startedAt).toLocaleString();
    $('saved-session').appendChild(option);
  }
  if (recordingSession) $('saved-session').value = recordingSession.id;
}

async function openSession(sessionId) {
  const stored = await ASRRecordings.getSession(sessionId);
  if (!stored || !stored.session || !stored.session.order?.length) throw new Error('The saved recording session is missing or invalid.');
  for (const word of stored.session.order) if (!ACCEPTED[word]) throw new Error(`Unknown saved prompt: ${word}`);
  const index = stored.session.currentTrialIndex;
  if (!Number.isInteger(index) || index < 0 || index >= stored.session.order.length) throw new Error('The saved word position is invalid.');
  recordingSession = stored.session;
  recordedAttempts = stored.attempts;
  $('session').style.display = 'block';
  $('summary').style.display = 'none';
  renderTrial();
}

async function createRecordingSession() {
  const newSession = {
    id: crypto.randomUUID(), schemaVersion: 2, startedAt: new Date().toISOString(),
    device: navigator.userAgent, order: buildOrder(), currentTrialIndex: 0,
  };
  await ASRRecordings.createSession(newSession);
  await openSession(newSession.id);
  await refreshSessionChoices();
}

function navigateToWord(wordIndex) {
  if (activeCapture || pendingAudioSave || pendingModelSave) return;
  return runOperation(async () => {
    if (wordIndex < 0 || wordIndex >= recordingSession.order.length) return;
    const nextSession = { ...recordingSession, currentTrialIndex: wordIndex };
    await ASRRecordings.saveSession(nextSession);
    recordingSession = nextSession;
    renderTrial();
  });
}

async function enableMicrophone() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    throw new Error('Audio recording needs HTTPS and a browser with microphone recording support.');
  }
  $('status').textContent = 'Allow microphone access in your browser';
  $('miclabel').textContent = 'Waiting for microphone permission…';
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  try {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('No microphone audio track was supplied.');
    // The same stream supplies the meter and the saved recording.
    const context = new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    microphoneStream = stream;
    microphoneAudioContext = context;
    microphoneAnalyser = analyser;
    $('miclabel').textContent = '🎙 ' + (track.label || 'default microphone');
    track.addEventListener('ended', () => {
      if (activeCapture) { activeCapture.captureError = 'microphone disconnected'; endHold(); }
      microphoneStream = null;
      cancelAnimationFrame(meterAnimation);
      context.close().catch(error => showProblem(`Closing the disconnected microphone failed: ${error.message}`));
      $('miclabel').textContent = 'Microphone disconnected';
      refreshControls();
    });
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128));
      const level = Math.min(1, peak / 50);
      $('meterbar').style.width = `${Math.round(level * 100)}%`;
      $('meterbar').classList.toggle('hot', level > .55);
      meterAnimation = requestAnimationFrame(tick);
    };
    tick();
    if (navigator.storage?.persist) {
      const persistent = await navigator.storage.persist();
      $('archive-status').textContent = persistent ? 'Recordings saved on this device. Download a ZIP to keep a portable copy.' : 'Recordings saved locally. Download a ZIP to keep them outside this browser.';
    }
    renderTrial();
  } catch (error) {
    if (microphoneStream !== stream) stream.getTracks().forEach(track => track.stop());
    throw error;
  }
}

function readTranscriptionSettings() {
  const model = $('recognition-mode').value;
  if (model === 'record-only') return null;
  if (!['chirp_3', 'short'].includes(model)) throw new Error('Unknown transcription model.');
  if (!$('gateway-url').value.trim() || !$('gateway-token').value.trim()) throw new Error('Enter the transcription address and access code, or choose “Save audio only”.');
  const serverUrl = new URL($('gateway-url').value.trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(serverUrl.hostname);
  if (serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash || (serverUrl.protocol !== 'https:' && !(loopback && serverUrl.protocol === 'http:' && location.protocol === 'http:'))) {
    throw new Error('Use an HTTPS speech server address. A local HTTP server can be used from a local HTTP evaluator.');
  }
  if (serverUrl.pathname !== '/transcribe') throw new Error('The transcription address must end with /transcribe.');
  return { model, endpoint: serverUrl.href, token: $('gateway-token').value.trim() };
}

function beginHold(event) {
  if (event) event.preventDefault();
  if (operationPending || activeCapture || pendingAudioSave || pendingModelSave || !microphoneStream || !archiveReady) return;
  try {
    const transcriptionSettings = readTranscriptionSettings();
    window.speechSynthesis?.cancel();
    const recordingMimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4']
      .find(mimeType => MediaRecorder.isTypeSupported(mimeType));
    if (!recordingMimeType) throw new Error('This browser cannot record a supported audio file format.');
    const recorder = new MediaRecorder(microphoneStream, { mimeType: recordingMimeType });
    const wordIndex = recordingSession.currentTrialIndex;
    const capture = {
      sessionId: recordingSession.id, recorder, chunks: [], transcriptionSettings,
      startedAtMs: Date.now(), holding: true, captureError: null,
      attempt: { id: crypto.randomUUID(), prompt: recordingSession.order[wordIndex], wordIndex,
        takeNumber: recordedAttempts.length + 1, startedAt: new Date().toISOString(),
        micLabel: microphoneStream.getAudioTracks()[0].label || 'default microphone',
        microphoneSettings: microphoneStream.getAudioTracks()[0].getSettings(), voided: false, modelRuns: [] },
    };
    capture.stopped = new Promise(resolve => {
      recorder.ondataavailable = audioEvent => { if (audioEvent.data.size) capture.chunks.push(audioEvent.data); };
      recorder.onstop = () => {
        // dataavailable carries the actual encoded type; recorder.mimeType may reset at stop.
        resolve(new Blob(capture.chunks, { type: capture.chunks[0]?.type || '' }));
        if (capture.holding) endHold();
      };
      recorder.onerror = audioEvent => {
        capture.captureError = audioEvent.error?.message || 'audio capture failed';
        if (capture.holding) endHold();
      };
    });
    if (event?.pointerId != null) $('mic').setPointerCapture(event.pointerId);
    activeCapture = capture;
    recorder.start();
    capture.limitTimer = setTimeout(() => endHold(), 59000); // Recognize accepts clips shorter than one minute.
    showProblem('');
    $('mic').className = 'mic listening';
    $('status').textContent = 'Recording — speak now, then release';
    $('verdict').textContent = '';
    refreshControls();
  } catch (error) {
    activeCapture = null;
    showProblem(error.message || String(error));
    refreshControls();
  }
}

async function audioDigest(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function endHold() {
  const capture = activeCapture;
  if (!capture?.holding) return;
  capture.holding = false;
  capture.attempt.durationMs = Date.now() - capture.startedAtMs;
  clearTimeout(capture.limitTimer);
  return runOperation(async () => {
    $('mic').className = 'mic waiting';
    $('status').textContent = 'Saving the original audio…';
    if (capture.recorder.state !== 'inactive') capture.recorder.stop();
    const blob = await capture.stopped;
    activeCapture = null;
    $('mic').className = 'mic';
    if (!blob.size) throw new Error('The microphone produced no audio file. This attempt was not saved or scored.');
    if (capture.captureError) capture.attempt.captureError = capture.captureError;
    pendingAudioSave = { sessionId: capture.sessionId, attempt: capture.attempt, blob, transcriptionSettings: capture.transcriptionSettings };
    await savePendingAudio();
  });
}

async function savePendingAudio() {
  const capture = pendingAudioSave;
  if (!capture) return;
  try {
    capture.attempt.audioSha256 = await audioDigest(capture.blob);
    const savedAttempt = await ASRRecordings.saveAttempt(capture.sessionId, capture.attempt, capture.blob);
    const attempt = { ...savedAttempt, audioBlob: capture.blob };
    recordedAttempts.push(attempt);
    pendingAudioSave = null;
    const stored = await ASRRecordings.getSession(capture.sessionId);
    recordedAttempts = stored.attempts;
    renderTrial();
    if (capture.transcriptionSettings && !capture.attempt.captureError) await transcribeAttempt(attempt, capture.transcriptionSettings);
  } catch (error) {
    if (pendingAudioSave) throw new Error(`Audio captured, but saving failed: ${error.message}. Keep this tab open and retry saving, or download the unsaved audio.`);
    throw error;
  }
}

async function blobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => reject(new Error('The saved audio could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function transcribeAttempt(attempt, settings) {
  $('status').textContent = 'Audio saved — asking Google to transcribe it…';
  const run = { id: crypto.randomUUID(), startedAt: new Date().toISOString(), requestedModel: settings.model, status: 'error' };
  const startedAtMs = Date.now();
  try {
    const response = await fetch(settings.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
      body: JSON.stringify({ model: settings.model, mimeType: attempt.audioMimeType, durationMs: attempt.durationMs, audioBase64: await blobBase64(attempt.audioBlob) }),
      signal: AbortSignal.timeout(45000),
    });
    const transcription = await response.json();
    if (!response.ok) {
      run.serverError = transcription.error;
      throw new Error(transcription.error?.message || transcription.error || `Speech server returned HTTP ${response.status}`);
    }
    if (typeof transcription.transcript !== 'string' || transcription.provider !== 'google-cloud-stt' || transcription.model !== settings.model || transcription.languageCode !== 'en-GB' || transcription.configurationVersion !== modelConfigurationVersion(settings.model) || transcription.audioSha256 !== attempt.audioSha256) {
      throw new Error('The speech server response does not match this recording and model.');
    }
    Object.assign(run, transcription, { status: 'complete', scoringVersion: 'prompt-homophones-v2', ...scoreTranscript(transcription.transcript, attempt.prompt) });
  } catch (error) {
    run.error = error.message || String(error);
    run.latencyMs = Date.now() - startedAtMs;
  }
  pendingModelSave = { attemptId: attempt.id, run };
  await savePendingModelRun();
  return run;
}

async function transcribeRemainingCurrentTakes(settings) {
  const attempts = remainingCurrentAttemptsForModel(settings.model);
  const label = modelLabel(settings.model);
  if (!attempts.length) {
    $('batch-status').textContent = `No current saved takes need ${label}.`;
    return;
  }
  $('batch-status').textContent = `Starting ${label} for ${attempts.length} current saved takes, one at a time.`;
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (!attempt.audioBlob || !attempt.audioSha256 || !attempt.audioMimeType || !Number.isFinite(attempt.durationMs)) {
      throw new Error(`Saved audio for “${attempt.prompt}” is incomplete; no request was sent for that take.`);
    }
    $('batch-status').textContent = `Transcribing with ${label}: ${index + 1}/${attempts.length} — “${attempt.prompt}”.`;
    let run;
    try { run = await transcribeAttempt(attempt, settings); }
    catch (error) {
      $('batch-status').textContent = `Batch stopped at “${attempt.prompt}”: ${error.message}. Earlier saved results are kept.`;
      throw error;
    }
    if (run.status === 'error') {
      $('batch-status').textContent = `Batch stopped at “${attempt.prompt}” after ${index + 1}/${attempts.length}. This request failed and was saved as an error; earlier results are kept. Correct the problem, then run the batch again.`;
      return;
    }
  }
  $('batch-status').textContent = `${label} finished: ${attempts.length}/${attempts.length} remaining takes transcribed and saved.`;
}

async function savePendingModelRun() {
  const pending = pendingModelSave;
  if (!pending) return;
  const attempt = recordedAttempts.find(recording => recording.id === pending.attemptId);
  if (!attempt) throw new Error('The saved recording for this model result is missing.');
  try {
    const saved = await ASRRecordings.appendModelRun(recordingSession.id, attempt.id, pending.run);
    Object.assign(attempt, saved);
    pendingModelSave = null;
    renderTrial();
    if ($('summary').style.display === 'block') renderSummary();
  } catch (error) {
    throw new Error(`The audio is saved, but the model result could not be saved: ${error.message}. Keep this tab open and retry saving the result.`);
  }
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function renderSummary() {
  releaseReplayUrls();
  const selected = recordingSession.order.map((word, index) => currentAttempt(index)).filter(Boolean);
  const scoreModel = model => {
    const rows = selected.flatMap(attempt => {
      const modelRun = latestModelRun(attempt, model);
      return !attempt.voided && !attempt.captureError && modelRun ? [{ attempt, modelRun }] : [];
    });
    const hits = rows.filter(({ attempt, modelRun }) => scoreTranscript(modelRun.transcript, attempt.prompt).verdict === 'hit').length;
    const errors = selected.filter(attempt => !attempt.voided && latestModelError(attempt, model)).length;
    return `${modelLabel(model)}: ${hits}/${rows.length} matches${rows.length ? ` (${Math.round(hits / rows.length * 100)}%)` : ''}, ${errors} errors`;
  };
  const models = [...new Set(recordedAttempts.flatMap(attempt => (attempt.modelRuns || []).map(run => run.model || run.requestedModel).filter(Boolean)))];
  const captureErrors = selected.filter(attempt => !attempt.voided && attempt.captureError).length;
  $('stats').textContent = `${recordedAttempts.length} audio files saved · ${selected.length}/${recordingSession.order.length} words recorded · ${models.map(scoreModel).join(' · ') || 'No model results yet'} · ${captureErrors} recording errors · ${selected.filter(attempt => attempt.voided).length} voided`;
  $('pairmatrix').textContent = 'Each model is scored against the same latest saved take for each word. Every transcript and original audio file remains in the ZIP.';
  const table = document.createElement('table');
  const header = document.createElement('tr');
  for (const label of ['Prompt', 'Chirp 3 transcript / outcome', 'short (V2) transcript / outcome', 'Audio']) {
    const cell = document.createElement('th'); cell.textContent = label; header.appendChild(cell);
  }
  table.appendChild(header);
  for (const attempt of selected) {
    const row = document.createElement('tr');
    const chirpRun = latestModelRun(attempt, 'chirp_3');
    const shortRun = latestModelRun(attempt, 'short');
    const formatRun = (model, modelRun) => modelRun
      ? `${modelRun.transcript || '(nothing)'} — ${scoreTranscript(modelRun.transcript, attempt.prompt).verdict}`
      : latestModelError(attempt, model)?.error ? `request error — ${latestModelError(attempt, model).error}` : '—';
    for (const text of [attempt.prompt, formatRun('chirp_3', chirpRun), formatRun('short', shortRun)]) {
      const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
    }
    if (attempt.voided) row.children[0].textContent += ' — VOIDED';
    const audioCell = document.createElement('td');
    audioCell.appendChild(audioPlayer(attempt.audioBlob));
    row.appendChild(audioCell);
    table.appendChild(row);
  }
  $('trials').replaceChildren(table);
}

$('enable-mic').addEventListener('click', () => runOperation(enableMicrophone));
$('mic').addEventListener('pointerdown', beginHold);
$('mic').addEventListener('pointerup', endHold);
$('mic').addEventListener('pointercancel', endHold);
window.addEventListener('pointerup', endHold);
window.addEventListener('pointercancel', endHold);
window.addEventListener('blur', endHold);
document.addEventListener('visibilitychange', () => { if (document.hidden) endHold(); });
window.addEventListener('beforeunload', event => {
  if (activeCapture || operationPending || pendingAudioSave || pendingModelSave) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('keydown', event => {
  if ((['INPUT', 'SELECT', 'BUTTON', 'AUDIO'].includes(event.target.tagName) && event.target !== $('mic')) || $('summary').style.display === 'block') return;
  if (event.code === 'Space' && !event.repeat) beginHold(event);
  if (event.code === 'ArrowLeft') navigateToWord(recordingSession.currentTrialIndex - 1);
  if (event.code === 'ArrowRight') navigateToWord(recordingSession.currentTrialIndex + 1);
});
window.addEventListener('keyup', event => { if (event.code === 'Space') endHold(); });
$('prev').addEventListener('click', () => navigateToWord(recordingSession.currentTrialIndex - 1));
$('next').addEventListener('click', () => navigateToWord(recordingSession.currentTrialIndex + 1));
$('redo').addEventListener('click', () => {
  showProblem('');
  $('status').textContent = 'Hold to record a new take. The earlier take will remain saved.';
});
$('void').addEventListener('click', () => runOperation(async () => {
  const attempt = currentAttempt();
  if (!attempt) return;
  const saved = await ASRRecordings.updateAttempt(recordingSession.id, { ...attempt, voided: !attempt.voided });
  Object.assign(attempt, saved);
  renderTrial();
}));
$('tts').addEventListener('click', () => {
  const utterance = new SpeechSynthesisUtterance(recordingSession.order[recordingSession.currentTrialIndex]);
  utterance.lang = 'en-GB'; utterance.rate = .85;
  speechSynthesis.cancel(); speechSynthesis.speak(utterance);
});
$('recognition-mode').addEventListener('change', () => { $('api-settings').hidden = $('recognition-mode').value === 'record-only'; refreshControls(); });
$('transcribe').addEventListener('click', () => runOperation(() => transcribeAttempt(currentAttempt(), readTranscriptionSettings())));
$('transcribe-all').addEventListener('click', () => runOperation(() => transcribeRemainingCurrentTakes(readTranscriptionSettings())));
$('retry-save').addEventListener('click', () => runOperation(() => pendingAudioSave ? savePendingAudio() : savePendingModelRun()));
$('download-unsaved').addEventListener('click', () => {
  const capture = pendingAudioSave;
  if (capture) download(capture.blob, `${capture.attempt.id}-${capture.attempt.prompt}.${ASRRecordings.audioExtension(capture.blob.type)}`);
});
$('saved-session').addEventListener('change', () => runOperation(() => openSession($('saved-session').value)));
$('new-session').addEventListener('click', () => runOperation(createRecordingSession));
$('finish').addEventListener('click', () => { $('session').style.display = 'none'; $('summary').style.display = 'block'; renderSummary(); });
$('back2').addEventListener('click', () => { $('summary').style.display = 'none'; $('session').style.display = 'block'; renderTrial(); });
$('export').addEventListener('click', () => runOperation(async () => {
  $('archive-status').textContent = 'Preparing original audio files and manifest…';
  const archive = await ASRRecordings.exportSession(recordingSession.id);
  download(archive.blob, archive.filename);
  $('archive-status').textContent = `ZIP ready: ${recordedAttempts.length} original audio files and their manifest.`;
}));
$('export-legacy').addEventListener('click', () => {
  const text = localStorage.getItem('asrEval.v1');
  if (text) download(new Blob([text], { type: 'application/json' }), 'earlier-asr-text-only.json');
});

async function initialize() {
  await ASRRecordings.open();
  const sessions = await ASRRecordings.listSessions();
  if (sessions.length) await openSession(sessions[0].id);
  else await createRecordingSession();
  await refreshSessionChoices();
  $('legacy-session').hidden = !localStorage.getItem('asrEval.v1');
  archiveReady = true;
  $('archive-status').textContent = 'Every take is saved locally with its original audio. Download a ZIP when finished.';
}

runOperation(initialize);
