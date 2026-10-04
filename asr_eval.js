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
const MODEL_LABELS = Object.freeze({ chirp_3: 'Chirp 3 (V2)', short: 'short (V2)', latest_short: 'latest_short (V1)' });
const MODEL_CONFIGURATION_VERSIONS = Object.freeze({
  chirp_3: 'recorded-word-en-GB-chirp3-leading-silence-preroll-300ms-v2',
  short: 'recorded-word-en-GB-short-leading-silence-preroll-300ms-v2',
  latest_short: 'recorded-word-en-GB-v1-latest-short-leading-silence-preroll-300ms-v3',
});
const SPEECH_AUDIO_PREPROCESSING_VERSION = 'leading-silence-preroll-300ms-mono16k-v1';
const SPEECH_GATEWAY_RATE_LIMIT_RETRY_DELAY_MS = 61_000;
const MINIMUM_SPEECH_BATCH_REQUEST_GAP_MS = 3200;
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
let approvedReferences = [];
let referenceLibraryLoaded = false;
let pendingReferenceMatchSave = null;

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

function currentAttempt(wordIndex) {
  if (!recordingSession) return null;
  if (wordIndex === undefined) wordIndex = recordingSession.currentTrialIndex;
  return recordedAttempts.filter(attempt => attempt.wordIndex === wordIndex)
    .sort((left, right) => right.takeNumber - left.takeNumber)[0] || null;
}

function lastModelRun(attempt) {
  return attempt?.modelRuns?.at(-1) || null;
}

function lastReferenceMatchRun(attempt) {
  return attempt?.referenceMatchRuns?.at(-1) || null;
}

function referencesForWord(word) {
  return approvedReferences.filter(reference => reference.word === word);
}

function attemptIsApprovedReference(attempt) {
  return !!attempt && approvedReferences.some(reference => reference.attemptId === attempt.id);
}

function isCurrentModelRun(run, model) {
  return run.model === model && run.configurationVersion === modelConfigurationVersion(model) &&
    run.preprocessing?.version === SPEECH_AUDIO_PREPROCESSING_VERSION;
}

function latestHistoricalModelRun(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run => run.model === model && run.status === 'complete') || null;
}

function latestHistoricalModelError(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run =>
    (run.model === model || run.requestedModel === model) && run.status === 'error') || null;
}

function latestPreviousModelRun(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run =>
    run.model === model && run.status === 'complete' && !isCurrentModelRun(run, model)) || null;
}

function latestModelRun(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run => run.status === 'complete' && isCurrentModelRun(run, model)) || null;
}

function remainingCurrentAttemptsForModel(model) {
  if (!recordingSession) return [];
  return recordingSession.order.map((_, wordIndex) => currentAttempt(wordIndex)).filter(attempt =>
    attempt && !attempt.voided && !attempt.captureError && !latestModelRun(attempt, model));
}

function latestModelError(attempt, model) {
  return [...(attempt?.modelRuns || [])].reverse().find(run =>
    (run.model === model || run.requestedModel === model) && run.status === 'error' &&
    run.configurationVersion === modelConfigurationVersion(model)) || null;
}

function latestSpeechRateLimitErrorStartedAt() {
  let latestStartedAt = Number.NEGATIVE_INFINITY;
  for (const attempt of recordedAttempts) {
    for (const run of attempt.modelRuns || []) {
      if (run.status !== 'error' || run.serverError?.code !== 'transcription_rate_limit') continue;
      const startedAt = Date.parse(run.speechGatewayRequestSentAt || run.startedAt);
      if (Number.isFinite(startedAt)) latestStartedAt = Math.max(latestStartedAt, startedAt);
    }
  }
  return Number.isFinite(latestStartedAt) ? latestStartedAt : null;
}

function modelRunErrorText(run) {
  const serverError = run?.serverError;
  const googleError = serverError?.providerResponse?.error;
  const details = [
    run?.error,
    serverError?.code,
    Number.isInteger(serverError?.providerStatus) ? `Google HTTP ${serverError.providerStatus}` : null,
    typeof googleError?.status === 'string' ? googleError.status : null,
    typeof googleError?.message === 'string' ? googleError.message : null,
  ];
  return [...new Set(details.filter(detail => typeof detail === 'string' && detail.trim()))].join(' — ');
}

function modelLabel(model) {
  return MODEL_LABELS[model] || model;
}

function modelConfigurationVersion(model) {
  if (!Object.hasOwn(MODEL_CONFIGURATION_VERSIONS, model)) throw new Error('Unknown transcription model.');
  return MODEL_CONFIGURATION_VERSIONS[model];
}

function showProblem(message) {
  $('problem').textContent = message;
  $('problem').hidden = !message;
}

function refreshControls() {
  const locked = operationPending || !!activeCapture || !!pendingAudioSave || !!pendingModelSave || !!pendingReferenceMatchSave || !archiveReady;
  for (const id of ['prev', 'next', 'redo', 'void', 'finish', 'back2', 'export', 'new-session', 'saved-session', 'recognition-mode', 'gateway-url', 'gateway-token', 'connect-references', 'tts']) {
    $(id).disabled = locked;
  }
  $('enable-mic').disabled = locked || !!microphoneStream;
  $('void').disabled = locked || !currentAttempt();
  $('tts').disabled = locked || !window.speechSynthesis || !window.SpeechSynthesisUtterance;
  for (const cell of $('strip').children) cell.disabled = locked;
  // Keep the pressed button enabled until release; disabling it can suppress pointerup.
  $('mic').disabled = operationPending || !!pendingAudioSave || !!pendingModelSave || !!pendingReferenceMatchSave || !archiveReady || !microphoneStream;
  $('transcribe').disabled = locked || !currentAttempt() || !!currentAttempt()?.captureError || $('recognition-mode').value === 'record-only';
  $('transcribe-all').disabled = locked || $('recognition-mode').value === 'record-only' || !remainingCurrentAttemptsForModel($('recognition-mode').value).length;
  const attempt = currentAttempt();
  $('approve-reference').disabled = locked || !referenceLibraryLoaded || !attempt || !!attempt.captureError || !!attempt.voided || attempt.durationMs > 10_000 || attemptIsApprovedReference(attempt);
  $('compare-reference').disabled = locked || !referenceLibraryLoaded || !attempt || !!attempt.captureError || !!attempt.voided || attempt.durationMs > 10_000 || attemptIsApprovedReference(attempt) || !referencesForWord(attempt.prompt).length;
  $('retry-save').hidden = !pendingAudioSave && !pendingModelSave && !pendingReferenceMatchSave;
  $('retry-save').disabled = operationPending;
  $('retry-save').textContent = pendingModelSave ? 'Retry saving the model result' : pendingReferenceMatchSave ? 'Retry saving the comparison' : 'Retry saving this recording';
  $('download-unsaved').hidden = !pendingAudioSave;
  $('download-unsaved').disabled = operationPending;
  $('void').textContent = attempt?.voided ? 'Restore this take' : 'Exclude this take';
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
  const runModel = run.model || run.requestedModel;
  if (run.status === 'error') {
    if (run.configurationVersion !== modelConfigurationVersion(runModel)) {
      return { text: `Previous ${modelLabel(runModel)} request error: ${modelRunErrorText(run)}. Not included in current scores.`, className: '' };
    }
    return { text: `Audio saved. Transcription failed: ${modelRunErrorText(run)}. Not scored.`, className: 'bad' };
  }
  if (!isCurrentModelRun(run, runModel)) {
    return { text: `Previous ${modelLabel(runModel)} result “${run.transcript || '(no transcript)'}”. Not included in current scores; rerun to test trimmed audio.`, className: '' };
  }
  const score = scoreTranscript(run.transcript, attempt.prompt);
  if (score.verdict === 'hit') return { text: '✓ matches the displayed word', className: 'ok' };
  if (score.verdict === 'pair-confusion') return { text: `⚠ pair confusion — “${score.confusedWith}”`, className: 'conf' };
  return { text: run.transcript ? '✗ does not match the displayed word' : '✗ Google returned no transcript; audio is saved', className: 'bad' };
}

function renderStrip() {
  $('strip').replaceChildren();
  recordingSession.order.forEach((word, wordIndex) => {
    const attempt = currentAttempt(wordIndex);
    const description = attemptDescription(attempt);
    const cell = document.createElement('button');
    cell.className = 'cell' + (attempt?.voided ? ' voided' : description.className ? ` ${description.className === 'ok' ? 'hit' : description.className === 'conf' ? 'conf' : lastModelRun(attempt)?.status === 'error' || attempt?.captureError ? 'error' : 'miss'}` : attempt ? ' recorded' : '') + (wordIndex === recordingSession.currentTrialIndex ? ' cur' : '');
    cell.textContent = word;
    const latestRun = lastModelRun(attempt);
    const latestRunModel = latestRun?.model || latestRun?.requestedModel;
    cell.title = `${word}: ${attempt ? `${latestRunModel ? `${modelLabel(latestRunModel)} — ` : ''}${description.text}` : 'not recorded'}`;
    cell.setAttribute('aria-label', `${word}, ${description.text || (attempt ? 'recorded, not checked by Google' : 'not recorded')}${wordIndex === recordingSession.currentTrialIndex ? ', current word' : ''}`);
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
  $('heard').textContent = run?.status === 'complete' ? (run.transcript ? `heard: “${run.transcript}”` : 'heard: (Google returned no transcript)') : '';
  $('alts').textContent = completedRuns.map(savedRun => {
    const transcript = savedRun.transcript || '(nothing)';
    const verdict = scoreTranscript(savedRun.transcript, attempt.prompt).verdict;
    return `${modelLabel(savedRun.model)}: “${transcript}” — ${verdict} · ${(savedRun.latencyMs / 1000).toFixed(1)}s`;
  }).join(' | ');
  const description = attemptDescription(attempt);
  $('verdict').textContent = (description.text ? `Google: ${description.text}` : '') + (attempt?.voided ? ' — excluded' : '');
  $('verdict').className = 'verdict ' + description.className;
  $('verdict').setAttribute('aria-label', `Google transcript check: ${description.text || 'not checked'}`);
  $('status').textContent = microphoneStream ? 'Hold to say the word; release to save' : 'Enable the microphone, then hold the button and say the word';
  $('replay').replaceChildren();
  if (attempt) $('replay').appendChild(audioPlayer(attempt.audioBlob));
  renderReferenceMatchResult(attempt);
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
    if (navigator.storage?.persist) await navigator.storage.persist();
    renderTrial();
  } catch (error) {
    if (microphoneStream !== stream) stream.getTracks().forEach(track => track.stop());
    throw error;
  }
}

function readGatewayConnection() {
  if (!$('gateway-url').value.trim() || !$('gateway-token').value.trim()) throw new Error('Enter the speech server address and access code first.');
  const serverUrl = new URL($('gateway-url').value.trim());
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(serverUrl.hostname);
  if (serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash || (serverUrl.protocol !== 'https:' && !(loopback && serverUrl.protocol === 'http:' && location.protocol === 'http:'))) {
    throw new Error('Use an HTTPS speech server address. A local HTTP server can be used from a local HTTP evaluator.');
  }
  if (serverUrl.pathname !== '/transcribe') throw new Error('The server address must end with /transcribe.');
  const token = $('gateway-token').value.trim();
  return {
    token,
    endpointFor(path) {
      const endpoint = new URL(serverUrl.href);
      endpoint.pathname = path;
      return endpoint.href;
    },
  };
}

async function requestSpeechServer(path, method, body) {
  const connection = readGatewayConnection();
  const headers = { Authorization: `Bearer ${connection.token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(connection.endpointFor(path), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(45000),
    });
  } catch (error) {
    throw new Error(`Could not reach the speech server: ${error.message || String(error)}`);
  }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`The speech server returned an unreadable response (HTTP ${response.status}).`); }
  if (!response.ok) throw new Error(result.error?.message || `Speech server returned HTTP ${response.status}.`);
  return result;
}

function renderReferenceLibrary() {
  const groups = new Map();
  for (const reference of approvedReferences) groups.set(reference.word, (groups.get(reference.word) || 0) + 1);
  $('reference-list').replaceChildren();
  $('reference-manage-list').replaceChildren();
  for (const [word, count] of groups) {
    const chip = document.createElement('span');
    chip.className = 'reference-chip';
    chip.textContent = `${word} · ${count} example${count === 1 ? '' : 's'}`;
    $('reference-list').appendChild(chip);
  }
  for (const reference of approvedReferences) {
    const row = document.createElement('span');
    row.className = 'reference-chip';
    const label = document.createElement('span');
    label.textContent = `${reference.word} example`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'small';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => runOperation(() => removeApprovedReference(reference)));
    row.appendChild(label);
    row.appendChild(remove);
    $('reference-manage-list').appendChild(row);
  }
  $('manage-references').hidden = approvedReferences.length === 0;
  const wordsWithReferences = groups.size;
  $('reference-status').textContent = approvedReferences.length
    ? `${approvedReferences.length} approved recording${approvedReferences.length === 1 ? '' : 's'} for ${wordsWithReferences} word${wordsWithReferences === 1 ? '' : 's'}.`
    : 'No approved examples yet. Record a clear word, listen, then approve it here.';
}

async function removeApprovedReference(reference) {
  if (!window.confirm(`Remove this approved “${reference.word}” recording from the private reference library? Existing comparison results stay in this browser.`)) return;
  await requestSpeechServer(`/references/${encodeURIComponent(reference.referenceId)}`, 'DELETE');
  await loadReferenceLibrary();
}

async function loadReferenceLibrary() {
  $('reference-status').textContent = 'Loading approved word references…';
  const result = await requestSpeechServer('/references', 'GET');
  if (!Array.isArray(result.references) || result.references.some(reference =>
    !reference || typeof reference.referenceId !== 'string' || typeof reference.attemptId !== 'string' || typeof reference.word !== 'string')) {
    throw new Error('The speech server returned an invalid reference list.');
  }
  approvedReferences = result.references;
  referenceLibraryLoaded = true;
  renderReferenceLibrary();
  renderTrial();
  refreshControls();
}

async function approveCurrentTakeAsReference() {
  const attempt = currentAttempt();
  if (!attempt || attempt.captureError || attempt.voided) throw new Error('Record a usable take before approving it as a reference.');
  if (attemptIsApprovedReference(attempt)) throw new Error('This take is already an approved reference.');
  const approved = window.confirm(`Have you listened to this “${attempt.prompt}” take and confirmed it is a clear example? Approving it uploads the audio to your private reference library.`);
  if (!approved) return;
  $('reference-status').textContent = `Uploading the approved “${attempt.prompt}” example…`;
  const result = await requestSpeechServer('/references', 'POST', {
    attemptId: attempt.id, word: attempt.prompt, mimeType: attempt.audioMimeType,
    durationMs: attempt.durationMs, audioBase64: await blobBase64(attempt.audioBlob),
  });
  if (!result.reference || result.reference.attemptId !== attempt.id || result.reference.word !== attempt.prompt) {
    throw new Error('The speech server approval response did not match this take.');
  }
  await loadReferenceLibrary();
  $('reference-status').textContent = `“${attempt.prompt}” is now in the private reference library.`;
}

function validateReferenceComparison(result, attempt) {
  if (result.scoringStatus !== 'experimental-uncalibrated' || result.matcherVersion !== 'mono16k-mfcc12-delta-constrained-dtw-v1' ||
      result.attemptId !== attempt.id || result.targetWord !== attempt.prompt || !Array.isArray(result.rankedWords) ||
      !result.rankedWords.length || result.rankedWords.some(row => !row || typeof row.word !== 'string' ||
        !Number.isInteger(row.referenceCount) || row.referenceCount < 1 || !Number.isFinite(row.averageDistance) ||
        !Number.isFinite(row.minimumDistance)) || !Number.isInteger(result.targetRank) ||
      result.targetRank < 1 || result.targetRank > result.rankedWords.length ||
      result.rankedWords[result.targetRank - 1].word !== attempt.prompt ||
      result.closestWord !== result.rankedWords[0].word || !Number.isInteger(result.referenceCountForTarget) || result.referenceCountForTarget < 1 ||
      result.audioSha256 !== attempt.audioSha256) {
    throw new Error('The speech server returned a comparison that does not match this take and reference list.');
  }
}

async function compareCurrentTakeWithReferences() {
  const attempt = currentAttempt();
  if (!attempt || attempt.captureError || attempt.voided) throw new Error('Record a usable take before comparing it.');
  if (attemptIsApprovedReference(attempt)) throw new Error('Choose a different take; a reference cannot be compared with itself.');
  if (!referencesForWord(attempt.prompt).length) throw new Error(`There are no approved “${attempt.prompt}” examples yet.`);
  $('reference-results').textContent = `Comparing this “${attempt.prompt}” take…`;
  const result = await requestSpeechServer('/compare', 'POST', {
    attemptId: attempt.id, expectedWord: attempt.prompt, mimeType: attempt.audioMimeType,
    durationMs: attempt.durationMs, audioBase64: await blobBase64(attempt.audioBlob),
  });
  validateReferenceComparison(result, attempt);
  pendingReferenceMatchSave = {
    attemptId: attempt.id,
    run: { id: crypto.randomUUID(), completedAt: new Date().toISOString(), ...result },
  };
  await savePendingReferenceMatchRun();
}

function renderReferenceMatchResult(attempt) {
  const output = $('reference-results');
  if (!attempt) { output.textContent = ''; return; }
  const run = lastReferenceMatchRun(attempt);
  if (run) {
    const target = run.rankedWords.find(row => row.word === run.targetWord);
    output.textContent = `${run.targetWord} ranked ${run.targetRank} of ${run.rankedWords.length}; closest example: “${run.closestWord}”. Average distance for this word: ${target.averageDistance.toFixed(2)}. Experimental similarity only; use the recording to judge.`;
  } else if (attemptIsApprovedReference(attempt)) {
    output.textContent = 'This take is a reference example. Compare a different take for this word.';
  } else if (attempt.durationMs > 10_000) {
    output.textContent = 'This take is longer than 10 seconds. Record a shorter example to compare.';
  } else if (referencesForWord(attempt.prompt).length) {
    output.textContent = `Ready to compare with ${referencesForWord(attempt.prompt).length} approved “${attempt.prompt}” example${referencesForWord(attempt.prompt).length === 1 ? '' : 's'}.`;
  } else {
    output.textContent = '';
  }
}

function readTranscriptionSettings() {
  const model = $('recognition-mode').value;
  if (model === 'record-only') return null;
  if (!Object.hasOwn(MODEL_CONFIGURATION_VERSIONS, model)) throw new Error('Unknown transcription model.');
  const connection = readGatewayConnection();
  return { model, endpoint: connection.endpointFor('/transcribe'), token: connection.token };
}

function beginHold(event) {
  if (event) event.preventDefault();
  if (operationPending || activeCapture || pendingAudioSave || pendingModelSave || pendingReferenceMatchSave || !microphoneStream || !archiveReady) return;
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
        microphoneSettings: microphoneStream.getAudioTracks()[0].getSettings(), voided: false, modelRuns: [], referenceMatchRuns: [] },
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

async function transcribeAttempt(attempt, settings, beforeSpeechGatewayRequest = null) {
  $('status').textContent = 'Audio saved — asking Google to transcribe it…';
  const run = {
    id: crypto.randomUUID(), startedAt: new Date().toISOString(), requestedModel: settings.model,
    configurationVersion: modelConfigurationVersion(settings.model), status: 'error',
  };
  const startedAtMs = Date.now();
  try {
    const requestBody = {
      model: settings.model,
      mimeType: attempt.audioMimeType,
      durationMs: attempt.durationMs,
      audioBase64: await blobBase64(attempt.audioBlob),
    };
    const requestOptions = {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.token}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(45000),
    };
    if (beforeSpeechGatewayRequest) await beforeSpeechGatewayRequest();
    run.speechGatewayRequestSentAt = new Date().toISOString();
    const response = await fetch(settings.endpoint, requestOptions);
    const transcription = await response.json();
    if (!response.ok) {
      run.serverError = transcription.error;
      throw new Error(transcription.error?.message || transcription.error || `Speech server returned HTTP ${response.status}`);
    }
    const preprocessing = transcription.preprocessing;
    if (typeof transcription.transcript !== 'string' || transcription.provider !== 'google-cloud-stt' ||
        transcription.model !== settings.model || transcription.languageCode !== 'en-GB' ||
        transcription.configurationVersion !== modelConfigurationVersion(settings.model) ||
        transcription.audioSha256 !== attempt.audioSha256 ||
        preprocessing?.version !== SPEECH_AUDIO_PREPROCESSING_VERSION ||
        preprocessing.sampleRateHertz !== 16000 || preprocessing.audioChannelCount !== 1 ||
        !Number.isInteger(preprocessing.inputDurationMs) || preprocessing.inputDurationMs <= 0 ||
        !Number.isInteger(preprocessing.outputDurationMs) || preprocessing.outputDurationMs <= 0 ||
        !Number.isInteger(preprocessing.trimmedLeadingSilenceMs) || preprocessing.trimmedLeadingSilenceMs < 0 ||
        preprocessing.trimmedLeadingSilenceMs + preprocessing.outputDurationMs > preprocessing.inputDurationMs + 2 ||
        !/^[a-f0-9]{64}$/.test(preprocessing.preparedAudioSha256 || '')) {
      throw new Error('The speech server response does not match this recording and model.');
    }
    const samePreparationRuns = (attempt.modelRuns || []).filter(previousRun =>
      previousRun.status === 'complete' && previousRun.preprocessing?.version === SPEECH_AUDIO_PREPROCESSING_VERSION);
    if (samePreparationRuns.some(previousRun => previousRun.preprocessing.preparedAudioSha256 !== preprocessing.preparedAudioSha256)) {
      throw new Error('The speech server prepared this recording differently from an earlier model comparison.');
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
  const latestRateLimitErrorStartedAt = latestSpeechRateLimitErrorStartedAt();
  if (latestRateLimitErrorStartedAt !== null) {
    const rateLimitCooldownMs = Math.max(0, latestRateLimitErrorStartedAt + SPEECH_GATEWAY_RATE_LIMIT_RETRY_DELAY_MS - Date.now());
    if (rateLimitCooldownMs > 0) {
      $('batch-status').textContent = `Waiting ${Math.ceil(rateLimitCooldownMs / 1000)}s for the previous request limit to clear; no audio is being sent.`;
      await new Promise(resolve => setTimeout(resolve, rateLimitCooldownMs));
    }
  }
  $('batch-status').textContent = `Starting ${label} for ${attempts.length} current saved takes, one at a time.`;
  let previousSpeechBatchRequestAt = null;
  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    if (!attempt.audioBlob || !attempt.audioSha256 || !attempt.audioMimeType || !Number.isFinite(attempt.durationMs)) {
      throw new Error(`Saved audio for “${attempt.prompt}” is incomplete; no request was sent for that take.`);
    }
    $('batch-status').textContent = `Transcribing with ${label}: ${index + 1}/${attempts.length} — “${attempt.prompt}”.`;
    let run;
    try {
      run = await transcribeAttempt(attempt, settings, async () => {
        if (previousSpeechBatchRequestAt !== null) {
          const remainingGapMs = Math.max(0, MINIMUM_SPEECH_BATCH_REQUEST_GAP_MS - (Date.now() - previousSpeechBatchRequestAt));
          if (remainingGapMs > 0) {
            $('batch-status').textContent = `Waiting ${Math.ceil(remainingGapMs / 1000)}s before ${index + 1}/${attempts.length} to stay within the speech server request limit.`;
            await new Promise(resolve => setTimeout(resolve, remainingGapMs));
          }
        }
        $('batch-status').textContent = `Transcribing with ${label}: ${index + 1}/${attempts.length} — “${attempt.prompt}”.`;
        previousSpeechBatchRequestAt = Date.now();
      });
    }
    catch (error) {
      $('batch-status').textContent = `Batch stopped at “${attempt.prompt}”: ${error.message}. Earlier saved results are kept.`;
      throw error;
    }
    if (run.status === 'error') {
      $('batch-status').textContent = `Batch stopped at “${attempt.prompt}” after ${index + 1}/${attempts.length}. This request failed and was saved as an error: ${modelRunErrorText(run)}. Earlier results are kept. Correct the problem, then run the batch again.`;
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

async function savePendingReferenceMatchRun() {
  const pending = pendingReferenceMatchSave;
  if (!pending) return;
  const attempt = recordedAttempts.find(recording => recording.id === pending.attemptId);
  if (!attempt) throw new Error('The saved take for this comparison is missing.');
  try {
    const saved = await ASRRecordings.appendReferenceMatchRun(recordingSession.id, attempt.id, pending.run);
    Object.assign(attempt, saved);
    pendingReferenceMatchSave = null;
    renderTrial();
    if ($('summary').style.display === 'block') renderSummary();
  } catch (error) {
    throw new Error(`The comparison finished, but its result could not be saved: ${error.message}. Keep this tab open and retry saving it.`);
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
  const referenceComparisons = selected.reduce((count, attempt) => count + (attempt.referenceMatchRuns || []).length, 0);
  $('stats').textContent = `${recordedAttempts.length} takes saved · ${selected.length}/${recordingSession.order.length} words recorded · ${models.map(scoreModel).join(' · ') || 'No Google transcript checks yet'} · ${referenceComparisons} experimental reference comparison${referenceComparisons === 1 ? '' : 's'} · ${captureErrors} recording errors · ${selected.filter(attempt => attempt.voided).length} excluded`;
  $('pairmatrix').textContent = 'Google transcript checks compare text with the displayed word. Reference comparisons rank sound similarity to approved recordings; they are experimental and do not mark words right or wrong. The ZIP includes audio and saved results.';
  const table = document.createElement('table');
  const header = document.createElement('tr');
  for (const label of ['Word', ...Object.values(MODEL_LABELS).map(label => `${label} transcript check`), 'Reference similarity (experimental)', 'Audio']) {
    const cell = document.createElement('th'); cell.textContent = label; header.appendChild(cell);
  }
  table.appendChild(header);
  for (const attempt of selected) {
    const row = document.createElement('tr');
    const formatRun = (model, modelRun) => {
      if (modelRun) {
        const trimDetail = modelRun.preprocessing.trimmedLeadingSilenceMs > 0
          ? `leading silence trimmed ${(modelRun.preprocessing.trimmedLeadingSilenceMs / 1000).toFixed(2)}s`
          : 'no leading silence removed';
        const currentResult = `${modelRun.transcript || 'No transcript returned'} — ${scoreTranscript(modelRun.transcript, attempt.prompt).verdict} · ${trimDetail}`;
        const previousRun = latestPreviousModelRun(attempt, model);
        if (!previousRun) return currentResult;
        const oldPreparation = previousRun.preprocessing?.version ? 'previous configuration' : 'before silence trimming';
        return `${currentResult} · Previous: ${previousRun.transcript || 'No transcript returned'} — ${scoreTranscript(previousRun.transcript, attempt.prompt).verdict} (${oldPreparation}; not in current scores)`;
      }
      const errorRun = latestModelError(attempt, model);
      if (errorRun) return `request error — ${modelRunErrorText(errorRun)}`;
      const historicalRun = latestHistoricalModelRun(attempt, model);
      if (historicalRun) {
        const oldPreparation = historicalRun.preprocessing?.version ? 'previous configuration' : 'before silence trimming';
        return `Previous: ${historicalRun.transcript || 'No transcript returned'} — ${scoreTranscript(historicalRun.transcript, attempt.prompt).verdict} (${oldPreparation}; not in current scores)`;
      }
      const historicalError = latestHistoricalModelError(attempt, model);
      if (historicalError) return `Previous request error (${modelRunErrorText(historicalError)}; not in current scores)`;
      return '—';
    };
    const modelTranscripts = Object.keys(MODEL_LABELS).map(model => formatRun(model, latestModelRun(attempt, model)));
    for (const text of [attempt.prompt, ...modelTranscripts]) {
      const cell = document.createElement('td'); cell.textContent = text; row.appendChild(cell);
    }
    if (attempt.voided) row.children[0].textContent += ' — VOIDED';
    const latestReferenceRun = lastReferenceMatchRun(attempt);
    const referenceCell = document.createElement('td');
    referenceCell.textContent = latestReferenceRun
      ? `target ranked ${latestReferenceRun.targetRank}/${latestReferenceRun.rankedWords.length}; closest “${latestReferenceRun.closestWord}”; average distance ${latestReferenceRun.rankedWords.find(result => result.word === attempt.prompt)?.averageDistance.toFixed(2)}`
      : '—';
    row.appendChild(referenceCell);
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
$('recognition-mode').addEventListener('change', refreshControls);
$('connect-references').addEventListener('click', () => runOperation(loadReferenceLibrary));
$('approve-reference').addEventListener('click', () => runOperation(approveCurrentTakeAsReference));
$('compare-reference').addEventListener('click', () => runOperation(compareCurrentTakeWithReferences));
$('transcribe').addEventListener('click', () => runOperation(() => transcribeAttempt(currentAttempt(), readTranscriptionSettings())));
$('transcribe-all').addEventListener('click', () => runOperation(() => transcribeRemainingCurrentTakes(readTranscriptionSettings())));
$('retry-save').addEventListener('click', () => runOperation(() => pendingAudioSave ? savePendingAudio() : pendingModelSave ? savePendingModelRun() : savePendingReferenceMatchRun()));
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
  $('archive-status').textContent = 'Takes are saved in this browser. Download a ZIP backup when finished.';
}

runOperation(initialize);
