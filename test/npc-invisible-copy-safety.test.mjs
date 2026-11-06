import test from 'node:test';
import assert from 'node:assert/strict';
import {npcPublicCopySafe} from '../scripts/npc-public-copy-safety.mjs';

// Invented placeholder strings only; no first-world dialogue or identities.
const copy = text => ({text,relation:'neutral',approved:true});
const invisibleOnly = [
  ['combining grapheme joiner', '\u034f'],
  ['variation selector', '\ufe0f'],
  ['zero-width joiner', '\u200d'],
  ['Mongolian vowel separator', '\u180e'],
  ['invisible function application', '\u2061']
];
for (const [name, value] of invisibleOnly) {
  test('rejects invisible-only public copy: '+name,()=>assert.equal(npcPublicCopySafe(copy(value)),false));
}
for (const [name, value] of [
  ['combining grapheme joiner', '\u034f'],
  ['Mongolian vowel separator', '\u180e'],
  ['invisible function application', '\u2061'],
  ['deprecated bidi control', '\u206a']
]) {
  test('rejects invisible camouflage inside public copy: '+name,()=>assert.equal(npcPublicCopySafe(copy('Visible'+value+'text')),false));
}
test('retains normal emoji variation selector',()=>assert.equal(npcPublicCopySafe(copy('⚙️')),true));
test('retains normal ZWJ emoji',()=>assert.equal(npcPublicCopySafe(copy('👩‍🔬')),true));
test('retains Chinese public text',()=>assert.equal(npcPublicCopySafe(copy('你好，欢迎来到这里。')),true));
test('returns only boolean and does not mutate input',()=>{
  const x=copy('Visible\u034ftext'),before=JSON.stringify(x);
  assert.equal(npcPublicCopySafe(x),false);
  assert.equal(JSON.stringify(x),before);
});
