import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDmEventGuardBridge as check} from '../scripts/validate-dm-event-guard-bridge.mjs';

// Synthetic IDs only. This tests cross-contract mapping, not either source validator.
function fixture() {
  const flow={worldId:'demo-world',manifestRevision:'demo-r1',beats:[
    {id:'decision',type:'choice',copySlot:'demo.decision',next:['route-a','route-b']},
    {id:'route-a',type:'route',traceRef:'demo.trace-a',copySlot:'demo.route-a'},
    {id:'route-b',type:'route',traceRef:'demo.trace-b',copySlot:'demo.route-b'},
    {id:'merge',type:'convergence',copySlot:'demo.merge',callbacks:[
      {traceRef:'demo.trace-a',copySlot:'demo.callback-a',requiresCommittedTrace:true},
      {traceRef:'demo.trace-b',copySlot:'demo.callback-b',requiresCommittedTrace:true}]}]};
  const guards={worldId:'demo-world',manifestRevision:'demo-r1',forkScene:'demo-fork',
    mergeScene:'demo-join',endScene:'demo-end',
    publicCopySlots:['demo.choice-a','demo.choice-b','demo.callback-a','demo.callback-b'],
    routes:['a','b'].map(s=>({choiceTransitionId:'demo.choice-'+s,
      callbackTransitionId:'demo.callback-'+s,routeFlag:'demo.flag-'+s,
      callbackFlag:'demo.done-'+s})),
    transitions:['a','b'].flatMap(s=>[
      {id:'demo.choice-'+s,mode:'commit',from:'demo-fork',to:'demo-join',
        eventRef:'demo.event-choice-'+s,copySlot:'demo.choice-'+s,
        effects:{set:['demo.flag-'+s]}},
      {id:'demo.callback-'+s,mode:'commit',from:'demo-join',to:'demo-end',
        eventRef:'demo.event-callback-'+s,copySlot:'demo.callback-'+s,
        guard:{all:['demo.flag-'+s]},effects:{set:['demo.done-'+s]}}])};
  const bridge={schemaVersion:'dm-event-guard-bridge-v1',synthetic:true,
    worldId:'demo-world',manifestRevision:'demo-r1',routes:['a','b'].map(s=>({
      routeBeatId:'route-'+s,traceRef:'demo.trace-'+s,
      choiceTransitionId:'demo.choice-'+s,choiceEventRef:'demo.event-choice-'+s,
      choiceCopySlot:'demo.choice-'+s,callbackTransitionId:'demo.callback-'+s,
      callbackEventRef:'demo.event-callback-'+s,callbackCopySlot:'demo.callback-'+s}))};
  return {flow,guards,bridge};
}
const reject=(x,code)=>{const r=check(x.flow,x.guards,x.bridge);
  assert.deepEqual(r,{ok:false,code});assert.doesNotMatch(JSON.stringify(r),/demo|secret|private/i);};
test('maps both committed routes and conditional callbacks',()=>{
  const x=fixture();assert.deepEqual(check(x.flow,x.guards,x.bridge),{ok:true,matchedRoutes:2});
});
test('route ordering is irrelevant',()=>{
  const x=fixture();x.bridge.routes.reverse();
  assert.deepEqual(check(x.flow,x.guards,x.bridge),{ok:true,matchedRoutes:2});
});
test('rejects swapped trace binding',()=>{const x=fixture();x.bridge.routes[1].traceRef='demo.trace-a';reject(x,'route_alias');});
test('rejects wrong trace with distinct ID',()=>{const x=fixture();x.bridge.routes[1].traceRef='secret-trace';reject(x,'dm_route_mismatch');});
test('rejects mismatched guard route',()=>{const x=fixture();x.guards.routes[1].callbackTransitionId='demo.callback-a';reject(x,'guard_route_mismatch');});
test('rejects wrong callback copy',()=>{const x=fixture();x.guards.transitions[3].copySlot='demo.choice-b';reject(x,'guard_route_mismatch');});
test('rejects uncommitted choice',()=>{const x=fixture();x.guards.transitions[0].mode='preview';reject(x,'guard_route_mismatch');});
test('rejects missing route flag condition',()=>{const x=fixture();x.guards.transitions[3].guard.all=[];reject(x,'guard_route_mismatch');});
test('rejects choice copy sharing an observation slot',()=>{const x=fixture();x.flow.beats.push({id:'observation',copySlot:'demo.choice-a'});reject(x,'stage_copy_collision');});
test('rejects unmatched callback slot',()=>{const x=fixture();x.bridge.routes[1].callbackCopySlot='demo.unknown';reject(x,'stage_copy_collision');});
test('rejects unreviewed bridge fields',()=>{const x=fixture();x.bridge.secret='secret';reject(x,'bridge_invalid');});
test('rejects scope mismatch',()=>{const x=fixture();x.guards.manifestRevision='secret-r2';reject(x,'scope_mismatch');});
test('rejects duplicate event references',()=>{const x=fixture();x.bridge.routes[1].choiceEventRef=x.bridge.routes[0].choiceEventRef;reject(x,'route_alias');});
test('rejects missing guard route',()=>{const x=fixture();x.guards.routes.pop();reject(x,'contracts_invalid');});
test('invalid input never throws or echoes',()=>{assert.deepEqual(check(null,null,null),{ok:false,code:'bridge_invalid'});});
