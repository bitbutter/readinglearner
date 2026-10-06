// Check the real sound renderer against the complete authored word course.
// Use --authored-table only when reviewing an unpublished sound-table edit.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AUDIT } from './sound_audit_data.mjs';
import { WORD_COURSE_SOUND_AUDIT, RECORDED_SOUND_PHONEMES, SPOKEN_SOUND_PHONEMES } from './word_course_sound_data.mjs';
import { APP_SOURCE, ACTIVE_WORD_COURSE, readWordCatalog, readWordSoundApi,
  renderedWordSounds, generatedSoundTables } from './reading_word_sound_api.mjs';

const options = new Set(process.argv.slice(2));
for (const option of options) assert.ok(['--authored-table'].includes(option), 'Unknown sound test option: ' + option);
const api = readWordSoundApi({ useAuthoredTable:options.has('--authored-table') });
const catalog = readWordCatalog();
const catalogByDisplay = new Map(catalog.map(word => [word.display, word]));
const focusWords = new Set(ACTIVE_WORD_COURSE.levels.flatMap(level => level.focusWords));
assert.equal(focusWords.size, 240);
assert.deepEqual(new Set(Object.keys(WORD_COURSE_SOUND_AUDIT)), focusWords);

if (!options.has('--authored-table')) {
  const generated = generatedSoundTables();
  for (const name of ['SOUND_FIXES','EXCLUDED_WORDS']) {
    const definition = new RegExp(`^const ${name} = .*;$`, 'm');
    assert.equal(APP_SOURCE.match(definition)?.[0], generated.match(definition)?.[0], `${name}: live table differs from the canonical generator.`);
  }
}

let courseSoundCount = 0, recordedSoundCount = 0, spokenSoundCount = 0, silentGroupCount = 0;
for (const word of focusWords) {
  assert.ok(catalogByDisplay.has(word), `${word}: missing course word record.`);
  assert.ok(!api.EXCLUDED_WORDS.has(word), `${word}: a taught course word is still excluded.`);
  const expected = WORD_COURSE_SOUND_AUDIT[word];
  const rendered = renderedWordSounds(api, word);
  assert.deepEqual(rendered.map(sound => sound.unit), expected.seg, `${word}: displayed sound groups differ from authoring.`);
  assert.equal(expected.seg.join(''), word, `${word}: authored sound groups do not spell the word.`);
  assert.equal(rendered.length, expected.phonemes.length, `${word}: missing authored phoneme.`);
  for (const [index, sound] of rendered.entries()) {
    const phoneme = expected.phonemes[index];
    if (phoneme === null) {
      assert.equal(sound.kind, 'silent', `${word}.${sound.unit}: final E must be silent.`);
      silentGroupCount++;
    } else {
      assert.equal(sound.tappable, true, `${word}.${sound.unit}: the sound is not tappable.`);
      assert.notEqual(sound.kind, 'silent', `${word}.${sound.unit}: a spoken sound became silent.`);
      if (sound.kind === 'speech') {
        assert.equal(sound.clipKey, undefined, `${word}.${sound.unit}: intentional speech must clear an unused clip.`);
        assert.equal(SPOKEN_SOUND_PHONEMES[sound.text], phoneme, `${word}.${sound.unit}: spoken demonstration contradicts the authored phoneme.`);
        spokenSoundCount++;
      } else {
        assert.equal(RECORDED_SOUND_PHONEMES[sound.clipKey], phoneme, `${word}.${sound.unit}: rendered clip contradicts the authored phoneme.`);
        assert.ok(existsSync(new URL(`../../audio/letters/${sound.clipKey}.mp3`, import.meta.url)), `${word}.${sound.unit}: recorded sound is missing.`);
        recordedSoundCount++;
      }
    }
    courseSoundCount++;
  }
}

// Preserve the old parked annotations while validating redirects and silents
// with the app's actual position resolution. Parked words are not added to
// the new course or subjected to its active-only acoustic requirements.
let retainedAnnotationCount = 0;
for (const [word, annotation] of Object.entries(AUDIT)) {
  if (word.startsWith('_') || focusWords.has(word) || api.EXCLUDED_WORDS.has(word)) continue;
  const rendered = renderedWordSounds(api, word);
  const positionsByUnit = new Map();
  rendered.forEach((sound, position) => {
    if (!positionsByUnit.has(sound.unit)) positionsByUnit.set(sound.unit, []);
    positionsByUnit.get(sound.unit).push(position);
  });
  function soundForKey(key) {
    const [,unit,occurrence] = /^(.*?)(?:#(\d+))?$/.exec(key);
    const position = positionsByUnit.get(unit)?.[occurrence ? Number(occurrence) - 1 : 0];
    assert.notEqual(position, undefined, `${word}: missing retained unit ${key}.`);
    return rendered[position];
  }
  for (const [key, [,clip]] of Object.entries(annotation.over || {})) {
    const sound = soundForKey(key);
    assert.equal(sound.kind, 'recorded-sound', `${word}.${key}: retained redirect changed action.`);
    assert.equal(sound.clipKey, clip.replace(/!$/, ''), `${word}.${key}: retained clip changed.`);
  }
  for (const key of annotation.silent || []) assert.equal(soundForKey(key).kind, 'silent', `${word}.${key}: retained silence changed.`);
  retainedAnnotationCount++;
}

// The extractor must use the same renderer and retain apostrophe spellings
// and their original identities. The old regex silently omitted don't.
const extractionArgs = [...options];
const extracted = JSON.parse(execFileSync(process.execPath,
  [fileURLToPath(new URL('./extract_words.mjs', import.meta.url)), ...extractionArgs],
  { encoding:'utf8', stdio:['ignore','pipe','pipe'] }));
assert.equal(extracted.length, catalog.length, 'The sound extractor lost catalog records.');
assert.equal(extracted.find(word => word.word === "don't")?.wordId, 'word:dont', 'Apostrophe words must retain their stable identity.');
for (const word of focusWords) {
  const exported = extracted.find(record => record.word === word);
  assert.deepEqual(exported.segs, WORD_COURSE_SOUND_AUDIT[word].seg, `${word}: exported grouping differs from the live renderer.`);
}
console.log(`All ${focusWords.size} course words: ${courseSoundCount} sound groups (${recordedSoundCount} recorded, ${spokenSoundCount} intentional speech, ${silentGroupCount} silent).`);
console.log(`${retainedAnnotationCount} retained annotations verified; extractor preserves ${catalog.length} word records including apostrophes.`);
