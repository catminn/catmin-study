import test from 'node:test';
import assert from 'node:assert/strict';
import {npcPublicCopySafe} from '../scripts/npc-public-copy-safety.mjs';

// Synthetic placeholders only: no real characters, dialogue, or director content.
const copy = text => ({text, relation:'neutral', approved:true});
const blocked = [
  ['canonical director marker', 'Before ⟦DG:demo⟧ after'],
  ['lowercase director marker', 'Before ⟦dg:demo⟧ after'],
  ['spaced director marker', 'Before ⟦ DG : demo ⟧ after'],
  ['unpaired left delimiter', 'Before ⟦ after'],
  ['unpaired right delimiter', 'Before ⟧ after'],
  ['fullwidth compatibility prefix', 'Before ⟦ＤＧ：demo⟧ after'],
  ['high surrogate without low surrogate', 'Before \ud83d after'],
  ['low surrogate without high surrogate', 'Before \udc00 after'],
  ['two high surrogates', 'Before \ud83d\ud83d after']
];
for (const [name, text] of blocked) {
  test('rejects ' + name, () => assert.equal(npcPublicCopySafe(copy(text)), false));
}
test('accepts legitimate paired surrogate emoji',()=>assert.equal(npcPublicCopySafe(copy('Emoji 🔑 accepted.')),true));
test('accepts legitimate ZWJ emoji sequence',()=>assert.equal(npcPublicCopySafe(copy('Emoji 👩‍🔬 accepted.')),true));
test('accepts ordinary ASCII brackets',()=>assert.equal(npcPublicCopySafe(copy('A [demo] response.')),true));
test('fixed boolean result cannot echo text',()=>{
  const payload=copy('Before ⟦dg:private-demo⟧ after');
  const before=JSON.stringify(payload), result=npcPublicCopySafe(payload);
  assert.equal(result,false);
  assert.equal(JSON.stringify(payload),before);
  assert.equal(typeof result,'boolean');
});
