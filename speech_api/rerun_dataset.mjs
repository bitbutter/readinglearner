import { open, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { MAX_AUDIO_BYTES, SPEECH_CONFIGURATION_VERSION, SPEECH_MODEL, validateRecordingRequest } from './providers.mjs';

function assertInsideDataset(datasetDirectory, audioPath) {
  const relativeAudioPath = relative(datasetDirectory, audioPath);
  if (!relativeAudioPath || relativeAudioPath.startsWith('..') || isAbsolute(relativeAudioPath)) {
    throw new Error('The recording path must stay inside the extracted dataset directory.');
  }
}

export async function rerunDataset({ manifestPath, outputPath, gatewayUrl, gatewayToken, requestsPerMinute = 20, fetchImplementation = fetch, pauseBetweenSubmissions = pause, now = () => performance.now() }) {
  if (!gatewayToken) throw new Error('Set SPEECH_GATEWAY_TOKEN before evaluating recordings.');
  if (!Number.isSafeInteger(requestsPerMinute) || requestsPerMinute <= 0) throw new Error('The replay request limit must be a positive integer.');
  const endpoint = new URL(gatewayUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/transcribe' || endpoint.search || endpoint.hash) {
    throw new Error('The speech API URL must be an HTTP or HTTPS /transcribe endpoint without credentials, query or fragment.');
  }
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('A remote speech API must use HTTPS.');
  }
  const resolvedManifest = await realpath(manifestPath);
  const datasetDirectory = dirname(resolvedManifest);
  const manifest = JSON.parse(await readFile(resolvedManifest, 'utf8'));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.attempts)) throw new Error('Use an extracted recording archive with manifest schemaVersion 2.');
  const attemptIds = new Set();
  for (const attempt of manifest.attempts) {
    if (typeof attempt.id !== 'string' || !attempt.id || attemptIds.has(attempt.id)) throw new Error('Each recording attempt must have a unique nonempty ID.');
    attemptIds.add(attempt.id);
  }
  const requestedOutputPath = resolve(outputPath);
  if (requestedOutputPath === resolvedManifest) throw new Error('Evaluation results must not overwrite the original manifest.');
  // Reserve the new results file before any paid request. Keep the manifest
  // and every existing file intact, even when the chosen output already exists.
  const resultsFile = await open(requestedOutputPath, 'wx');
  const evaluation = {
    schemaVersion: 1,
    evaluatedAt: new Date().toISOString(),
    datasetSessionId: manifest.session?.id ?? null,
    model: SPEECH_MODEL,
    configurationVersion: SPEECH_CONFIGURATION_VERSION,
    modelRuns: [],
    skippedAttempts: [],
  };
  const minimumSubmissionGapMs = Math.ceil(60_000 / requestsPerMinute) + 25;
  let previousSubmissionAt = null;
  const saveEvidence = async () => {
    const evidence = JSON.stringify(evaluation, null, 2) + '\n';
    await resultsFile.truncate(0);
    await resultsFile.write(evidence, 0, 'utf8');
  };
  try {
  await saveEvidence();
  for (const attempt of manifest.attempts) {
    if (attempt.voided || attempt.captureError) {
      evaluation.skippedAttempts.push({ attemptId: attempt.id, reason: attempt.voided ? 'voided' : 'capture_error' });
      await saveEvidence();
      continue;
    }
    const evaluatedAt = new Date().toISOString();
    try {
      if (typeof attempt.audioFilename !== 'string' || !attempt.audioFilename) throw new Error('The attempt is missing its recording filename.');
      const requestedAudioPath = resolve(datasetDirectory, attempt.audioFilename);
      assertInsideDataset(datasetDirectory, requestedAudioPath);
      const recordedAudioPath = await realpath(requestedAudioPath);
      assertInsideDataset(datasetDirectory, recordedAudioPath);
      const recordingFile = await stat(recordedAudioPath);
      if (!recordingFile.isFile() || recordingFile.size === 0 || recordingFile.size > MAX_AUDIO_BYTES || recordingFile.size !== attempt.audioByteLength) {
        throw new Error('The recording must be a nonempty audio file within 10 MiB matching the manifest size.');
      }
      const audioBytes = await readFile(recordedAudioPath);
      const audioSha256 = createHash('sha256').update(audioBytes).digest('hex');
      if (attempt.audioByteLength !== audioBytes.length || attempt.audioSha256 !== audioSha256) {
        throw new Error('The recording bytes do not match the manifest size and SHA-256.');
      }
      const request = { model: SPEECH_MODEL, audioBase64: audioBytes.toString('base64'), mimeType: attempt.audioMimeType, durationMs: attempt.durationMs };
      validateRecordingRequest(request);
      if (previousSubmissionAt !== null) {
        const remainingGapMs = Math.max(0, minimumSubmissionGapMs - (now() - previousSubmissionAt));
        if (remainingGapMs > 0) await pauseBetweenSubmissions(remainingGapMs);
      }
      previousSubmissionAt = now();
      const response = await fetchImplementation(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      });
      const gatewayResponse = JSON.parse(JSON.stringify(await response.json()).replaceAll(gatewayToken, '[credential removed]'));
      if (!response.ok) {
        evaluation.modelRuns.push({ attemptId: attempt.id, evaluatedAt, status: 'error', httpStatus: response.status, error: gatewayResponse.error || { code: 'invalid_gateway_error', message: 'The speech API returned an invalid error response.' } });
        await saveEvidence();
        continue;
      }
      if (gatewayResponse.audioSha256 !== audioSha256 || gatewayResponse.model !== SPEECH_MODEL || typeof gatewayResponse.transcript !== 'string') {
        throw new Error('The speech API response does not identify the recording and requested model correctly.');
      }
      evaluation.modelRuns.push({ ...gatewayResponse, attemptId: attempt.id, evaluatedAt, status: 'completed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This recording could not be evaluated.';
      evaluation.modelRuns.push({ attemptId: attempt.id, evaluatedAt, status: 'error', error: { code: 'recording_evaluation_failed', message: message.replaceAll(gatewayToken, '[credential removed]') } });
    }
    await saveEvidence();
  }
  } finally { await resultsFile.close(); }
  return evaluation;
}

async function runFromCommandLine() {
  const [manifestPath, outputPath, gatewayUrl = 'http://127.0.0.1:8081/transcribe', ...extraArguments] = process.argv.slice(2);
  if (!manifestPath || !outputPath || extraArguments.length) throw new Error('Usage: node rerun_dataset.mjs <manifest.json> <new-results.json> [speech-api-url]');
  const requestsPerMinute = process.env.SPEECH_GATEWAY_REQUESTS_PER_MINUTE === undefined ? 20 : Number(process.env.SPEECH_GATEWAY_REQUESTS_PER_MINUTE);
  const evaluation = await rerunDataset({ manifestPath, outputPath, gatewayUrl, gatewayToken: process.env.SPEECH_GATEWAY_TOKEN, requestsPerMinute });
  console.log(`Saved ${evaluation.modelRuns.length} recording evaluations; skipped ${evaluation.skippedAttempts.length} attempts.`);
  if (evaluation.modelRuns.some(run => run.status === 'error')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runFromCommandLine().catch(error => { console.error(error.message); process.exitCode = 1; });
}
