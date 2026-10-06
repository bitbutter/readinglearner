// Extract the actual live word catalog and rendered sound actions.
// node logs/tools/extract_words.mjs > logs/tools/word_segments.json
// Use --authored-table to review an unpublished sound-table edit.
import { readWordCatalog, readWordSoundApi, renderedWordSounds } from './reading_word_sound_api.mjs';

const options = new Set(process.argv.slice(2));
for (const option of options) {
  if (!['--authored-table'].includes(option)) throw new Error('Unknown extraction option: ' + option);
}
const words = readWordCatalog();
const api = readWordSoundApi({ useAuthoredTable:options.has('--authored-table') });
const extracted = words.map(word => {
  const sounds = renderedWordSounds(api, word.display);
  return {
    word:word.display, wordId:word.id, level:word.level,
    segs:sounds.map(sound => sound.unit),
    units:sounds.map(sound => ({ ...sound, plays:sound.kind === 'silent' ? '(silent)' :
      sound.kind === 'speech' ? 'speech:' + sound.text : sound.clipKey + '.mp3' })),
  };
});
console.log(JSON.stringify(extracted, null, 1));
console.error(`words: ${words.length}`);
