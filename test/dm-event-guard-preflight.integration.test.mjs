import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmBeatFlow} from '../scripts/validate-dm-beat-flow.mjs';
import {validateDmEventGuards} from '../scripts/validate-dm-event-guards.mjs';
import {validateDmEventGuardBridge} from '../scripts/validate-dm-event-guard-bridge.mjs';
import {validateDmEventGuardPreflight as preflight} from '../scripts/validate-dm-event-guard-preflight.mjs';

// All records are synthetic. No private story text or production IDs.
function fixture() {
  const flow=JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json',import.meta.url),'utf8'));
  const guards=JSON.parse(readFileSync(new URL('./fixtures/dm-event-guards-synthetic-v1.json',import.meta.url),'utf8'));
  for(const t of guards.transitions)
    if(t.id.startsWith('demo-callback-')) t.copySlot=t.copySlot.replace('callback-copy','callback');
  guards.publicCopySlots=guards.publicCopySlots.map(s=>s.replace('callback-copy','callback'));
  const bridge={schemaVersion:'dm-event-guard-bridge-v1',synthetic:true,
    worldId:flow.worldId,manifestRevision:flow.manifestRevision,
    routes:['a','b'].map(s=>({
      routeBeatId:'route-'+s,traceRef:'demo.trace-'+s,
      choiceTransitionId:'demo-choose-'+s,choiceEventRef:'demo.event-'+s,
      choiceCopySlot:'demo.choice-'+s,
      callbackTransitionId:'demo-callback-'+s,
      callbackEventRef:'demo.event-callback-'+s,
      callbackCopySlot:'demo.callback-'+s
    }))};
  return {flow,guards,bridge};
}
const run=x=>preflight(x.flow,x.guards,x.bridge);
const rejects=(x,code)=>{
  const result=run(x);
  assert.deepEqual(result,{ok:false,code});
  assert.doesNotMatch(JSON.stringify(result),/demo|secret|private|trace|event/i);
};

test('real three-validator chain accepts two committed synthetic routes',()=>{
  const x=fixture();
  assert.equal(validateDmBeatFlow(x.flow).ok,true);
  assert.equal(validateDmEventGuards(x.guards).ok,true);
  assert.equal(validateDmEventGuardBridge(x.flow,x.guards,x.bridge).ok,true);
  assert.deepEqual(run(x),{ok:true,matchedRoutes:2});
});
test('bridge route order is irrelevant',()=>{
  const x=fixture();x.bridge.routes.reverse();
  assert.deepEqual(run(x),{ok:true,matchedRoutes:2});
});
test('source validators pass but changed trace is rejected by bridge',()=>{
  const x=fixture();x.bridge.routes[1].traceRef='secret-trace';
  assert.equal(validateDmBeatFlow(x.flow).ok,true);
  assert.equal(validateDmEventGuards(x.guards).ok,true);
  rejects(x,'bridge_invalid');
});
test('source validators pass but callback event binding differs',()=>{
  const x=fixture();x.bridge.routes[1].callbackEventRef='secret-event';
  rejects(x,'bridge_invalid');
});
test('bridge cannot omit the second route',()=>{
  const x=fixture();x.bridge.routes.pop();rejects(x,'bridge_invalid');
});
test('bridge cannot smuggle extra fields',()=>{
  const x=fixture();x.bridge.secret='private';rejects(x,'bridge_invalid');
});
test('bridge scope must agree with both source contracts',()=>{
  const x=fixture();x.bridge.manifestRevision='demo-r2';rejects(x,'bridge_invalid');
});
test('guard validator rejects a choice without mutual exclusion even if bridge maps IDs',()=>{
  const x=fixture();x.guards.transitions[1].guard.none=[];
  assert.equal(validateDmEventGuardBridge(x.flow,x.guards,x.bridge).ok,true);
  assert.equal(validateDmEventGuards(x.guards).ok,false);
  rejects(x,'guard_plan_invalid');
});
test('guard validator rejects a callback without opposite-route exclusion',()=>{
  const x=fixture();x.guards.transitions[3].guard.none=[];
  rejects(x,'guard_plan_invalid');
});
test('guard validator rejects forged route flag on entry transition',()=>{
  const x=fixture();x.guards.transitions[0].effects.set=['demo.route-a'];
  rejects(x,'guard_plan_invalid');
});
test('guard validator rejects an unreviewed root field',()=>{
  const x=fixture();x.guards.secret='private';rejects(x,'guard_plan_invalid');
});
test('beat validator rejects an out-of-order observation even if bridge maps IDs',()=>{
  const x=fixture();x.flow.beats[1].next=['decision'];
  assert.equal(validateDmEventGuardBridge(x.flow,x.guards,x.bridge).ok,true);
  assert.equal(validateDmBeatFlow(x.flow).ok,false);
  rejects(x,'dm_flow_invalid');
});
test('beat validator rejects unreviewed story payload fields without echo',()=>{
  const x=fixture();x.flow.beats[0].secret='private';
  rejects(x,'dm_flow_invalid');
});
test('invalid flow fails before any guard or bridge approval',()=>{
  const x=fixture();x.flow=null;rejects(x,'dm_flow_invalid');
});
test('invalid guard fails before bridge approval',()=>{
  const x=fixture();x.guards=null;rejects(x,'guard_plan_invalid');
});
test('non-object bridge cannot be approved',()=>{
  const x=fixture();x.bridge=null;rejects(x,'bridge_invalid');
});
test('preflight does not mutate any of its inputs',()=>{
  const x=fixture(),before=JSON.stringify(x);
  assert.deepEqual(run(x),{ok:true,matchedRoutes:2});
  assert.equal(JSON.stringify(x),before);
});
