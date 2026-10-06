# Reading Learner Spec

Date: 2026-10-06
Status: Active 41-level word course and self-check design

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

OLD: Ten word levels mix several unfamiliar spelling patterns and choose a teaching family within each round.
CHANGES_TO: A cumulative course has 41 small levels with 240 focus words. Each level teaches one focus and each round uses three familiar words, four focus encounters, then three familiar words.
REASON: The child gets familiar practice around one new pattern at a time.

OLD: Every eligible word assigned to a numeric level determines completion.
CHANGES_TO: Only the declared focus bank completes a word level. Earlier mastered course words and explicitly parent-confirmed starter words provide familiar practice.
REASON: Familiar words can support later levels without gaining new completion requirements.

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

The child chooses Words or Numbers. Words use the active course `one-focus-word-course-v1`: 41 cumulative levels, 240 focus words, and one declared focus per level. Numbers retain their separate ten-level ladder covering 1–100. Each later word level assumes the patterns from earlier levels; a focus word may contain several already taught patterns.

The reviewed course source is `plans/word-levels-proposed.json`, retained at its existing published URL. Its status is active. `logs/tools/build_word_course.mjs` generates `word-course.js` from that source, the app's original vocabulary, and the artwork catalog. The generated classic module loads before the app. It declares the focus banks, stable word IDs, rule playback steps, starter choices, 145 additional word records, and the fixed word-round recipe. Generation fails on changed reviewed banks, missing sound clips, missing or repeated images, or incomplete photograph credits.

All original word records remain in the catalog. The 191 original words outside the active banks are parked; custom words also stay outside the fixed course. Their earned progress, accepted tuning forms and grown-up audition remain available. They do not enter course completion or automatic familiar selection. The old exclusion list does not hide a declared active focus word: book is deliberately taught in the short-oo bank. Custom terms do not silently become focus requirements.

The word or number is shown in large type. Words retain their tappable sound groups, drag-to-sound-out interaction, highlighted compound sounds, and silent-letter treatment. Hear it speaks the whole answer before recording when the child requests help.

Focus encounters show one primary rule chip for the current level. Familiar opening and closing encounters do not introduce a focus chip. The level introduction, chip replay and course-guide preview share the course's declared playback steps: short ordinary-English guidance, each relevant letter name spoken separately, the recorded isolated sound, then whole-word examples. Blending lessons play their separate consonant sounds before the word. The U-name demonstration intentionally speaks the real word “you”; no `ue.mp3` exists. Rule speech and praise do not spell isolated sounds as invented syllables for the synthetic voice.

Each individual letter-name step uses speaking rate 0.72 and a 220 ms pause after successful speech. Guidance and examples keep the normal rule-speaking rate. Both the live lesson and course-guide preview accept optional positive `rate` and nonnegative `pauseAfterMs` on speech steps. The pause belongs to its current step: replay, competing help, a new word, or navigation cancels it. A rule is marked heard only after every step and declared pause completes.

The lesson owns its speech, sound clip, and deadline. Navigation, a new word, a rule replay, or competing sound/whole-word help cancels the entire old lesson. Only successful playback of every step marks that rule as heard. A spoken-guidance or recorded-sound failure displays an explicit retry message and does not mark the rule as heard or substitute a synthetic sound. The microphone stays unavailable during the lesson; rule chips, letter taps, and Hear it can interrupt it. Existing individual-letter sound help retains its prior audio/TTS behavior.

Word-specific sound definitions cover every active focus bank. The parent's course guide lists the exact words, rules, teaching notes and deferred topics; its artwork gallery shows all level pictures and photograph credits. Each level has its own image: ten existing pictures at milestones and 31 real tank photographs between them. The practice screen exposes the current photograph's credit and source link.

Existing word-specific teaching labels distinguish the long O in both from O before L, and the British water vowel from the short wash vowel. Shall uses its ordinary short A; music ends with the ordinary C sound. Those parked words remain available for grown-up tuning.

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

A word round has ten ordinary encounters in a fixed order: three familiar words, four encounters from the current focus bank, then three familiar words. The four focus slots rotate through the bank over successive rounds; a level's entire bank need not fit in one round. The number-round size remains configurable, default 10. Numbers favor unmastered items, with previous helped items and new items ahead of other practice items.

Familiar selection uses gold-mastered focus words at or before the current word level, including mastered words in the current bank, and declared starter words explicitly confirmed by a grown-up. The starter choices are mat, dad and hat. A grown-up confirms only words the child already reads independently. Repeating a familiar word is allowed. Future-bank, parked and custom words are outside automatic familiar selection. Candidate review words in the course guide are examples, not guarantees that the child knows them.

If no eligible familiar word is available, word practice gives a clear setup message and directs the grown-up to confirm familiar starters. It does not substitute an unseen word. The course assumes ordinary consonant sounds and an attempt at simple consonant-vowel-consonant blending; the grown-up checks these starting skills before practice.

A word level completes when every word in its declared focus bank has permanent gold mastery. Familiar opening and closing words add no completion requirements. Existing mastery and confirmation counters retain their credit. Number levels retain completion over their eligible number items. Familiar word encounters use the normal confirmation and trophy mechanics. Feedback-only recaps remain exclusive to number rounds. Earned progress does not move backwards.

Number recaps use the same self-check and helped-repeat interaction but are feedback only. They earn no confirmation or trophy and do not change the ordinary round score or item practice statistics. Recap-selection bookkeeping may update to rotate older numbers.

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

The picker retains the settings button gated by a two-second hold. Settings provide number-round size, separate word and number level overrides, familiar-starter confirmation, voice selection, speaking rate, progress, and an explicit reset of `readingLearner.v1`. Word levels run from 1 through 41; number levels remain 1 through 10. Word rounds keep their fixed 3 + 4 + 3 structure. A saved level override survives reloads.

The existing Words & Numbers audition screen remains available for inspecting how Vosk transcribes the grown-up's voice, editing accepted tuning forms, and maintaining custom terms. Opening this screen starts model loading and displays its loading, ready, or failed status beside the tuning controls. These accepted forms affect tuning rather than the child's self-check. The sound-group preview remains available.

There is no grown-up correctness button, adult-decides mode, audio-fade setting, or retry-limit setting in the practice workflow.

## Saved Progress

Progress continues to use `readingLearner.v1` with storage version 1. Settings, item records, round records, and existing lesson migration markers remain in that record.

The new course identity owns an explicit one-time word-course migration. It preserves all existing word identities, trophies, confirmation counters, practice statistics, accepted forms, custom records and old round history. It assigns active course membership and starts at the first unfinished focus bank using preserved mastery. Old numeric level history retains its original meaning; it is not relabelled as a new-course level. Later reloads do not rerun the migration or overwrite a parent's saved course-level override. A grown-up can select Level 1 for practice without clearing trophies.

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
- The active word course has the reviewed 41 focus banks and 240 focus words, with one focus per level.
- Every ordinary word round follows three familiar words, four focus encounters and three familiar words. Number-round size and its ten-level progression remain independent.
- Familiar words are mastered course words at or before the current level or explicitly confirmed declared starters. Missing familiar words expose setup rather than an invented easy word.
- Only the active focus bank determines word-level completion. Parked and custom terms retain tuning and progress without entering course completion.
- The word-course migration preserves trophies, confirmations, tuning records and old round history, selects the first unfinished focus bank once, and preserves later level overrides across refresh.
- Every level has a distinct assigned picture; photograph source and licence credits are available from practice.
- Recaps use the same interaction while remaining feedback only.
- Rule chips still speak their teaching rule when tapped.
- Vosk audition, evaluator recordings, and separate evaluation tools retain their existing responsibilities. The recognition experiment remains stopped.
- Progress survives refresh through `localStorage`; explicit grown-up reset remains available.

## Practical Limits

The child supplies the correctness judgement. A Yes can be mistaken, and a valid capture can contain silence. The app does not claim to measure pronunciation accuracy; its role is to prompt recall, give the spoken model, and support an immediate repeat.

Microphone permission, audio-context health, and speech-synthesis availability still affect the workflow. Recording problems require a clear spoken prompt and an unfinished encounter, with no invented success or failure verdict. Failed question playback pauses the encounter and lets Hear it retry the same question; a failed Vosk model load affects grown-up tuning only.
