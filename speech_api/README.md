# Recorded-word speech API

This speech API compares Google Cloud Speech-to-Text V2 `chirp_3` and `short` with V1 `latest_short`, all for `en-GB` in Google's `eu` region. V1 `latest_short` is a separate candidate from V2 `short`; Google recommends it for short, directed utterances. It is being measured on the same saved takes, with no assumption that it is more accurate. The reading app remains on its existing recognizer pending evidence from spoken reference words. Each submission makes one recognition request. It does not send the displayed word, accepted answers, vocabulary hints or transcript replacements to Google. It does not store recordings or sessions.

Google's dedicated Speech-to-Text service is used here. The [Gemini Developer API terms](https://ai.google.dev/gemini-api/terms) prohibit clients directed toward or likely accessed by people under 18.

## Set up the local API

Use Node.js 22 or newer. In this directory, run `npm ci`.

Create or select a Google Cloud project, enable billing and the **Cloud Speech-to-Text API** (`speech.googleapis.com`), then give the server identity the **Cloud Speech Client** role (`roles/speech.client`) and **Service Usage Consumer** role (`roles/serviceusage.serviceUsageConsumer`) on that project. For local development, the identity is the Google account you use below. Install the Google Cloud CLI and run:

```powershell
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

The server uses Application Default Credentials and sends the configured project as the [REST request's quota project](https://docs.cloud.google.com/docs/authentication/rest#quota_project). No personal API key goes into the page. Set these values in the terminal that starts the API:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'YOUR_PROJECT_ID'
$env:SPEECH_GATEWAY_TOKEN = (node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))")
Set-Clipboard -Value $env:SPEECH_GATEWAY_TOKEN
npm start
```

These commands copy the generated gateway token to the clipboard. Keep it private and paste it into the evaluation page's access-token field for that browser session. A hosted server should use its own Google Cloud service identity, rather than a developer's login or credentials embedded in the page.

The default address is `http://127.0.0.1:8081/transcribe`. Press Ctrl+C to stop it. Local mode binds to this computer's loopback address. A tablet cannot reach it through its own `127.0.0.1`; using the API from Brave on Android requires the deployed HTTPS service below.

## Limits and browser access

The page must send a private access token and originate from an exact allowed origin. Defaults are `https://bitbutter.github.io`, `http://localhost:8080`, and `http://127.0.0.1:8080`. To change these, set `SPEECH_ALLOWED_ORIGINS` to a comma-separated list of exact origins. A replay command without a browser Origin header still requires the access token.

| Environment setting | Default |
| --- | --- |
| `PORT` | `8081` |
| `SPEECH_GATEWAY_HOST` | `127.0.0.1`; explicitly `0.0.0.0` for Cloud Run |
| `SPEECH_GATEWAY_MAX_CONCURRENT` | `2` requests, including uploads |
| `SPEECH_GATEWAY_REQUESTS_PER_MINUTE` | `20` recognition submissions |
| `SPEECH_GATEWAY_REQUESTS_PER_DAY` | `200` recognition submissions per UTC day |
| `SPEECH_GATEWAY_TIMEOUT_MS` | `15000` milliseconds |

Each original recording must declare a positive duration below 60 seconds and contain at most 10 MiB of audio. Google independently enforces its synchronous recognition duration limit; the browser's duration value cannot authorize longer audio. Before any model call, the gateway decodes the original with the pinned FFmpeg 5.1.9 runtime, converts it to mono 16 kHz PCM, and removes detected leading silence while retaining 300 ms before the first sustained sound. Detection uses 10 ms RMS windows, a -50 dBFS threshold and five consecutive active windows. The gateway packages this prepared audio as a WAV/LINEAR16 file for all three models. A fresh decoder error fails the request before Google is called. The browser's original recording remains unchanged and is still the only audio file in the ZIP export.

Rate and daily counters live only in this local process and reset when it restarts. They are useful for local evaluation, but are not a durable spending cap for a deployed service. There are no automatic retries.

## Cloud Run setup

The deployed endpoint is [reading-learner-speech](https://reading-learner-speech-775355867708.europe-west1.run.app/transcribe), in project `readinglearner-speech-bitbu`. Revision `reading-learner-speech-00005-vl7` serves the evaluator's three allowlisted models in `en-GB`/EU: V2 `chirp_3`, V2 `short`, and V1 `latest_short`. Each request is converted to mono 16 kHz WAV and leading silence is trimmed with a 300 ms pre-roll; the saved original remains unchanged. The child reading app is unchanged. Keep the access token private; the endpoint URL alone does not authorize transcription.

The silence-trim revision is ready and serves 100% of traffic. Live checks on this revision verified the allowed GitHub Pages browser preflight (`204`), missing-token rejection (`401`), and unapproved-origin rejection (`403`). These checks submitted no saved speech audio and made no recognition request. An earlier revision transcribed one 1.812-second public Google sample as “How old is the Brooklyn Bridge?” with the expected model, language and original-audio SHA-256; V1 `latest_short` has not yet transcribed a saved take. Both the service-wide and revision instance maximums are set to one. No child's recording was used for these checks.

For another deployment, use [Google Cloud Shell](https://shell.cloud.google.com/) in the browser. It already has Google's command-line tools; nothing needs to be installed on this computer. First create a project and link billing in the Google Cloud console. Review the chosen project, identities and deployment settings before running the following setup.

Upload the prepared `speech-api-cloud-source-leading-silence-trim.zip` using Cloud Shell's upload button. Extract it into a new directory and open that directory. The archive contains server source and build configuration only. The included Dockerfile uses Node.js 24.21.0, pins FFmpeg 5.1.9, and runs as the `node` user. Strict `.gcloudignore` and `.dockerignore` lists exclude recordings, local dependencies, tests and credentials.

The account deploying from source needs **Cloud Run Source Developer**, **Service Usage Consumer**, and **Service Account User** on the chosen runtime identity. The build account needs **Cloud Run Builder** (`roles/run.builder`) on the project. This setup explicitly selects the Compute Engine default service account for builds. Project administrators may already have the deployer permissions. [Source deployment instructions](https://docs.cloud.google.com/run/docs/deploying-source-code), [build identity instructions](https://docs.cloud.google.com/run/docs/configuring/services/build-service-account).

An administrator must also authorize public access and configure the secret. **Cloud Run Admin** includes the required `run.services.setIamPolicy` permission; the source-developer role alone does not. The deployment command disables Cloud Run's Invoker IAM check, as Google's [public-access instructions](https://docs.cloud.google.com/run/docs/authenticating/public) recommend. The speech API continues to enforce its own private access token.

In Cloud Shell, set the project and enable the required APIs:

```bash
set -euo pipefail
SPEECH_PROJECT_ID='YOUR_PROJECT_ID'
SPEECH_EXPECTED_PROJECT_NUMBER='YOUR_PROJECT_NUMBER_FROM_CONSOLE'
SPEECH_PROJECT_NUMBER="$(gcloud projects describe "$SPEECH_PROJECT_ID" --format='value(projectNumber)')"
test "$SPEECH_PROJECT_NUMBER" = "$SPEECH_EXPECTED_PROJECT_NUMBER" || { printf '%s\n' 'Unexpected project number; stop and review.' >&2; exit 1; }
SPEECH_BUILD_SERVICE_ACCOUNT="${SPEECH_PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud config set project "$SPEECH_PROJECT_ID"
gcloud services enable speech.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

Before granting build permissions, inspect this identity's existing project roles:

```bash
gcloud iam service-accounts describe "$SPEECH_BUILD_SERVICE_ACCOUNT" --project "$SPEECH_PROJECT_ID" --format='value(email)'
gcloud projects get-iam-policy "$SPEECH_PROJECT_ID" \
  --flatten='bindings[].members' \
  --filter="bindings.members=serviceAccount:${SPEECH_BUILD_SERVICE_ACCOUNT}" \
  --format='value(bindings.role)'
```

Google automatically granted this Compute identity **Editor** (`roles/editor`) in our new project. We confirmed that it was unused by other workloads, removed Editor, granted Cloud Run Builder, and verified that its only project role was `roles/run.builder`. For a dedicated new project, review and remove an unused identity's broad default grant before building. In an existing project, stop and check dependencies with its administrator; do not automatically remove roles from an identity used by other services. The build identity should receive only the permissions required for this deployment.

Create a dedicated runtime account, `reading-learner-speech`. Give it **Cloud Speech Client** (`roles/speech.client`) and **Service Usage Consumer** (`roles/serviceusage.serviceUsageConsumer`) on this project. Attach this account to the Cloud Run service. Its attached identity provides Google credentials automatically; do not create or upload a service-account key. [Service identity instructions](https://docs.cloud.google.com/run/docs/configuring/services/service-identity).

Create a Secret Manager secret named `reading-learner-speech-token` containing a random private token of at least 24 characters without whitespace. Give the runtime account **Secret Manager Secret Accessor** (`roles/secretmanager.secretAccessor`) on that secret alone. Use secret version `1` for `SPEECH_GATEWAY_TOKEN`; keep the value out of source files and deployment arguments. Copy it directly from Secret Manager into the evaluation page's access-token field. [Secret configuration instructions](https://docs.cloud.google.com/run/docs/configuring/services/secrets).

With the source directory open in Cloud Shell and the verified project number, accounts and secret ready, deploy with pinned runtime and build identities:

```bash
gcloud run deploy reading-learner-speech \
  --source . \
  --project "$SPEECH_PROJECT_ID" \
  --region europe-west1 \
  --service-account "reading-learner-speech@${SPEECH_PROJECT_ID}.iam.gserviceaccount.com" \
  --build-service-account "projects/${SPEECH_PROJECT_ID}/serviceAccounts/${SPEECH_BUILD_SERVICE_ACCOUNT}" \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${SPEECH_PROJECT_ID},SPEECH_GATEWAY_HOST=0.0.0.0,SPEECH_ALLOWED_ORIGINS=https://bitbutter.github.io" \
  --set-secrets SPEECH_GATEWAY_TOKEN=reading-learner-speech-token:1 \
  --no-invoker-iam-check \
  --concurrency 2 \
  --max 1 \
  --max-instances 1 \
  --min 0 \
  --min-instances 0 \
  --memory 512Mi \
  --cpu 1 \
  --cpu-throttling \
  --no-cpu-boost \
  --timeout 60
```

`--max 1` limits the whole service; `--max-instances 1` limits each revision. Both are explicit: the first deployment's audit found a service maximum of 20 despite a revision maximum of 1. Verify both `metadata.annotations.run.googleapis.com/maxScale` and `spec.template.metadata.annotations.autoscaling.knative.dev/maxScale` are `1` in the deployed service configuration. The minimums are zero, CPU is throttled outside requests, and startup CPU boost is disabled. [Maximum-instance settings](https://docs.cloud.google.com/run/docs/configuring/max-instances), [deployment flags](https://docs.cloud.google.com/sdk/gcloud/reference/run/deploy).

Cloud Run supplies the listening `PORT`; this service explicitly listens on `0.0.0.0` inside its container. HTTPS is provided by Cloud Run. Allowing unauthenticated Cloud Run access permits the browser to reach the endpoint; the API still requires its private bearer token before accepting any recognition request. Use the resulting service URL followed by `/transcribe` in the evaluation page. An ordinary browser visit reports that POST is required and does not call Google Speech.

The default limits remain 20 submissions per minute and 200 per UTC day **per process**. Instances can restart, and Cloud Run scaling settings are not a spending guarantee. Review Google's Speech, Cloud Run, build, image-storage and Secret Manager costs and set billing alerts before deployment. To stop this service later, delete `reading-learner-speech` in Cloud Run; stored build images and the Secret Manager secret remain separately removable.

## Request and evidence

```text
POST /transcribe
Authorization: Bearer YOUR_GATEWAY_TOKEN
Content-Type: application/json
```

```json
{
  "model": "chirp_3",
  "audioBase64": "BASE64_OF_ORIGINAL_AUDIO_BYTES",
  "mimeType": "audio/webm;codecs=opus",
  "durationMs": 2000
}
```

The request's `model` field accepts only `chirp_3`, `short` or `latest_short`; the request never includes the expected word or microphone sample rate. Every accepted original container is converted to WAV/LINEAR16 before reaching Google. The response identifies the provider, selected model, language, model-specific `configurationVersion` (`recorded-word-en-GB-chirp3-leading-silence-preroll-300ms-v2`, `recorded-word-en-GB-short-leading-silence-preroll-300ms-v2` or `recorded-word-en-GB-v1-latest-short-leading-silence-preroll-300ms-v3`), the original recording's SHA-256, preprocessing version and prepared-audio SHA-256, detected trim duration, elapsed request time, transcript, Google usage metadata, and Google's response. The same preparation version and prepared-audio hash are required for a valid same-take model comparison. It preserves the returned transcript text; multiple sequential speech segments are joined with a space. `alternatives` is empty because the API does not invent complete alternate transcripts from segment hypotheses; those hypotheses remain in `providerResponse`.

A completed request with no Google results produces an empty transcript. Operational failures are separate HTTP errors containing `error.code` and `error.message`; Google's rejection response is preserved with credentials removed. No failure changes the selected model or becomes a successful transcript.

## Re-evaluate a saved dataset

Extract the evaluation ZIP into a directory. Its `manifest.json` must have `schemaVersion: 2` and reference the original audio files. In a terminal with the same private gateway token, run:

```powershell
node rerun_dataset.mjs 'C:/path/to/dataset/manifest.json' 'C:/path/to/dataset/chirp3-results.json'
```

An optional third argument selects an HTTPS speech API or another loopback address. This command sends recordings to Google and can incur charges. It evaluates every nonvoid attempt, including re-recordings, and skips capture errors. It verifies each file's size and SHA-256 first. Submissions are paced to `SPEECH_GATEWAY_REQUESTS_PER_MINUTE` (default 20); use the same setting as the chosen server. Labels stay in the local manifest and are never sent to the recognition API. Results are written to a new file keyed by attempt ID and saved after every attempt; originals and earlier results cannot be overwritten. Review the saved errors before evaluating another set.

## Cost and accuracy

[Google's current V2 standard price](https://cloud.google.com/speech-to-text/pricing) is $0.016 per minute. V1 has a 60-minute monthly free tier, then standard recognition costs $0.024 per minute without data logging. Requests are rounded up to a whole second and billed per audio channel. Silence is still processed audio; an empty transcription can still incur a charge.

Accuracy on this child's isolated words has not been established for the trimmed audio. The evaluator can compare Chirp 3 (V2), `short` (V2) and `latest_short` (V1) on the same prepared copy of each original take. The recognizer does not receive the expected answer; local evaluation scores each returned transcript afterward. Google lists V1 `latest_short` for `en-GB` and describes it for short, directed speech. This is a candidate to measure, not a guarantee of better recognition. Earlier untrimmed transcripts stay in the archive but are not included in current scores after the configuration version changes. Rerunning them sends new Google recognition requests and may incur usage charges.

## Verify without contacting Google

Run `npm test` with FFmpeg available on `PATH`. Audio preparation tests decode generated speech fixtures, while provider tests simulate Google and credentials. The test suite does not submit recordings or make paid recognition calls.

Reference: [V1 model selection](https://docs.cloud.google.com/speech-to-text/docs/v1/transcription-model), [V1 supported languages](https://docs.cloud.google.com/speech-to-text/docs/v1/speech-to-text-supported-languages), [V1 audio configuration](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v1/RecognitionConfig), [EU V1 endpoint](https://docs.cloud.google.com/speech-to-text/docs/v1/endpoints), [V2 supported languages](https://docs.cloud.google.com/speech-to-text/docs/speech-to-text-supported-languages), [V2 model-selection sample](https://docs.cloud.google.com/speech-to-text/docs/samples/speech-transcribe-model-selection-v2), [Chirp 3 model](https://docs.cloud.google.com/speech-to-text/docs/models/chirp-3), [V2 synchronous recognition](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/projects.locations.recognizers/recognize), [audio decoding](https://docs.cloud.google.com/speech-to-text/docs/reference/rest/v2/projects.locations.recognizers#AutoDetectDecodingConfig).
