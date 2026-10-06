'use strict';

// The review page demonstrates the course's declared lesson steps. It does not
// record audio, read child progress, or mark a rule as learned.
const rulePreviewStepsById = JSON.parse(document.getElementById('rule-preview-steps').textContent);
let activeRulePreview = null;

function stopRulePreview() {
  const preview = activeRulePreview;
  if (!preview) return;
  activeRulePreview = null;
  preview.cancelStep?.();
  window.speechSynthesis?.cancel();
  preview.audio?.pause();
  preview.button.textContent = 'Listen to this rule';
  preview.button.setAttribute('aria-pressed', 'false');
  preview.status.textContent = '';
}

function playRulePreviewStep(preview, step) {
  return new Promise((resolve, reject) => {
    let finished = false;
    let deadline;
    let cleanup = () => {};
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      cleanup();
      preview.cancelStep = null;
      error ? reject(error) : resolve();
    };
    preview.cancelStep = () => finish(new Error('Rule preview stopped.'));
    deadline = setTimeout(() => finish(new Error('Rule playback did not finish. Tap Listen to try again.')),
      step.kind === 'speech' ? Math.max(6000, step.text.length * 120 + 4000) : 10000);
    if (step.kind === 'speech') {
      const speakingRate = step.rate === undefined ? 0.9 : step.rate;
      const pauseAfterSpeechMs = step.pauseAfterMs === undefined ? 0 : step.pauseAfterMs;
      if (!Number.isFinite(speakingRate) || speakingRate <= 0 ||
          !Number.isFinite(pauseAfterSpeechMs) || pauseAfterSpeechMs < 0) {
        finish(new Error('This rule has invalid speech pacing.'));
        return;
      }
      if (!window.speechSynthesis) { finish(new Error('Speech playback is unavailable in this browser.')); return; }
      const utterance = new SpeechSynthesisUtterance(step.text);
      utterance.lang = 'en-GB';
      utterance.rate = speakingRate;
      let speechCompleted = false;
      utterance.onend = () => {
        if (finished || speechCompleted) return;
        speechCompleted = true;
        clearTimeout(deadline);
        cleanup();
        if (pauseAfterSpeechMs === 0) { finish(); return; }
        deadline = setTimeout(() => finish(), pauseAfterSpeechMs);
      };
      utterance.onerror = event => finish(new Error('Speech playback failed: ' + event.error));
      preview.utterance = utterance;
      cleanup = () => {
        utterance.onend = null;
        utterance.onerror = null;
        preview.utterance = null;
      };
      try { speechSynthesis.speak(utterance); }
      catch (error) { finish(error); }
      return;
    }
    if (step.kind !== 'recorded-sound') { finish(new Error('Unknown rule playback step.')); return; }
    const audio = new Audio('../audio/letters/' + step.clipKey + '.mp3?v=4');
    preview.audio = audio;
    audio.onended = () => finish();
    audio.onerror = () => finish(new Error('The recorded sound could not play: ' + step.clipKey));
    cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      preview.audio = null;
    };
    audio.play().catch(finish);
  });
}

document.querySelectorAll('.rule-preview').forEach(button => {
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', async () => {
    const wasPlaying = activeRulePreview?.button === button;
    stopRulePreview();
    if (wasPlaying) return;
    const preview = {
      button, status: button.parentElement.querySelector('.rule-preview-status'),
      cancelStep: null, audio: null, utterance: null,
    };
    activeRulePreview = preview;
    button.textContent = 'Stop rule';
    button.setAttribute('aria-pressed', 'true');
    preview.status.textContent = 'Playing…';
    try {
      const steps = rulePreviewStepsById[button.dataset.ruleId];
      if (!Array.isArray(steps) || !steps.length) throw new Error('This rule has no playback steps.');
      for (const step of steps) {
        if (activeRulePreview !== preview) return;
        await playRulePreviewStep(preview, step);
      }
      if (activeRulePreview === preview) {
        stopRulePreview();
        preview.status.textContent = 'Finished';
      }
    } catch (error) {
      if (activeRulePreview !== preview) return;
      stopRulePreview();
      preview.status.textContent = error.message;
    }
  });
});

window.addEventListener('pagehide', stopRulePreview);
document.getElementById('word-search').addEventListener('input', stopRulePreview);
document.getElementById('phase-filter').addEventListener('change', stopRulePreview);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRulePreview();
});
