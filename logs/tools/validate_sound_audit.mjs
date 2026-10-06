// Validate canonical sound annotations against the actual catalog and course.
// The active runtime course declares the required vocabulary.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { AUDIT } from './sound_audit_data.mjs';
import { WORD_COURSE_SOUND_AUDIT, RECORDED_SOUND_PHONEMES, SPOKEN_SOUND_PHONEMES } from './word_course_sound_data.mjs';
import { readWordCatalog, readWordSoundApi, ACTIVE_WORD_COURSE } from './reading_word_sound_api.mjs';

const options = new Set(process.argv.slice(2));
assert.equal(options.size, 0, 'Audit validation uses the active course without authoring switches.');
const catalog = readWordCatalog();
const catalogByDisplay = new Map(catalog.map(word => [word.display, word]));
const api = readWordSoundApi();
const focusWords = new Set(ACTIVE_WORD_COURSE.levels.flatMap(level => level.focusWords));
assert.equal(focusWords.size, 240, 'The course must contain its 240 authored words.');
assert.deepEqual(new Set(Object.keys(WORD_COURSE_SOUND_AUDIT)), focusWords, 'Course sound annotations must cover exactly the focus bank.');

function unitPosition(word, segments, key) {
  const match = /^(.*?)(?:#([1-9]\d*))?$/.exec(key);
  assert.ok(match, `${word}: malformed sound unit ${key}`);
  const unit = match[1], occurrence = match[2] ? Number(match[2]) : 1;
  const positions = segments.flatMap((segment, index) => segment === unit ? [index] : []);
  assert.ok(positions.length >= occurrence, `${word}: sound unit ${key} does not exist in its spelling groups.`);
  assert.ok(match[2] ? positions.length > 1 : positions.length === 1, `${word}: repeated sound units require positional keys.`);
  return positions[occurrence - 1];
}

let annotationCount = 0, courseUnits = 0, intentionalSpeechUnits = 0;
for (const [word, annotation] of Object.entries(AUDIT)) {
  if (word.startsWith('_')) continue;
  assert.ok(catalogByDisplay.has(word), `${word}: sound annotation has no catalog record.`);
  const segments = annotation.seg || api.segmentDisplay(word).map(unit => unit.toLowerCase());
  assert.equal(segments.join(''), word, `${word}: spelling groups must reproduce the exact word.`);
  const actionsByPosition = new Map();
  function claimAction(key, action) {
    const position = unitPosition(word, segments, key);
    assert.ok(!actionsByPosition.has(position), `${word}.${key}: conflicting sound actions.`);
    actionsByPosition.set(position, action);
    return position;
  }
  for (const [key, redirect] of Object.entries(annotation.over || {})) {
    assert.ok(Array.isArray(redirect) && redirect.length === 3 && redirect.every(value => typeof value === 'string' && value.length), `${word}.${key}: redirects require IPA, clip, and tag.`);
    const position = claimAction(key, 'recorded-sound');
    const [phoneme, annotatedClip] = redirect;
    const clipKey = annotatedClip.replace(/!$/, '');
    if (focusWords.has(word)) {
      assert.ok(existsSync(new URL(`../../audio/letters/${clipKey}.mp3`, import.meta.url)), `${word}.${key}: missing course clip ${clipKey}.`);
      assert.equal(RECORDED_SOUND_PHONEMES[clipKey], phoneme, `${word}.${key}: redirect IPA contradicts the recorded clip.`);
      assert.equal(annotation.phonemes[position], phoneme, `${word}.${key}: redirect IPA contradicts the authored word pronunciation.`);
    } else if (!annotatedClip.endsWith('!') && !['ue','ear'].includes(clipKey)) {
      assert.ok(existsSync(new URL(`../../audio/letters/${clipKey}.mp3`, import.meta.url)), `${word}.${key}: missing parked annotation clip ${clipKey}.`);
    }
  }
  for (const [key, text] of Object.entries(annotation.speech || {})) {
    const position = claimAction(key, 'speech');
    assert.ok(SPOKEN_SOUND_PHONEMES[text], `${word}.${key}: speech must name a declared real-word sound demonstration.`);
    assert.equal(annotation.phonemes[position], SPOKEN_SOUND_PHONEMES[text], `${word}.${key}: spoken sound contradicts the word pronunciation.`);
    intentionalSpeechUnits++;
  }
  for (const key of annotation.silent || []) {
    const position = claimAction(key, 'silent');
    if (focusWords.has(word)) assert.equal(annotation.phonemes[position], null, `${word}.${key}: silent group must have a null phoneme.`);
  }
  if (focusWords.has(word)) {
    assert.equal(annotation.phonemes.length, segments.length, `${word}: each spelling group requires an authored phoneme.`);
    for (const [position, segment] of segments.entries()) {
      const phoneme = annotation.phonemes[position];
      if (!actionsByPosition.has(position)) assert.equal(RECORDED_SOUND_PHONEMES[segment], phoneme, `${word}.${segment}: its default clip contradicts the authored pronunciation.`);
      if (phoneme === null) assert.equal(actionsByPosition.get(position), 'silent', `${word}.${segment}: null pronunciation requires an explicit silent group.`);
      if (!actionsByPosition.has(position)) assert.ok(existsSync(new URL(`../../audio/letters/${segment}.mp3`, import.meta.url)), `${word}.${segment}: missing default course clip.`);
    }
    courseUnits += segments.length;
  }
  annotationCount++;
}
console.log(`Validated ${annotationCount} canonical annotations; all ${focusWords.size} course words, ${courseUnits} spelling groups, ${intentionalSpeechUnits} intentional spoken sounds.`);
