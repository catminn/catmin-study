import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmBeatFlow as check} from '../scripts/validate-dm-beat-flow.mjs';
// Synthetic only: no real story, NPC identities, or answers.
const base=JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json',import.meta.url),'utf8'));
const copy=()=>structuredClone(base);
const beat=(g,id)=>g.beats.find(b=>b.id===id);
const reject=(g)=>{
  const r=check(g);
  assert.equal(r.ok,false);
  assert.ok(r.codes.includes('copy_slot_collision'),JSON.stringify(r));
  assert.deepEqual(Object.keys(r).sort(),['codes','errorCount','ok']);
  assert.equal(r.errorCount,r.codes.length);
  assert.equal(JSON.stringify(r).includes('demo.'),false);
};
test('all synthetic beat and callback slots are distinct',()=>assert.deepEqual(check(copy()),{ok:true,codes:[],errorCount:0}));
test('two narrative beats cannot share a slot',()=>{
  const g=copy();beat(g,'observation').copySlot=beat(g,'entry').copySlot;reject(g);
});
test('two committed route beats cannot share a response slot',()=>{
  const g=copy();beat(g,'route-b').copySlot=beat(g,'route-a').copySlot;reject(g);
});
test('callback cannot reuse an earlier observation slot',()=>{
  const g=copy();beat(g,'merge').callbacks[0].copySlot=beat(g,'observation').copySlot;reject(g);
});
test('callback cannot reuse an optional lesson slot',()=>{
  const g=copy();beat(g,'merge').callbacks[0].copySlot=beat(g,'lesson-offer').copySlot;reject(g);
});
test('callback cannot reuse a route consequence slot',()=>{
  const g=copy();beat(g,'merge').callbacks[0].copySlot=beat(g,'route-b').copySlot;reject(g);
});
test('callback cannot reuse the convergence slot',()=>{
  const g=copy();beat(g,'merge').callbacks[0].copySlot=beat(g,'merge').copySlot;reject(g);
});
test('duplicate callbacks retain the existing route-memory diagnostic',()=>{
  const g=copy();beat(g,'merge').callbacks[1].copySlot=beat(g,'merge').callbacks[0].copySlot;
  reject(g);assert.ok(check(g).codes.includes('missing_route_memory'));
});
test('distinct replacement slot is valid',()=>{
  const g=copy();beat(g,'observation').copySlot='demo.fresh-unique';assert.equal(check(g).ok,true);
});
test('malformed callback still fails closed',()=>{
  const g=copy();beat(g,'merge').callbacks[0]=null;assert.ok(check(g).codes.includes('callback_shape'));
});
test('collision diagnostics never echo private identifiers',()=>{
  const g=copy();beat(g,'entry').copySlot='demo-private-sentinel';
  beat(g,'observation').copySlot='demo-private-sentinel';reject(g);
  assert.equal(JSON.stringify(check(g)).includes('demo-private-sentinel'),false);
});
