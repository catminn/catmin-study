import test from 'node:test';
import assert from 'node:assert/strict';
import {npcPublicCopySafe} from '../scripts/npc-public-copy-safety.mjs';

const base=()=>({text:'A cautious answer.',relation:'neutral',approved:true});
const rejected=(name,edit)=>test(name,()=>{const copy=base();edit(copy);assert.equal(npcPublicCopySafe(copy),false);});
test('approved plain text is eligible',()=>assert.equal(npcPublicCopySafe(base()),true));
test('valid heard and confirmed knowledge gates remain eligible',()=>{
  for(const tier of ['heard','confirmed'])assert.equal(npcPublicCopySafe({...base(),requiresNpcKnowledge:{factId:'demo-public',tier}}),true);
});
test('Unicode emoji, including ZWJ sequences, remain eligible',()=>assert.equal(npcPublicCopySafe({...base(),text:'A reply 👩‍🔬.'}),true));
test('1200 Unicode code points are allowed',()=>assert.equal(npcPublicCopySafe({...base(),text:'🗝'.repeat(1200)}),true));
rejected('copy must be author-approved',x=>x.approved=false);
rejected('rejects non-string public copy',x=>x.text={secret:'private'});
rejected('rejects arrays in place of text',x=>x.text=['unreviewed']);
rejected('rejects whitespace-only copy',x=>x.text='   ');
rejected('rejects text beyond 1200 code points',x=>x.text='🗝'.repeat(1201));
rejected('rejects line breaks and control characters',x=>x.text='Line one\nLine two');
rejected('rejects bidi control characters',x=>x.text='Safe\u202eunsafe');
rejected('rejects zero-width camouflage',x=>x.text='Safe\u200bunsafe');
rejected('rejects director expansion marker',x=>x.text='A line ⟦DG:pre:demo⟧');
rejected('rejects unknown metadata on public copy',x=>x.privateReason='hidden');
rejected('rejects malformed relation',x=>x.relation='');
rejected('rejects malformed knowledge gate',x=>x.requiresNpcKnowledge={factId:'demo-public',tier:'verified'});
rejected('rejects extra knowledge gate field',x=>x.requiresNpcKnowledge={factId:'demo-public',tier:'heard',secret:'hidden'});
test('null and array copies fail closed',()=>{for(const copy of [null,[],{},'text'])assert.equal(npcPublicCopySafe(copy),false);});
test('pure preflight does not mutate its input or echo values',()=>{
  const copy=base(),snapshot=JSON.stringify(copy);
  assert.equal(typeof npcPublicCopySafe(copy),'boolean');
  assert.equal(JSON.stringify(copy),snapshot);
});
