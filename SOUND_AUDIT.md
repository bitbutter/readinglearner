# Sound Audit — every word where a letter doesn't make its default sound

Date: 2026-10-30
Status: Audit complete, no code changed yet. Data lives in `logs/tools/sound_audit_data.mjs`, validated by `logs/tools/validate_sound_audit.mjs` (run: `node logs/tools/validate_sound_audit.mjs`).

## Why

The kid can't tell when a letter makes a non-standard sound (o as in *do* / *so* vs *cot*), and tapping the letter in the app always plays the default clip, which is wrong for 1 in 3 words in the vocabulary. This audit lists every such word, the correct sound, which existing audio clip covers it, and which clips are missing — the raw material for both the marker/tint feature and the correct-sound-on-tap fix.

## Headline numbers

- 285 words in the vocabulary (WORDS_CONTENT).
- **183 (64%) are fully decodable with default letter/team sounds** — nothing to do.
- **102 (36%) deviate** in 125 places.
- The deviations split into **21 pattern families** (~79 words) and **29 tricky words** (8 words have both).
- **5 new audio clips** would cover every missing sound. Everything else reuses existing clips in `audio/letters/`.

## The o question, answered

| word | o says | class | fix |
|---|---|---|---|
| so, no, go, goes, only | /oʊ/ (oh) | open syllable — vowel at the end says its name | `o` → `oa.mp3`, same tint treatment as magic-e |
| do, to | /uː/ (oo) | true exception | `o` → `oo.mp3`, tricky marker |
| cold, hold, both | /oʊ/ (oh) | -old/-oth family | `o` → `oa.mp3` |
| down, found, sound | part of ow /aʊ/ | ow team | re-segment to `ow` unit, new clip |
| was, wash | /ɒ/ | wa- family (a after w) | `a` → `o.mp3` |
| does, done | /ʌ/ (u) | true exception | `o` → `u.mp3` |
| door, floor | /ɔːr/ (or) | true exception | re-segment to `oo`, `oo` → `or.mp3` |
| book | /ʊ/ (short oo) | true exception | `oo` → new short-oo clip |
| tomorrow | (not in vocabulary) | — | stale SEGMENT_OVERRIDES entry |

So *so* vs *do* — the exact confusion that started this — is a pattern vs exception split: the marker design below treats them differently on purpose.

## Bugs in the current handling (found during the audit)

1. **`gave` and `came` are wrongly in `NOT_MAGIC_E`.** Both are regular magic-e words (/ɡeɪv/, /keɪm/); as listed, their final e is silent but the vowel never gets the long clip. Remove both from the set.
2. **`isCVCEShape` misses three shapes.** It requires exactly 4 segments ending in `e`, so: `write` and `place` (CCVCe, 5 segments) never get the long-vowel clip and their final e plays /ɛ/; `use` (VCe, 3 segments) same; `are`, `more`, `horse` (r-team + e) same — the e should be silent.
3. **`ea` is not a team** (deliberately excluded long ago), so read/tea/beat/clean/sea/teacher/weather play e then a as separate short letters. Six of those seven want ea=/iː/ (`ee.mp3`); weather wants /ɛ/.
4. **`school`:** the segmentation override correctly splits c-h, but the h unit then plays /h/. school is /skuːl/ — the h must be silent.
5. **Stale `SEGMENT_OVERRIDES` entries** for words no longer in the vocabulary: tomorrow, who, going, queen, wherever. Harmless, but confusing to maintain.

## Pattern families (~79 words)

These follow a teachable rule — recommend the magic-e style treatment (team tint, correct clip), **no** per-letter exclamation marker.

| family | sound | words (unit → clip) |
|---|---|---|
| open syllable | vowel says its name | baby.a→ay, he/she/be/we.e→ee, so/no/go/goes/only.o→oa, tiger.i→igh, use/music.u→ue, table.a→ay, paper.a→ay, idea.i→igh |
| final y | /i/ (ee) | baby, many, very, carry, only, family, body, city, story — y→ee |
| final y, 1 syllable | /aɪ/ | why, myself, try — y→igh |
| s says z | /z/ | is, was, always, because, does, goes, these, those, use, music — s→z |
| voiced th | /ð/ | the, their, these, those, together, mother, father, brother, weather — th→**NEW thv** |
| ea team | /iː/ | read, tea, beat, clean, sea, teacher — ea→ee (needs `ea` as a team unit) |
| -all / aw | /ɔː/ | always, call, fall, shall, small, wall (a→**NEW aw**); draw (aw unit→**NEW aw**) |
| ow says ow | /aʊ/ | down, around, found, about, mountain, sound — ou/ow unit→**NEW ow** |
| ow says oh | /oʊ/ | grow, own, show, window — o→oa, w silent |
| soft c | /s/ | place, face, music, city, pencil — c→s |
| soft g | /dʒ/ | page — g→j |
| -old/-oth | /oʊ/ | both, cold, hold — o→oa |
| -ind | /aɪ/ | kind — i→igh |
| r-controlled ur | /ɜːr/ | turn, hurt, burn — ur unit→er |
| wa- | /ɒ/ | was, wash (a→o); water (a→**NEW aw**) |
| magic-e (missed by shape rule) | — | write.i→igh (+w silent), place.a→ay (+soft c) |
| schwa /ə/ | unstressed vowel | around, about, today, together, mountain, because, before — →u/i clip (approximation, fine for phonics) |

## Tricky words (29 — the exclamation-marker set)

True exceptions: no rule reaches them, the marker + correct clip is the only help. These are the only words that need the "!"-style visual.

| word | deviation(s) | also silent |
|---|---|---|
| are | ar ✓, e silent | e |
| do, to | o→oo | — |
| door, floor | oo→or (re-segment to oo unit) | — |
| because | e→i, au→o, s→z | e |
| buy | uy→igh (re-segment) | — |
| does | o→u, s→z | e |
| goes | o→oa, s→z | e |
| many | a→e, y→ee | — |
| pull, full | u→**NEW oo-short** | — |
| would | ou→**NEW oo-short** (re-segment) | l |
| their | th→**NEW thv**, ei→air | r |
| work | or→er (re-segment to or unit) | — |
| done | o→u | e ✓ already silent |
| eight | eigh→ay (re-segment) | — |
| laugh | ugh→f (re-segment) | — |
| warm | a→**NEW aw** | — |
| people | eo→ee, le→l (re-segment) | — |
| mother, brother | o→u, th→**NEW thv** | — |
| school | h silent | h |
| father | a→o (approx), th→**NEW thv** | — |
| colour | o→u | u |
| book | oo→**NEW oo-short** | — |
| friend | ie→e (re-segment) | — |
| picture | t→ch, u→er | r, e |
| earth | ear→er (re-segment) | — |

## New clips needed (5)

| clip key | IPA | words covered | generator input |
|---|---|---|---|
| `thv` | /ð/ | the, their, these, those, together, mother, father, brother, weather (9) | voiced dental fricative, existing pipeline |
| `aw` | /ɔː/ | always, call, fall, shall, small, wall, draw, warm, water (9) | open-mid back rounded |
| `ow` | /aʊ/ | down, around, found, about, mountain, sound (6) | diphthong as in "now" |
| `ooshort` | /ʊ/ | book, pull, full, would (4) | near-close back rounded |
| `earnear` | /ɪər/ | year (1) | optional — TTS "ear" fallback already works |

Optional 6th: /ɑː/ for *father* (currently approximated with o). Everything else reuses existing clips — heaviest reuse: ee (20×), oa (12×), z (10×), u (10×), igh (8×).

## Accent notes

Audit is BrE-leaning (the app's vocabulary even uses *colour*). Judgement calls: `been` left clean (/biːn/ BrE; AmE /bɪn/), `was`→o clip (BrE /wɒz/), `water`→aw (BrE /ˈwɔːtə/), `father` approximated. Whole-word TTS for `read` may say past-tense /rɛd/ — worth checking the preview once.

## Design implications for the marker feature

- **Mark only the 29 tricky words** (10% of vocabulary). Patterns get the tint, like magic-e already does. If every deviation got a "!", 36% of words would carry one and it would stop meaning anything.
- The tint for a pattern unit should be **the same color as the team that owns the sound** (o in *so* wears oa's color; y in *city* wears ee's color) — reuses the visual language the app already taught.
- Data model: one table drives clip + tint + marker so audio and visuals can't drift: per-word `SOUND_OVERRIDES` (like `TEAM_SOUND_OVERRIDES`, generalized, with `x#2` positional keys for repeated letters) plus small generic pattern rules for open-syllable/soft-c/s-says-z where a rule is cleaner than 16 identical entries.
- `logs/tools/sound_audit_data.mjs` is already in the shape of that table — it can be the source of truth the app imports or is generated from.
