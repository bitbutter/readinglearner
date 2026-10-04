# Recordings and speech-model evaluation

The evaluator records original audio files independently of browser speech recognition. Brave does not need Chrome's speech service to capture a recording. The private Google speech server can serve both pages. The evaluator uses it; the reading app's Google integration remains unpublished until we evaluate recognition against spoken reference words.

## Record a test set

### Guided reference check

1. In the evaluator, connect to the speech server and load the approved word references. The page shows how many distinct words are ready.
2. Choose **Start guided recording**. Allow microphone access when the browser asks.
3. For each large prompt, hold the microphone button, say the word, and release. The original recording is saved in this browser, then the next word appears automatically. No Google transcription request is made.
4. After the last word, the evaluator sends each usable take to the private speech server for comparison with the approved examples. The server does not save candidate takes or send them to Google.
5. Review each recording and its experimental sound ranking. If a comparison request failed, choose **Compare or retry saved takes**; already saved comparisons are skipped.
6. Download **comparison results JSON** and bring it back here so I can review the word rankings. Include **audio & manifest ZIP** if you want me to listen to the actual takes.

The ranking is not a right-or-wrong score. A target rank of 1 means the take ranked closest to its approved examples among the words in the reference library. The JSON contains no audio bytes or access code. The ZIP contains the original audio files and saved result history. Guided takes remain in this browser until exported; only approved reference audio is kept in the server library.

### Manual evaluator sessions

1. Open `asr_eval.html` and leave **After recording** set to **Save audio only**.
2. Choose **Enable microphone** and allow microphone access in the browser.
3. Hold the large microphone button, say the displayed word, then release. Wait for **Audio saved**.
4. Move between words with the numbers or back/next buttons. Holding the microphone again records another take without deleting the earlier one.
5. Void accidental or interrupted recordings. Voiding changes whether a take is scored; its audio remains in the archive.
6. Choose **Review this session**, then **Download audio & manifest ZIP**.

Recordings survive reloads in that browser on that device. A new session keeps earlier sessions in the **Saved session** menu. A downloaded ZIP is the portable copy; clearing browser storage removes locally saved sessions. Old evaluator sessions saved only text across reloads, and that earlier text can still be downloaded when present. Their missing audio cannot be recovered.

## What's in the ZIP

- `manifest.json`: session order, every take's stable ID, displayed prompt, microphone settings, recording duration, original file type/size/SHA-256, void status, selected take IDs, and every saved model execution.
- `audio/`: individual original files, such as WebM/Opus recordings from Brave and Chrome. Original bytes are preserved; filenames use each take's ID and prompt.

Re-recordings and failed transcriptions remain in the ZIP. Scores use the latest saved take and its latest recognition result. The original returned transcript remains unchanged: **Matt** is an accepted spoken homophone of **mat**, while **mad** remains a different word.

The displayed prompt describes what the learner was asked to say. It is not verified speech ground truth. Listen to the saved clips before interpreting model accuracy; include silence and deliberately incorrect words in a comparison. Never pass the expected answer to a recognizer while measuring it.

## Google recognition

The evaluator can submit to **Google Cloud Speech-to-Text V2 Chirp 3** or **short**, using `en-GB` in the `eu` region. Google lists both models for this language and region. The `short` option is a comparison candidate, not a claim that it is more accurate. Set up the private speech server following [speech_api/README.md](speech_api/README.md).

Select **Transcribe with Google Chirp 3** or **Transcribe with Google short (V2)**. The deployed transcription address is already filled in; enter the private server access code from Secret Manager. Select **Remember access code in this browser** to save it in this browser's local storage, or leave it unchecked to keep it only in the open tab. Pages on `bitbutter.github.io` share that local storage, so scripts on those pages could read the code. The code is never included in recording exports, and Google credentials stay on the server. Audio is saved before it is submitted to Google. A service failure leaves the file intact and is unscored. A completed request returning no speech is a scored miss.

To compare both models one take at a time, open each saved word take, select the other model, then press **Transcribe saved audio**. Or select a model and press **Transcribe remaining saved takes with selected model** to process each prompt's current valid take serially. The batch skips takes with an already-saved successful result for that model, saves after each request, and stops at the first failed request. Correct the problem and run it again to process the remaining takes. Retrying a failed request can make another billable request if Google processed the earlier audio but its result was not saved.

The page sends the same original audio bytes without the displayed answer. Both transcripts and their match/miss scores appear together in each result row and remain in the ZIP. Overall results show separate match rates. Each model submission is billed independently, so comparing both makes two recognition requests per take. To re-run a whole exported dataset, extract the ZIP and use the separate replay command documented in the server guide. It writes a new results file and does not alter the recordings.

The deployed HTTPS server is reachable from Android Brave. The optional local development server is accessible only from this computer. Recording and exporting require no speech server.

## Access code and accuracy check

The deployed code is in Google Cloud Secret Manager, project `readinglearner-speech-bitbu`, secret `reading-learner-speech-token`, version `1`. Open the version's actions and view its secret value yourself, then copy it directly to the evaluator's access-code field. Do not paste it into chat or put it in a URL, source file or shared export.

The server's first live check transcribed Google's 1.812-second public Brooklyn Bridge sample correctly and verified the returned recording hash. This checks deployment, not recognition quality for a child's isolated words. Compare models against the same saved audio and review the results before deciding whether either is suitable for reading practice.

## Local preview and checks

From the repository directory:

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/asr_eval.html`. For a local Google test, the transcription address is `http://127.0.0.1:8081/transcribe` after starting the private speech server.

The following checks use simulated audio/provider responses and make no paid requests:

```powershell
node logs/tools/test_asr_eval.mjs
node logs/tools/test_asr_recordings.mjs
npm --prefix speech_api test
```
