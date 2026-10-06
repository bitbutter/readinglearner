// Read the real app's static vocabulary and sound renderer without running
// startup, accessing progress, or opening a microphone.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

export const APP_SOURCE = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');
const courseSource = readFileSync(new URL('../../word-course.js', import.meta.url), 'utf8');
const courseDeclaration = courseSource.match(/const WORD_COURSE\s*=\s*([\s\S]*);\s*$/);
requireCondition(courseDeclaration, 'word-course.js must declare WORD_COURSE.');
export const ACTIVE_WORD_COURSE = runInNewContext('(' + courseDeclaration[1] + ')', Object.create(null), { timeout:1000 });

function requireCondition(condition, message) {
  if (!condition) throw new Error('Word sound tools: ' + message);
}

function readStaticArray(name) {
  const literal = APP_SOURCE.match(new RegExp(`const ${name}\\s*=\\s*(\\[[\\s\\S]*?^\\]);`, 'm'));
  requireCondition(literal, `${name} static array is missing.`);
  return runInNewContext(literal[1], Object.create(null), { timeout:1000 });
}

export function readWordCatalog() {
  const words = readStaticArray('WORDS_CONTENT');
  requireCondition(Array.isArray(ACTIVE_WORD_COURSE.additionalWords), 'WORD_COURSE.additionalWords is missing.');
  words.push(...ACTIVE_WORD_COURSE.additionalWords);
  const identities = new Set(), displays = new Set();
  for (const word of words) {
    // Existing identities are stable even when spelling differs (word:dont).
    requireCondition(typeof word.id === 'string' && word.id.startsWith('word:'), `unexpected identity for ${word.display}.`);
    requireCondition(!identities.has(word.id) && !displays.has(word.display), `duplicate catalog word ${word.display}.`);
    requireCondition(Array.isArray(word.accepted) && word.accepted.length > 0, `${word.display} has no accepted spellings.`);
    identities.add(word.id); displays.add(word.display);
  }
  return words;
}

export function generatedSoundTables() {
  return execFileSync(process.execPath, [fileURLToPath(new URL('./gen_sound_fixes.mjs', import.meta.url))], { encoding:'utf8' });
}

function soundElement(tag) {
  const classes = new Set();
  return {
    tagName:tag, children:[], dataset:{}, className:'', textContent:'',
    style:{ setProperty() {} },
    classList:{ add:name => classes.add(name), remove:name => classes.delete(name),
      toggle:(name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains:name => classes.has(name) },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {}, addEventListener() {},
  };
}

export function readWordSoundApi({ useAuthoredTable = false } = {}) {
  const start = APP_SOURCE.indexOf('// Isolated phonetic letter sounds');
  const end = APP_SOURCE.indexOf('function triggerSoundSpan', start);
  requireCondition(start >= 0 && end > start, 'the app sound-rendering section is missing.');
  let soundSource = APP_SOURCE.slice(start, end);
  if (useAuthoredTable) {
    const generated = generatedSoundTables();
    for (const name of ['SOUND_FIXES','EXCLUDED_WORDS']) {
      const definition = new RegExp(`^const ${name} = .*;$`, 'm');
      requireCondition(soundSource.match(definition) && generated.match(definition), `${name} table is missing.`);
      soundSource = soundSource.replace(definition, () => generated.match(definition)[0]);
    }
  }
  const appDocument = { createElement:soundElement, createDocumentFragment:() => soundElement('fragment') };
  return new Function('document', soundSource + `;return {
    LETTER_SOUNDS, DIGRAPH_TTS, TTS_EXTENDED, EXCLUDED_WORDS, SOUND_FIXES,
    SEGMENT_OVERRIDES, DIGIT_NAMES,
    MAGIC_E_CLIP, NOT_MAGIC_E, segmentDisplay, soundFallback,
    isCVCEShape, buildSoundUnitSpans
  };`)(appDocument);
}

export function renderedWordSounds(api, display) {
  return api.buildSoundUnitSpans(display).children.map(span => {
    const unit = span.textContent.toLowerCase();
    if (span.dataset.silent) return { unit, kind:'silent', tappable:span.classList.contains('tappable') };
    if (span.dataset.sound) return { unit, kind:'speech', text:span.dataset.sound,
      clipKey:span.dataset.clip, tappable:span.classList.contains('tappable') };
    return { unit, kind:'recorded-sound', clipKey:span.dataset.clip || unit,
      tappable:span.classList.contains('tappable') };
  });
}
