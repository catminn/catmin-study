import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {policy,initialState,projectDialogue,applyCommitted} from '../scripts/npc-testimony-reference.mjs';
import {validateDmNpcRouteBridge} from '../scripts/validate-dm-npc-route-bridge.mjs';

const flow=JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/dm-npc-route-synthetic-v1.json',import.meta.url)),'utf8'));
const binding={schemaVersion:'dm-npc-route-bridge-v1',synthetic:true,worldId:'demo-world',manifestRevision:'demo-r1',choiceBeatId:'demo-fork',convergenceBeatId:'demo-join',routeBindings:[
  {routeBeatId:'demo-route-a',npcRouteKey:'demo-a',traceRef:'demo.trace-a',callbackCopySlot:'demo.callback-a',dialogueCopyId:'demo-guarded'},
  {routeBeatId:'demo-route-b',npcRouteKey:'demo-b',traceRef:'demo.trace-b',callbackCopySlot:'demo.callback-b',dialogueCopyId:'demo-open'}
]};
const bridgePolicy=()=>{const p=structuredClone(policy);p.routes['demo-a'].trace='demo.trace-a';p.routes['demo-b'].trace='demo.trace-b';return p;};
const state=()=>initialState();
const rejectProjection=(name,change)=>test(name,()=>{
  const p=structuredClone(policy),s=state(),snapshot=JSON.stringify(s);
  change(p.publicCopies['demo-neutral']);
  assert.deepEqual(projectDialogue(s,'demo-neutral',p),{available:true,text:null});
  assert.equal(JSON.stringify(s),snapshot);
});
const rejectBridge=(name,change)=>test(name,()=>{
  const p=bridgePolicy();change(p.publicCopies['demo-open']);
  const result=validateDmNpcRouteBridge(flow,p,binding);
  assert.equal(result.ok,false);
  assert.ok(result.codes.includes('dialogue_unapproved'),JSON.stringify(result));
  assert.deepEqual(Object.keys(result).sort(),['codes','errorCount','ok']);
  assert.equal(JSON.stringify(result).includes('secret-marker'),false);
});

test('valid synthetic NPC and beat bridge remains accepted',()=>assert.equal(validateDmNpcRouteBridge(flow,bridgePolicy(),binding).ok,true));
test('ordinary neutral approved copy remains visible',()=>assert.equal(projectDialogue(state(),'demo-neutral').text,policy.publicCopies['demo-neutral'].text));
rejectProjection('non-string public copy cannot return an object',c=>c.text={private:'secret-marker'});
rejectProjection('director expansion marker is never returned',c=>c.text='Hello ⟦DG:pre:secret-marker⟧');
rejectProjection('unreviewed metadata is not a public field',c=>c.privateReason='secret-marker');
rejectProjection('invisible-only public copy fails closed',c=>c.text='\u200b');
rejectProjection('control characters cannot be projected',c=>c.text='Hello\nsecret-marker');
rejectProjection('oversized copy is withheld',c=>c.text='a'.repeat(1201));
rejectBridge('bridge refuses director placeholders even when approved',c=>c.text='Hello ⟦DG:pre:secret-marker⟧');
rejectBridge('bridge refuses object-valued public text',c=>c.text={private:'secret-marker'});
rejectBridge('bridge refuses unknown private metadata',c=>c.privateReason='secret-marker');
rejectBridge('bridge refuses bidi camouflage',c=>c.text='Hello\u202esecret-marker');
test('knowledge-gated copy remains available only after NPC confirmation',()=>{
  const s=state(),p=structuredClone(policy);
  assert.equal(projectDialogue(s,'demo-confirmed',p).text,null);
  const event={id:'demo-confirm-copy',source:'server',status:'committed',scope:structuredClone(s.scope),expectedVersion:0,type:'fact_verified',factId:'demo-public-fact',subject:'npc'};
  const out=applyCommitted(s,event,p);
  assert.equal(out.ok,true);
  assert.equal(projectDialogue(out.state,'demo-confirmed',p).text,p.publicCopies['demo-confirmed'].text);
});
