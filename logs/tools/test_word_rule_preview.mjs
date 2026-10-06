// Exercise the review page's actual lesson player, including stalled stages.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../plans/word-rule-preview.js', import.meta.url), 'utf8');
const course = JSON.parse(readFileSync(new URL('../../plans/word-levels-proposed.json', import.meta.url), 'utf8'));
function harness(options = {}) {
  const speech = [], sounds = [], deadlines = new Map(), windowEvents = new Map(), documentEvents = new Map();
  const buttons = course.levels.slice(0, 2).map(level => ({
    dataset:{ruleId:level.id}, textContent:'Listen to this rule', status:{textContent:''}, listeners:new Map(),
    setAttribute() {}, addEventListener(name, callback) { this.listeners.set(name, callback); },
    parentElement:{querySelector() { return this.status; }},
  }));
  buttons.forEach(button => { button.parentElement.status = button.status; });
  const controls = new Map(['word-search','phase-filter'].map(id => [id,{listeners:new Map(),addEventListener(name,callback){this.listeners.set(name,callback);}}]));
  let nextTimer = 0;
  const speechSynthesis = {speak(utterance){speech.push(utterance);},cancel(){}};
  class Speech {constructor(text){this.text=text;}}
  class Sound {
    constructor(url){this.url=url;this.paused=false;sounds.push(this);}
    play(){return options.clipReject ? Promise.reject(new Error('Audio blocked')) : Promise.resolve();}
    pause(){this.paused=true;}
  }
  const context = vm.createContext({
    console, window:{speechSynthesis,addEventListener(name,callback){windowEvents.set(name,callback);}},
    speechSynthesis,SpeechSynthesisUtterance:Speech,Audio:Sound,
    document:{hidden:false,querySelectorAll(){return buttons;},addEventListener(name,callback){documentEvents.set(name,callback);},
      getElementById(id){return id==='rule-preview-steps'?{textContent:JSON.stringify(Object.fromEntries(course.levels.map(level=>[level.id,level.rulePlaybackSteps])))}:controls.get(id);}},
    setTimeout(callback,ms){const id=++nextTimer;deadlines.set(id,{callback,ms});return id;},
    clearTimeout(id){deadlines.delete(id);},
  });
  vm.runInContext(source,context);
  return {buttons,speech,sounds,deadlines,windowEvents,documentEvents,controls,
    click:index=>buttons[index].listeners.get('click')(),
    endSpeech:()=>speech.at(-1).onend(),endSound:()=>sounds.at(-1).onended(),
    expire:()=>[...deadlines.values()][0].callback()};
}
const flush = async () => {for(let i=0;i<5;i++)await Promise.resolve();};

{
 const h=harness();const playing=h.click(0);h.endSpeech();await flush();
 assert.equal(h.sounds.length,1);assert.match(h.sounds[0].url,/a\.mp3/);
 h.endSound();await flush();assert.equal(h.speech[1].text,'cat. map.');
 h.endSpeech();await playing;assert.equal(h.buttons[0].status.textContent,'Finished');assert.equal(h.deadlines.size,0);
}
{
 const h=harness();const playing=h.click(0);h.endSpeech();await flush();const late=h.sounds[0].onended;
 h.windowEvents.get('pagehide')();late();await playing;
 assert.equal(h.speech.length,1);assert.equal(h.sounds[0].paused,true);assert.equal(h.deadlines.size,0);
}
{
 const h=harness();const old=h.click(0);const late=h.speech[0].onend;const current=h.click(1);
 late();await old;assert.equal(h.sounds.length,0);assert.equal(h.buttons[1].textContent,'Stop rule');
 h.endSpeech();await flush();assert.match(h.sounds[0].url,/e\.mp3/);h.click(1);await current;
}
{
 const h=harness({clipReject:true});const playing=h.click(0);h.endSpeech();await playing;
 assert.equal(h.speech.length,1);assert.match(h.buttons[0].status.textContent,/Audio blocked/);assert.equal(h.deadlines.size,0);
}
{
 const h=harness();const playing=h.click(0);h.expire();await playing;
 assert.match(h.buttons[0].status.textContent,/did not finish/);assert.equal(h.sounds.length,0);assert.equal(h.deadlines.size,0);
}
{
 const h=harness();const playing=h.click(0);h.endSpeech();await flush();const late=h.sounds[0].onended;
 h.expire();await playing;late();await flush();assert.equal(h.sounds[0].paused,true);
 assert.match(h.buttons[0].status.textContent,/did not finish/);assert.equal(h.speech.length,1);
}
{
 const h=harness();const playing=h.click(0);h.controls.get('word-search').listeners.get('input')();await playing;
 assert.equal(h.buttons[0].textContent,'Listen to this rule');assert.equal(h.deadlines.size,0);
}
console.log('7/7 review-page rule playback checks passed.');
