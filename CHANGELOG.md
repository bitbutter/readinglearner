# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Google Cloud Speech-to-Text V2 `short` comparison against the same saved evaluator recordings, with separate per-model transcript and accuracy summaries.
- Speech recording dataset: original audio persists across reloads, every take remains available, and ZIP exports include individual audio files plus a versioned manifest.
- Google Cloud Chirp 3 transcription through a private-token-protected HTTPS speech server, plus a command to re-evaluate exported recordings. Google credentials stay on the server; expected words are omitted from recognition requests.
- Rule chips under the word: standing, tappable reminders for each teaching family a word belongs to (always visible, never fade); rule line spoken once when a family is first met, re-hearable on tap.
- Rule-block rounds (words set): easy wins open and close the round, ONE teaching family taught as a consecutive block (3 warm-up / 4 block / 3 close at round size 10); family with fewest attempts is taught; round-end praise names the rule when the block was cleared without a miss.
- Sound fixes for all 102 audited words (SOUND_AUDIT.md): correct clip on tap, silent letters, re-segmentations (ea/ur/ou/eigh/ugh/eo/le/ie/ei/ear), new clips thv/aw/ow/ooshort/earnear.
- 5 new phonics clips: thv (voiced th), aw, ow (down), ooshort (book), earnear (year).

### Fixed

- Empty speech recognition no longer earns correct answers from button-hold duration.
- Spoken "Matt" is accepted for "mat" in practice and the ASR evaluation; existing saved practice items receive the same correction.
- ASR evaluation records independently of browser speech recognition, including in Brave. Service errors leave saved audio intact and remain unscored.
- gave/came wrongly in NOT_MAGIC_E (they are regular magic-e words — vowel now plays the long clip).
- isCVCEShape misses: write/place (CCVCe), use (VCe), are/more/horse (r-team + e) — final e now silent, long-vowel/silent-letter fixes applied.
- ea was not a team: read/tea/beat/clean/sea/teacher/weather segmented and sounded as one unit.
- school's h played /h/ (now silent); stale SEGMENT_OVERRIDES entries removed; year's ear plays the new earnear clip.

### Changed

- Rule-breaker words (29, SOUND_AUDIT.md) excluded from practice and recaps for now; stored progress kept; reintroduction later = remove the filter.
- Level completion counts eligible words only; one-time forward-only migration promotes levels whose eligible words are all mastered — a child's level can never move backwards.
- Magic-e tap sounds: vowel plays long team sound, final e silent (#1)
