import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rerunDataset } from '../rerun_dataset.mjs';

test('dataset reruns preserve every usable attempt and send no labels', async () => {
  const datasetDirectory = await mkdtemp(join(tmpdir(), 'reading-learner-speech-replay-'));
  try {
    await mkdir(join(datasetDirectory, 'audio'));
    const audioBytes = Buffer.from('original child recording');
    const audioSha256 = createHash('sha256').update(audioBytes).digest('hex');
    await writeFile(join(datasetDirectory, 'audio', 'first.webm'), audioBytes);
    const attempt = { id: 'attempt-1', prompt: 'mat', audioFilename: 'audio/first.webm', audioMimeType: 'audio/webm;codecs=opus', audioByteLength: audioBytes.length, audioSha256, durationMs: 2000, modelRuns: [] };
    const manifest = { schemaVersion: 2, session: { id: 'session-1' }, attempts: [attempt, { ...attempt, id: 'attempt-2' }, { ...attempt, id: 'attempt-3', voided: true }, { ...attempt, id: 'attempt-4', audioSha256: 'wrong' }, { ...attempt, id: 'attempt-5', audioFilename: '../../outside.webm' }, { ...attempt, id: 'attempt-6', captureError: 'interrupted' }] };
    const manifestPath = join(datasetDirectory, 'manifest.json');
    const originalManifest = JSON.stringify(manifest);
    await writeFile(manifestPath, originalManifest);
    let calls = 0;
    const fetchImplementation = async (_url, options) => {
      calls++;
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['audioBase64', 'durationMs', 'mimeType', 'model']);
      assert.ok(!options.body.includes('mat'));
      return calls === 1 ? Response.json({ model: 'chirp_3', audioSha256, transcript: 'Matt' }) : Response.json({ error: { code: 'speech_provider_error', message: 'Google rejected it' } }, { status: 502 });
    };
    const outputPath = join(datasetDirectory, 'chirp-results.json');
    const submissionGaps = [];
    const evaluation = await rerunDataset({ manifestPath, outputPath, gatewayUrl: 'http://127.0.0.1:8081/transcribe', gatewayToken: 'fake-secret-gateway-token', fetchImplementation, pauseBetweenSubmissions: async milliseconds => submissionGaps.push(milliseconds) });
    assert.equal(calls, 2);
    assert.equal(submissionGaps.length, 1);
    assert.ok(submissionGaps[0] > 2900);
    assert.deepEqual(evaluation.modelRuns.map(run => [run.attemptId, run.status]), [['attempt-1', 'completed'], ['attempt-2', 'error'], ['attempt-4', 'error'], ['attempt-5', 'error']]);
    assert.equal(evaluation.skippedAttempts.length, 2);
    assert.equal(await readFile(manifestPath, 'utf8'), originalManifest);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), evaluation);
    await assert.rejects(rerunDataset({ manifestPath, outputPath, gatewayUrl: 'http://127.0.0.1:8081/transcribe', gatewayToken: 'fake-secret-gateway-token', fetchImplementation }), /EEXIST/);
    assert.equal(calls, 2);
  } finally { await rm(datasetDirectory, { recursive: true, force: true }); }
});
