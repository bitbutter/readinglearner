// Runs the bundled Vosk message contracts without downloading a model or audio.
// Run from any directory: node logs/tools/test_vosk_runtime.mjs
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const voskSource = readFileSync(new URL('../../vosk/vosk.js', import.meta.url), 'utf8');
const embeddedWorkerMatch = /createBase64WorkerFactory\('([^']+)'/.exec(voskSource);
assert.ok(embeddedWorkerMatch, 'Bundled Vosk worker must remain embedded.');
const embeddedWorkerBytes = Buffer.from(embeddedWorkerMatch[1], 'base64');
const embeddedWorkerSource = embeddedWorkerBytes.toString('utf8');
assert.ok(Buffer.from(embeddedWorkerSource, 'utf8').equals(embeddedWorkerBytes),
  'Worker decoding must preserve every UTF-8 byte.');

const finalMethodStart = embeddedWorkerSource.indexOf('        retrieveFinalResult(recognizerId) {');
const finalMethodEnd = embeddedWorkerSource.indexOf('        removeRecognizer(recognizerId) {', finalMethodStart);
assert.ok(finalMethodStart >= 0 && finalMethodEnd > finalMethodStart);
const finalMethodSource = embeddedWorkerSource.slice(finalMethodStart, finalMethodEnd);
assert.equal(finalMethodSource.split('event: "finalresult"').length, 2);
const previouslyShippedWorkerSource = embeddedWorkerSource.slice(0, finalMethodStart)
  + finalMethodSource.replace('event: "finalresult"', 'event: "result"')
  + embeddedWorkerSource.slice(finalMethodEnd);
assert.equal(createHash('sha256').update(previouslyShippedWorkerSource).digest('hex'),
  '7ba6b482f49ff3d49290b85f4ca13d5c6a5787b237cac1c6d15129668d36f529',
  'Only the explicit final-result event may change inside the vendor worker.');

const quietConsole = { error() {}, warn() {}, info() {}, debug() {}, log() {} };
const workerResponses = [];
const workerScope = {
  addEventListener() {},
  postMessage(message) { workerResponses.push(message); },
};
const workerContext = vm.createContext({ self: workerScope, console: quietConsole });
vm.runInContext(embeddedWorkerSource, workerContext, { filename: 'bundled-vosk-worker.js', timeout: 5000 });
const speechWorker = new workerContext.worker_code.RecognizerWorker();
const recognizerId = 'test-word-recognizer';
let finalReadCount = 0;
let deletedRecognizerCount = 0;
let endpointReached = true;
speechWorker.Vosk = {
  _malloc: () => 0,
  _free() {},
  HEAPF32: new Float32Array(32),
};
speechWorker.recognizers.set(recognizerId, {
  id: recognizerId,
  sampleRate: 16000,
  recognizer: {
    AcceptWaveform: () => endpointReached,
    Result: () => JSON.stringify({ text: 'mat' }),
    PartialResult: () => JSON.stringify({ partial: 'ma' }),
    FinalResult() { finalReadCount++; return JSON.stringify({ text: 'mat' }); },
    delete() { deletedRecognizerCount++; },
  },
});

const audioChunk = { recognizerId, sampleRate: 16000, data: new Float32Array(4) };
const endpointResponse = await speechWorker.processAudioChunk(audioChunk);
assert.equal(endpointResponse.event, 'result', 'Streaming endpoints retain the result event.');
assert.equal(endpointResponse.result.text, 'mat');
endpointReached = false;
const partialResponse = await speechWorker.processAudioChunk(audioChunk);
assert.equal(partialResponse.event, 'partialresult');
assert.equal(partialResponse.result.partial, 'ma');

speechWorker.handleMessage({ data: { action: 'retrieveFinalResult', recognizerId } });
await new Promise(setImmediate);
assert.equal(workerResponses.length, 1);
assert.equal(workerResponses[0].event, 'finalresult', 'Requested completion has its own event.');
assert.equal(workerResponses[0].recognizerId, recognizerId);
assert.equal(workerResponses[0].result.text, 'mat');
assert.equal(finalReadCount, 1);

const removalResponse = await speechWorker.removeRecognizer(recognizerId);
assert.equal(removalResponse.event, 'result', 'Removing a recognizer retains the vendor event.');
assert.equal(finalReadCount, 2);
assert.equal(deletedRecognizerCount, 1);
assert.equal(speechWorker.recognizers.has(recognizerId), false);
await assert.rejects(speechWorker.retrieveFinalResult(recognizerId),
  { name: 'Error', message: /Does not exist or has already been deleted/ });

speechWorker.load = () => Promise.reject(new Error('Model archive could not be extracted.'));
speechWorker.handleMessage({ data: { action: 'load', modelUrl: 'model-test-only.tar.gz' } });
await new Promise(setImmediate);
const modelLoadErrorResponse = workerResponses.at(-1);
assert.equal(modelLoadErrorResponse.event, 'error', 'Actual worker load failure emits error.');
assert.equal(modelLoadErrorResponse.error, 'Model archive could not be extracted.');

class TestCustomEvent extends Event {
  constructor(type, options) { super(type); this.detail = options.detail; }
}
const browserWorkers = [];
const browserWorkerBlobs = [];
class BrowserWorkerFixture extends EventTarget {
  constructor(url) { super(); this.url = url; this.sentMessages = []; browserWorkers.push(this); }
  postMessage(message, options) { this.sentMessages.push({ message, options }); }
  receive(message) {
    const event = new Event('message');
    event.data = message;
    this.dispatchEvent(event);
  }
  fail(message) {
    const event = new Event('error');
    event.message = message;
    this.dispatchEvent(event);
  }
}
class BrowserBlobFixture {
  constructor(parts, options) { this.parts = parts; this.options = options; }
}
const browserContext = vm.createContext({
  EventTarget, CustomEvent: TestCustomEvent, Worker: BrowserWorkerFixture,
  Blob: BrowserBlobFixture,
  URL: { createObjectURL(blob) { browserWorkerBlobs.push(blob); return 'blob:local-vosk-test'; } },
  atob: encoded => Buffer.from(encoded, 'base64').toString('binary'),
  crypto: webcrypto, console: quietConsole,
});
vm.runInContext(voskSource, browserContext, { filename: 'vosk.js', timeout: 5000 });

function beginModelLoad() {
  const loadedModel = browserContext.Vosk.createModel('model-test-only.tar.gz');
  const browserWorker = browserWorkers.at(-1);
  assert.equal(browserWorker.sentMessages.at(-1).message.action, 'load');
  return { loadedModel, browserWorker };
}

const successfulLoad = beginModelLoad();
successfulLoad.browserWorker.receive({ event: 'load', result: true });
const loadedModel = await successfulLoad.loadedModel;
assert.ok(loadedModel instanceof browserContext.Vosk.Model);
assert.equal(loadedModel.ready, true);
assert.equal(browserWorkerBlobs.length, 1);
assert.equal(browserWorkerBlobs[0].options.type, 'application/javascript');

const recognizer = new loadedModel.KaldiRecognizer(16000, '["mat"]');
const deliveredEndpoints = [];
const deliveredCompletions = [];
recognizer.on('result', message => deliveredEndpoints.push(message));
recognizer.on('finalresult', message => deliveredCompletions.push(message));
successfulLoad.browserWorker.receive({ ...endpointResponse, recognizerId: recognizer.id });
successfulLoad.browserWorker.receive({ ...workerResponses[0], recognizerId: recognizer.id });
assert.equal(deliveredEndpoints.length, 1);
assert.equal(deliveredCompletions.length, 1);
assert.equal(deliveredCompletions[0].result.text, 'mat');
recognizer.retrieveFinalResult();
assert.equal(successfulLoad.browserWorker.sentMessages.at(-1).message.action, 'retrieveFinalResult');

const unsuccessfulLoad = beginModelLoad();
unsuccessfulLoad.browserWorker.receive({ event: 'load', result: false });
await assert.rejects(unsuccessfulLoad.loadedModel,
  { name: 'Error', message: 'Local speech recognition model could not be loaded.' });

const failedArchiveLoad = beginModelLoad();
failedArchiveLoad.browserWorker.receive(modelLoadErrorResponse);
await assert.rejects(failedArchiveLoad.loadedModel,
  { name: 'Error', message: 'Model archive could not be extracted.' });

const failedWorkerLoad = beginModelLoad();
failedWorkerLoad.browserWorker.fail('Worker script could not be evaluated.');
await assert.rejects(failedWorkerLoad.loadedModel,
  { name: 'Error', message: 'Worker script could not be evaluated.' });

const missingModelErrorDetail = beginModelLoad();
missingModelErrorDetail.browserWorker.receive({ event: 'error' });
await assert.rejects(missingModelErrorDetail.loadedModel,
  { name: 'Error', message: 'Local speech recognition model could not be loaded.' });

const missingWorkerErrorDetail = beginModelLoad();
missingWorkerErrorDetail.browserWorker.fail('');
await assert.rejects(missingWorkerErrorDetail.loadedModel,
  { name: 'Error', message: 'Local speech recognition worker could not be started.' });

console.log('Vosk runtime contracts passed: explicit completion, unchanged streaming/removal, model loading and errors.');
