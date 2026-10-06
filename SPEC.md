# Reading Learner Spec

Date: 2026-10-06
Status: Current self-check design

## Goal

Help a young child practise reading small words and numbers aloud. The child sees one large word or number, says it using the microphone, then hears the answer and decides whether they got it. Spoken prompts and large icon controls make the app usable without reading its instructions.

The practice app is a static browser application served from GitHub Pages. It uses browser speech synthesis, local microphone capture, and `localStorage` progress. Practice has no account, API key, or speech-server requirement.

## Assumptions

- The learner is a pre-reader or early reader who can speak but cannot reliably read instructions.
- A grown-up handles setup and microphone permission. The child makes the practice self-check choice.
- Every meaning needed on the child's path is spoken or shown with an icon.
- Microphone health establishes that a recording happened. It does not establish whether a word was spoken correctly.
- English words and English number names remain the lesson content.

## Product Decisions

OLD: A recognizer transcript determined whether an attempt was correct and whether the child retried.
CHANGES_TO: After the first recording, the app speaks the answer and asks the child “Got it?” The child chooses Yes or records one helped repeat with the same mic button.
REASON: Recognition of young voices is too uncertain to provide the practice verdict.

OLD: One qualifying answer could earn gold and purple trophies.
CHANGES_TO: Gold and purple each require two qualifying first-attempt confirmations on separate encounters.
REASON: A second encounter provides another opportunity for independent recall.

OLD: A miss could lead to repeated correction, capped by a grown-up retry setting.
CHANGES_TO: One valid helped repeat completes the encounter without a second question; existing confirmation progress and trophies survive.
REASON: The child hears the model and immediately practises saying it without losing earned progress.

## Speech and Microphone

Browser `speechSynthesis` speaks the answer, question, praise, teaching rules, and capture-error prompts. The correct spoken answer is the word's pronunciation or the English name of a displayed number.

Practice captures microphone audio locally. No practice recognizer, transcript display, accepted-answer matching, or automatic correctness verdict is used. A valid recording requires a running audio context, a live microphone track, and at least one captured PCM sample. Silence is a valid recording: there is no word or speech detector. A capture failure keeps the current stage open and earns no confirmation or trophy.

The bundled on-device Vosk engine remains available for grown-up audition and tuning only. Its model loads only when the grown-up opens tuning; child startup and practice are independent of model loading or model failure. The tuning screen shows whether the engine is loading, ready, or unavailable. Its model and vocabulary matching do not grade child practice. The separate recording evaluator, its stored recordings, and cloud-model comparisons remain separate tools.

The answer and “Got it?” play as separate utterances. Yes and the repeat mic become available near the audible end of the answer, before any trailing silence in the voice's `onend` callback. An estimate starts only when actual speech starts and scales with the answer's approximate syllables, consonants, and the utterance's speaking rate. Numbers use their English names for that estimate. A reported boundary beyond the answer text, or successful native completion, can open the choices earlier. A word-start boundary does not prove the word has finished.

The estimate changes button timing only; it does not stop the answer or start the question. Native answer completion starts “Got it?” if the child has not responded. Choosing Yes or recording a repeat stops any remaining answer or question immediately. The question's completion does not change the available choices or score the answer. This timing is an approximation, not an acoustic measurement, and may be a little early or late for a particular voice.

An answer playback failure before the child responds enters the explicit `answer-error` phase, including when the estimate has already opened the choices. Yes stays hidden or disabled, the mic cannot begin another recording, and parent-readable text explains the problem. The same Hear it button retries the answer followed by “Got it?”. This retry preserves the first recording and its help counts; it does not submit another answer or select an alternative verdict. Each playback owns its timer and revision; responses, retries, and navigation invalidate older timing events.

Onboarding is spoken once per saved progress record. It introduces saying the word, hearing the answer, and choosing the checkmark or trying it again with the microphone. A denied or unavailable microphone receives a clear spoken error; it does not become a wrong answer.

## Content and Sound Help

The child chooses Words or Numbers. Existing lesson lists and levels remain in use: the numbers ladder covers 1–100, and the words ladder begins with simple decodable words before the sight-word levels. Existing exclusions for rule-breaker words remain in force for practice and recaps.

The word or number is shown in large type. Words retain their tappable sound groups, drag-to-sound-out interaction, highlighted compound sounds, and silent-letter treatment. Hear it speaks the whole answer before recording when the child requests help.

Rule chips remain visible for the teaching families attached to a word. A chip and the first introduction use the same lesson: short ordinary-English guidance, each relevant letter name spoken separately, the recorded isolated sound, then a whole-word example. The U-name demonstration intentionally speaks the real word “you”; no `ue.mp3` exists. Rule speech and praise do not spell isolated sounds as invented syllables for the synthetic voice.

Each individual letter-name step uses speaking rate 0.72 and a 220 ms pause after successful speech. Guidance and examples keep the normal rule-speaking rate. Both the live lesson and proposed-course preview accept optional positive `rate` and nonnegative `pauseAfterMs` on speech steps. The pause belongs to its current step: replay, competing help, a new word, or navigation cancels it. A rule is marked heard only after every step and declared pause completes.

The lesson owns its speech, sound clip, and deadline. Navigation, a new word, a rule replay, or competing sound/whole-word help cancels the entire old lesson. Only successful playback of every step marks that rule as heard. A spoken-guidance or recorded-sound failure displays an explicit retry message and does not mark the rule as heard or substitute a synthetic sound. The microphone stays unavailable during the lesson; rule chips, letter taps, and Hear it can interrupt it. Existing individual-letter sound help retains its prior audio/TTS behavior.

Word-specific teaching labels distinguish the long O in both from O before L, and the British water vowel from the short wash vowel. Shall uses its ordinary short A; music ends with the ordinary C sound. Current lesson lists, progression, and self-check scoring remain unchanged.

## Core Loop

One encounter has the following sequence:

1. **Present the word or number.** Show the text, earned trophies, applicable rule chips, and two mastery-confirmation dots. The child can hear the whole answer or tap sound groups before speaking.
2. **Record the first attempt.** The child holds the existing large mic button and speaks; release stops capture. The existing tap-to-start/tap-to-stop accommodation remains available. During microphone warm-up, the button remains able to receive the held pointer's release; releasing early cancels that unfinished capture.
3. **Speak the answer and question.** After a valid capture, pause for 0.5 seconds, then speak the answer. Enable Yes and the repeat mic near its estimated audible ending; leave the answer playing. Native completion then speaks “Got it?” if the child has not responded. If the answer cannot play, show a parent-readable error and Hear it to replay the answer and question. The spoken reveal and its playback retries do not count as help used before the first attempt.
4. **Let the child choose.** Show the large checkmark button labelled Yes alongside the same mic button. Hide Hear it during this choice. The short question is also visible for a nearby grown-up. The child can choose during the answer's trailing pause or while “Got it?” is playing; either choice stops the remaining speech immediately.
   - **Yes:** Commit the child's confirmation of the first attempt, award any qualifying progress, give spoken and visual feedback, and advance.
   - **Mic:** Record one helped repeat of the same word or number. After a valid capture, pause for 0.5 seconds, assume the repeat succeeded, give feedback, and advance without another question or confirmation button.

An ordinary completed encounter therefore contains one first attempt or a first attempt followed by one helped repeat. A helped repeat never returns to the self-check question. Recording failures remain at the unfinished recording stage.

The answer and question appear after recording, even for an unfamiliar word. There is no automatic hear-then-repeat mode, audio-fade threshold, adult grading mode, or retry-cap setting.

## Confirmations and Trophies

A confirmation qualifies for a trophy only when the child chooses Yes for the first attempt, without having used Hear it before that attempt. Letter-tap counts retain their existing distinctions:

| Trophy | Help before the first attempt | Requirement |
| --- | --- | --- |
| Silver: sounded it out | Two or more letter taps; no Hear it | One first-attempt Yes |
| Gold: knows it | At most one letter tap; no Hear it | Two qualifying first-attempt Yes confirmations on separate encounters |
| Purple: read it without help | No letter taps; no Hear it | Two qualifying first-attempt Yes confirmations on separate encounters |

Each item stores two independent accumulated counters:

- `masteryConfirmationCount`: first-attempt Yes confirmations with at most one letter tap and no Hear it. Reaching two earns gold and permanent mastery.
- `flawlessConfirmationCount`: first-attempt Yes confirmations with no letter taps and no Hear it. Reaching two earns purple.

A zero-tap confirmation qualifies for both counters. For example, a one-tap Yes followed by a zero-tap Yes earns gold, with one purple confirmation still needed. Each encounter can contribute at most once to each counter; a helped repeat contributes to neither.

The two small dots near the trophies show mastery-confirmation progress from zero through two, with an accessible label such as “1 of 2 confirmations.” A filled dot remains filled after a helped repeat, Hear it, or a nonqualifying attempt. The counters accumulate rather than forming a consecutive streak.

Gold mastery, silver, and purple trophies remain earned permanently. Loading an older save preserves its trophy booleans. Missing confirmation counters start at zero; old answers or streaks are not reinterpreted as new child confirmations. A helped repeat never removes mastery, resets a counter, or sends the child backwards through levels.

## Rounds and Recaps

A round uses the configured number of ordinary practice items, default 10. Numbers favor unmastered items, with previous helped items and new items ahead of other practice items. Existing round selection and level rules remain in use.

Word rounds keep the current teaching-family structure: easy words open and close the round, with one teaching family practised as a consecutive block in the middle. The family with the fewest attempts is selected from the eligible unmastered words. Rule chips and spoken rule teaching remain part of this structure.

A level completes when all eligible items have permanent gold mastery. Mastered items can still appear as familiar practice, and one eligible mastered item from an earlier level can appear as a recap. Excluded words do not block level completion. Earned levels do not move backwards.

Recaps use the same self-check and helped-repeat interaction but are feedback only. They earn no confirmation or trophy and do not change the ordinary round score or item practice statistics. Recap-selection bookkeeping may update to rotate the older words.

The all-done screen retains spoken praise, reward visuals, and the tomorrow send-off. A completed round remains a short session rather than an open-ended drill.

## Child-Facing Screen

- One large, high-contrast word or number is the focus.
- Hear it and the mic are available for the initial attempt. During self-check, Yes and the same mic are the two choices.
- Yes has a checkmark, a large friendly circular control, and a footprint matching the mic. Choosing the repeat route has no failure mark or punishing presentation.
- Round-progress dots, mastery-confirmation dots, and earned trophies remain visually distinct.
- Yes and Hear it use real disabled attributes while unavailable. The mic is disabled while waiting or while the answer has a playback error, and remains able to receive release during warm-up. Yes cannot commit before the estimated answer ending or while capture is active.
- Failed answer playback exposes Hear it for replaying the answer and question, with parent-readable error text. Choices stay disabled until the replay reaches its audible-end estimate or reported completion. Both choices remain available while “Got it?” plays.
- Controls have accessible names and visible keyboard focus. Filled confirmation dots differ in fill as well as color.
- Phone, tablet, and desktop layouts keep the word, question, and touch controls on screen with generous spacing.

## Grown-Up Area

The picker retains the settings button gated by a two-second hold. Settings provide round size, separate word and number level overrides, voice selection, speaking rate, progress, and an explicit reset of `readingLearner.v1`.

The existing Words & Numbers audition screen remains available for inspecting how Vosk transcribes the grown-up's voice, editing accepted tuning forms, and maintaining custom terms. Opening this screen starts model loading and displays its loading, ready, or failed status beside the tuning controls. These accepted forms affect tuning rather than the child's self-check. The sound-group preview remains available.

There is no grown-up correctness button, adult-decides mode, audio-fade setting, or retry-limit setting in the practice workflow.

## Saved Progress

Progress continues to use `readingLearner.v1` with storage version 1. Settings, item records, round records, and existing lesson migration markers remain in that record.

Item records retain their identity, content, level, practice statistics, last-seen information, and permanent `decoded`, `mastered`, and `flawless` trophy flags. They add `masteryConfirmationCount` and `flawlessConfirmationCount`, each initialized to zero when absent. Recognition accepted forms and audition confidence records remain relevant to grown-up tuning.

Commit item progress only when the encounter resolves through Yes or a valid helped repeat. Microphone errors and an unheard answer do not award or persist a confirmation. Keep prior confirmation counts and earned trophy flags across reloads and helped repeats. Resetting all progress remains an explicit grown-up action.

## Acceptance Criteria

- The child can use every practice control through icons and spoken prompts.
- A valid first recording leads to the correct answer followed by “Got it?”, unless the child has already responded.
- Yes and the repeat mic become available near the answer's audible end, using a rate-scaled duration estimate from actual speech start. The estimate never starts the question or interrupts the answer. Either choice stops the remaining speech immediately. Answer playback failure retains the first recording and offers Hear it to retry the answer and question.
- Yes resolves only that first attempt and cannot be committed twice for one encounter.
- The same mic records the one helped repeat. A valid repeat completes the encounter without a second self-check.
- A failed capture awards no progress and leaves the unfinished stage available.
- Releasing the held mic during warm-up cancels capture; the warming appearance never blocks the release event.
- Practice correctness never depends on a transcript, recognized vocabulary, confidence threshold, or a grown-up grading control.
- Child startup and practice do not load or wait for the Vosk model; only opening grown-up tuning starts that load.
- Two qualifying first-attempt confirmations on separate encounters earn gold mastery. Two zero-tap qualifying confirmations earn purple.
- Silver retains its two-or-more-letter-taps distinction.
- A helped repeat, Hear it, or a nonqualifying answer never resets confirmation progress or removes an earned trophy.
- Older saves retain all earned trophies and levels, with new counters initialized to zero.
- Recaps use the same interaction while remaining feedback only.
- Rule chips still speak their teaching rule when tapped.
- Vosk audition, lesson content, phonics assets, evaluator recordings, and separate evaluation tools retain their existing responsibilities.
- Progress survives refresh through `localStorage`; explicit grown-up reset remains available.

## Practical Limits

The child supplies the correctness judgement. A Yes can be mistaken, and a valid capture can contain silence. The app does not claim to measure pronunciation accuracy; its role is to prompt recall, give the spoken model, and support an immediate repeat.

Microphone permission, audio-context health, and speech-synthesis availability still affect the workflow. Recording problems require a clear spoken prompt and an unfinished encounter, with no invented success or failure verdict. Failed question playback pauses the encounter and lets Hear it retry the same question; a failed Vosk model load affects grown-up tuning only.
