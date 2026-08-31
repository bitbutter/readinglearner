# Reading Learner Spec

Date: 2026-06-10
Status: Draft plan

## Goal

Create a single-page, speech-powered web app that helps a young child who is **not yet a competent reader** practice saying small words and numbers out loud. The app shows one large word or number at a time, speaks it aloud, and asks the child to repeat it by pushing and holding a big button while they talk. All feedback is **spoken** so the child does not need to read anything to use the app.

The app runs entirely in the browser, is served from **GitHub Pages** (static files, no backend, no account, no API key), uses the **free browser speech engine** for both listening and talking, and stores progress in `localStorage`.

## Assumptions

- The target learner is a young child (roughly pre-reader to early reader) who can talk but cannot reliably read.
- The child operates the app mostly alone, sometimes with a grown-up nearby. A grown-up sets things up and is available for a fallback judgement when speech recognition fails.
- The app has no backend, account system, or network dependency after the page loads.
- Speech recognition for young voices is imperfect; the design must tolerate misrecognition gracefully and never trap or scold the child.
- English content for the first version. Sight words are English early-reader words; numbers are spoken English number names.
- The child cannot read instructions, settings, error text, or progress reports. Anything the child must understand has to be **spoken or shown as a picture/icon**, never written-only.
- Reading is not required to operate any child-facing control.

## Speech Engine

The app uses the browser **Web Speech API** for both directions:

- **Speech synthesis** (`speechSynthesis`) to speak words, numbers, praise, and gentle correction.
- **Speech recognition** (`SpeechRecognition` / `webkitSpeechRecognition`) to listen to the child repeat the word/number.

This is free, needs no API key, and works from a static GitHub Pages site. It is well supported in Chrome and Edge, reasonably in Safari, and weak/absent for recognition in Firefox.

**Grown-up fallback (required).** Recognition is unreliable for young voices and some browsers. The app must never depend on it alone:

- If recognition is unavailable, errors, times out, or returns low-confidence/empty results, the app falls back to a **grown-up judgement** control: two clearly-separated buttons a nearby adult can tap — a green check ("they said it right") and a soft retry ("try again"). These are positioned and sized for an adult, not as the child's primary path.
- A grown-up setting **"Grown-up decides"** can switch the whole app into adult-judged mode (no recognition at all), for noisy rooms or bad mics.
- Synthesis (the app talking) must work even when recognition does not; if synthesis is also unavailable, show a blocking grown-up message, because spoken feedback is core to the product.

## Evidence Basis

The design leans on a few well-supported learning principles, applied lightly for a young child:

- **Retrieval practice**: the child produces the word/number out loud before getting confirmation. Saying it is the learning event, not just hearing it.
- **Immediate feedback**: every attempt gets immediate spoken confirmation or a gentle correct model, then a chance to try again.
- **Scaffolding then fading**: each item starts with an audio model ("hear then repeat") and removes that support only after the child shows a small reliable streak, shifting toward independent decoding.
- **Spacing (light)**: practiced and mastered items appear less often than new or recently-missed ones, so easy items don't eat the round.
- **Multisensory pairing**: the child simultaneously sees the text, hears it, and says it, strengthening the link between the printed form and its sound.

These principles are deliberately applied in a much lighter form than a full spaced-repetition system, to suit a young child and a very simple screen.

## Product Decisions

OLD: Typed answers checked against text (months app).
CHANGES_TO: Spoken answers captured by speech recognition, with a grown-up fallback judgement.
REASON: The learner cannot type or read; speaking is the natural channel.

OLD: Written feedback ("Correct! The answer was April").
CHANGES_TO: All feedback is spoken aloud, paired with simple visual cues (color, a star, a happy mark).
REASON: A non-reader cannot use written feedback.

OLD: Cold typed recall as the only task.
CHANGES_TO: Items begin in **hear-then-repeat** mode (app says it, child repeats) and graduate to **silent decode** mode (shown with no audio) after 3 successes in a row.
REASON: A non-reader needs the sound model first; the crutch is faded only once the item is reliable.

OLD: Three confidence buttons submitted with each answer.
CHANGES_TO: No confidence buttons. The child just speaks; confidence is inferred only from success/streak.
REASON: Young children cannot self-rate confidence, and extra buttons clutter a simple screen.

OLD: Heavy SRS with ease factors, lapses, and date math.
CHANGES_TO: **Light SRS** — a simple per-item state (audio vs silent, success streak, mastered flag) plus need-based ordering. No ease multipliers, no graduation check.
REASON: The content set is tiny and the audience is young; predictable simple behavior beats a tuned scheduler.

OLD: Open-ended or timed 5-minute session.
CHANGES_TO: A **short fixed round** of items, ending in a celebratory "all done" screen with spoken praise and stars.
REASON: A clear, quick finish with a reward fits young children better than a clock.

OLD: One blended content pool.
CHANGES_TO: A **child-facing picker** — two big icon buttons (Numbers `123`, Words `ABC`) the child taps to choose what to practice.
REASON: Gives the child agency with no reading required, and keeps each practice screen focused.

OLD: Hidden correction / move on silently after a miss.
CHANGES_TO: On a miss, the app gently encourages, **re-says the word**, and the child **retries the same item** (capped) before moving on.
REASON: The correct sound model should be heard right when the error happens, then immediately re-attempted.

OLD: Keyboard-first, typed input, fast-typing accommodations.
CHANGES_TO: **Push-and-hold microphone button** as the single child action: hold to listen, release to evaluate, with a tap-to-toggle accommodation.
REASON: One large physical-feeling button is the simplest possible interaction for small hands.

OLD: Abbreviations never accepted; exact spelling required.
CHANGES_TO: Recognition matching is **forgiving** — homophones, near-misses, and common misrecognitions for the target item are accepted.
REASON: The goal is the child saying the word, not perfect transcription by an imperfect recognizer.

## Content

The first version teaches two sets, chosen by the child on the picker screen:

### Numbers 1–20

- Each item shows the **digit** (e.g. `14`) in very large type.
- The child says the number name ("fourteen").
- Expected spoken answer is the English number name; matching also accepts the digit-as-recognized and common homophones.

Homophone / misrecognition handling (accept as correct):

- `1` → "one", "won"
- `2` → "two", "to", "too"
- `4` → "four", "for", "fore"
- `8` → "eight", "ate"
- `10` → "ten"
- Teen/-ty confusions are matched leniently (e.g. accept "fourteen" for `14`); if recognition returns the bare digit string it is accepted.

### Common Sight Words

Starter list based on the **Dolch pre-primer** set (editable before/after build). First version may ship a subset:

> a, and, away, big, blue, can, come, down, find, for, funny, go, help, here, I, in, is, it, jump, little, look, make, me, my, not, one, play, red, run, said, see, the, three, to, two, up, we, where, yellow, you

- Each item shows the **word** in very large, friendly type.
- The child says the word.
- Matching is forgiving (see Answer Checking).

Notes:

- The exact word list and the number range are configuration, not hard-coded magic, so they can be tuned without reworking the engine.
- Words and numbers are never required to be read by the child to operate the app; the picker uses icons.

## Core Loop

For one item:

1. **Present.**
   - If the item is in **audio mode**: the app speaks the word/number, then the large text appears (or appears together with the sound). A soft "your turn" cue follows.
   - If the item is in **silent (decode) mode**: the large text appears with **no audio prompt**; the child is expected to read it.
2. **Listen.** The child pushes and holds the big mic button and says the word/number. Releasing stops capture and evaluates. (Tap-to-toggle accommodation: tap to start, tap to stop.)
3. **Judge.** Recognition result is matched leniently against the item's accepted answers. If recognition is unavailable/low-confidence/empty, fall back to the grown-up check.
4. **Feedback (spoken + visual).**
   - **Correct**: varied spoken praise ("Yes!", "Great job!", "You got it!", "Well done!") plus a visual reward (green glow, a star). Advance to the next item.
   - **Incorrect**: gentle spoken encouragement and the **correct model** ("Good try! This says *cat*. Now you try."), the app re-says it, and the child **retries the same item**. Retries are capped (default 2) so the child never gets stuck; after the cap the app says it once more warmly and moves on. A missed item comes back later in the round/next round.

### Audio fade rule (hear-then-repeat → silent)

- Each item tracks a **consecutive-success streak**.
- After **3 successes in a row**, the item switches from audio mode to **silent (decode) mode** and is afterwards shown without an audio prompt.
- A miss in silent mode resets the streak and returns the item to **audio mode** (the sound crutch comes back), so support reappears exactly when the child struggles.
- The streak threshold (default **3**) is a grown-up setting.

## Light SRS / Item Selection

A round is a short fixed set of items (default **8–10**, configurable). Selection favors what the child needs without complex math:

- Each item has a simple state: `mode` (`audio` | `silent`), `successStreak`, `totalCorrect`, `totalAttempts`, `mastered` (boolean), `lastSeenRound`.
- An item is **mastered** when it has reached silent mode and answered correctly at least a small number of times after that (default 2 in silent mode).
- Selection priority for a round:
  1. Items currently missed/being relearned (audio mode after a recent lapse).
  2. New, never-seen items.
  3. Items in progress (audio mode, building a streak).
  4. Mastered items, sprinkled in occasionally for maintenance (low weight).
- Within the round, avoid showing the same item twice back-to-back when other items are available.
- No date/clock scheduling is required; ordering is need-based and per-round. (A simple "not seen in a while" nudge using `lastSeenRound` is allowed but kept minimal.)

This is intentionally lighter than the months app: no `ease`, no `dueAt` math, no graduation check.

## UX Requirements

### Tone & visuals

- Big, friendly, high-contrast type. One word/number fills most of the screen.
- Large tap targets; no small controls anywhere the child can reach.
- Every child-facing meaning is **spoken or shown as an icon** — never written-only.
- Simple, calm reward visuals (a star, a gentle color change). No punishing red X; misses are warm.

### Screens

1. **Picker (child-facing).**
   - Two big buttons with icons: **Numbers** (`123`) and **Words** (`ABC`). (Optionally a **Mixed** button.)
   - Tapping (or focusing) a button **speaks its label** so a non-reader knows what it is.
   - Choosing a set starts a round.

2. **Practice (the main, very simple screen).**
   - One large word or number, centered.
   - One big **push-and-hold mic button** below it.
     - Hold to listen; the button visibly pulses/changes color while listening.
     - Release to stop and evaluate.
     - Tap-to-toggle accommodation for children who can't hold.
     - A safety timeout ends an over-long capture and evaluates what was heard.
   - A small, simple round-progress indicator (e.g. 0–10 stars filling), no text required.
   - Spoken feedback after each attempt; matching visual cue.
   - The grown-up fallback check (✓ / try-again) appears only when recognition fails, positioned for an adult.
   - No navigation, settings, or distractions on this screen.

3. **All-done (celebration).**
   - Appears when the fixed round completes.
   - Spoken praise plus a simple reward animation (stars/confetti).
   - A spoken **"Play again tomorrow!"** send-off, encouraging the child to come back another day rather than grind (reinforces spacing).
   - One big button to **play again tomorrow** (returns to picker / ends the session), spoken when focused.
   - No written report the child must read.

### Grown-up area (gated)

- A small grown-up entry point the child won't trigger by accident (e.g. press-and-hold a corner for ~3 seconds, or a simple "tap the bigger number" gate). Reachable, but not on the child's main path.
- Grown-up settings:
  - **Content**: which sets/words/numbers are active.
  - **Round size** (default 8–10).
  - **Audio-fade threshold** (default 3 in a row).
  - **Retry cap on a miss** (default 2).
  - **Grown-up decides** mode (disable recognition entirely; adult judges every attempt).
  - **Voice / speaking rate** for synthesis, if multiple voices are available.
  - **Reset progress** (clears `readingLearner.v1`) with confirmation that names the storage key.
- A simple, mostly-visual progress view for the grown-up: which items are new / learning / mastered (e.g. a colored grid), plus basic counts. This is for the adult and may use text.

### Accessibility

- Operable with no reading.
- Large touch targets; works on a phone or tablet held by a small child.
- Visible focus and state for the mic button (listening vs idle).
- Does not rely on color alone — pair color with a shape/icon (star for success, etc.) and with the spoken cue.
- Responsive layout for phone, tablet, and desktop.
- Requires microphone permission; first run explains (spoken + simple visual) that the app needs to hear the child, with a grown-up-facing prompt to allow it.

## Answer Checking

Matching must be **forgiving**, because recognition of young voices is noisy:

- Normalize recognition output: lowercase, trim, strip punctuation, collapse whitespace.
- Accept the target if the recognized text **equals** any accepted form, **contains** the target word, or is a close match (small edit distance) to an accepted form.
- Each item carries an explicit **accepted-answers** list (canonical word/number name plus known homophones and common misrecognitions; see Content).
- For numbers, accept the spoken name, the digit string, and listed homophones.
- Empty, low-confidence, or no-result recognition is **not** scored as wrong — it routes to the grown-up fallback (or a "I didn't hear you, try again" gentle re-prompt), never a failure mark.
- The child is never penalized for the recognizer's mistakes; ambiguity resolves toward giving the child the benefit of the doubt or asking a grown-up.

## localStorage Data Shape

Key: `readingLearner.v1`

```json
{
  "version": 1,
  "createdAt": "2026-06-10T00:00:00.000Z",
  "settings": {
    "activeSets": ["numbers", "words"],
    "roundSize": 10,
    "audioFadeThreshold": 3,
    "retryCap": 2,
    "grownUpDecides": false,
    "voiceName": null,
    "speechRate": 0.9
  },
  "items": {
    "num:14": {
      "kind": "number",
      "display": "14",
      "accepted": ["fourteen", "14"],
      "mode": "audio",
      "successStreak": 0,
      "silentCorrect": 0,
      "totalCorrect": 0,
      "totalAttempts": 0,
      "mastered": false,
      "lastSeenRound": null
    },
    "word:cat": {
      "kind": "word",
      "display": "cat",
      "accepted": ["cat", "cats"],
      "mode": "audio",
      "successStreak": 0,
      "silentCorrect": 0,
      "totalCorrect": 0,
      "totalAttempts": 0,
      "mastered": false,
      "lastSeenRound": null
    }
  },
  "rounds": [
    {
      "id": "2026-06-10-001",
      "set": "numbers",
      "startedAt": "2026-06-10T08:00:00.000Z",
      "endedAt": "2026-06-10T08:03:00.000Z",
      "itemsShown": 10,
      "correct": 8,
      "missed": 2,
      "fallbackUsed": 1
    }
  ]
}
```

Storage rules:

- Validate the root object and `version` on load.
- Seed a fresh canonical item set (from the active content config) when no storage exists.
- Clearing progress removes only `readingLearner.v1` and returns to first-run state.
- Grown-up progress views are derived from `items` and `rounds` at render time, not stored as separate aggregates.
- If validation fails, show a **grown-up-facing** blocking message (not the child) with a reset/clear control, since the child can't read or fix it.

## Implementation Plan

Phase 1: Static single-page app
- Create `index.html`, `styles.css`, and `app.js` (GitHub-Pages-ready static files).
- Render picker, practice, and all-done screens.
- Seed the canonical item set from content config when no storage exists.

Phase 2: Speech
- Wire `speechSynthesis` for speaking words/numbers, praise, and correction.
- Wire `SpeechRecognition` with the push-and-hold mic button (hold-to-listen, release-to-evaluate, tap-to-toggle accommodation, safety timeout).
- Implement forgiving answer matching with per-item accepted answers.
- Implement the grown-up fallback check and "Grown-up decides" mode.

Phase 3: Loop & light SRS
- Implement the core loop: present (audio vs silent), listen, judge, spoken+visual feedback, retry-on-miss with cap.
- Implement the audio-fade rule (3-in-a-row → silent; miss in silent → back to audio).
- Implement need-based round selection and the mastered flag.
- Persist item state after each attempt; record rounds.

Phase 4: Polish
- All-done celebration with stars/confetti and spoken praise.
- Responsive, high-contrast, large-target styling.
- Gated grown-up area: settings, content config, reset, and a simple visual progress view.
- Microphone-permission first-run flow (spoken + visual).
- Storage validation with a grown-up-facing recovery path.

## Acceptance Criteria

- The app is fully usable by a child who cannot read: every child-facing meaning is spoken or shown as an icon.
- The app loads and runs from GitHub Pages with no backend, account, or API key.
- A new item is presented in hear-then-repeat (audio) mode: the app speaks it, the child repeats it.
- After 3 successes in a row, an item is shown silently with no audio prompt.
- A miss in silent mode returns the item to audio mode.
- The child answers by pushing and holding one large mic button and speaking; releasing evaluates the attempt.
- A tap-to-toggle accommodation exists for children who cannot hold the button.
- All feedback (praise and correction) is spoken aloud and paired with a simple visual cue.
- On a miss, the app gently re-says the correct word and lets the child retry the same item, up to the retry cap, then moves on warmly.
- Answer matching is forgiving: homophones and listed common misrecognitions for the item are accepted; empty/low-confidence results are not scored wrong.
- When recognition is unavailable or fails, a grown-up fallback judgement (✓ / try-again) is available, and a "Grown-up decides" mode can disable recognition entirely.
- The child picks Numbers or Words from an icon-based picker whose buttons speak their labels.
- A round is a short fixed set ending in a spoken, visual celebration with a "play again tomorrow!" send-off.
- Numbers 1–20 and the configured sight-word list are practiceable.
- Progress (item modes, streaks, mastered flags) survives refresh via `localStorage`.
- A gated grown-up area provides settings, content config, a simple visual progress view, and a reset that clears `readingLearner.v1` after confirmation.
- Invalid storage shows a grown-up-facing recovery message, never a dead end the child faces.

## Open Questions Before Build

- Exact final sight-word list / subset size for the first ship (defaults to the Dolch pre-primer set above; editable).
- Whether to include a child-facing **Mixed** option on the picker in v1, or Numbers/Words only.

## Risks

- Speech recognition quality for young voices is the central risk; the grown-up fallback and forgiving matching are the mitigations and must be solid, not afterthoughts.
- Browser support for recognition varies (weak in Firefox); the app should detect support early and route to grown-up mode rather than appearing broken.
- Microphone permission friction on first run can block a child; the grown-up-facing permission flow must be clear.
- Over-aggressive matching could praise wrong answers; per-item accepted lists must be curated, not just fuzzy distance.
