import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDmWorldRouteEntryBridge as check} from '../scripts/validate-dm-world-route-entry-bridge.mjs';

// Every identifier below is invented; no formal world or NPC content is used.
const fixture = () => {
  const world = {packageId:'demo-world',visibility:'mechanics_only',nodes:[
    {id:'demo.entry',role:'orientation',next:['demo.choice']},
    {id:'demo.choice',next:['demo.a','demo.b']},
    {id:'demo.a',next:['demo.join'],learning:'demo.concept-a'},
    {id:'demo.b',next:['demo.join'],learning:'demo.concept-b'},
    {id:'demo.join',next:['demo.end']},
    {id:'demo.end',next:[]}]};
  const commit = s => ({id:'demo.event-'+s,from:'demo.choice',to:'demo.'+s,
    cause:{type:'scene_entered',sceneId:'demo.'+s,requiresCommittedTransition:true},
    effect:{type:'set_flag',target:'route_trace',value:s},repeatPolicy:'once_per_world'});
  const causal = {schema:'world01-causal-authoring-v1',scope:'synthetic-mechanics-only',worldId:'demo-world',
    routeCommits:[commit('a'),commit('b')],
    npcContinuity:{actorRef:'demo.actor',initial:{location:'demo.choice',availability:'available',relation:'neutral',claimTier:'unverified'},
      claimPromotion:'only_authorized_fact_discovery',transitions:[
        {onCommitted:'demo.event-a',set:{relation:'demo.guarded'}},
        {onCommitted:'demo.event-b',set:{relation:'demo.open'}}]},
    convergence:{scene:'demo.join',preserve:['route_trace','npc_relation','committed_event_ids'],
      routeOutcomes:[{routeTrace:'a',npcRelation:'demo.guarded'},{routeTrace:'b',npcRelation:'demo.open'}]},
    learning:{scenes:['demo.a','demo.b'],requiresPlayerConsent:true,allowsNonAcademicProgress:true,
      fabricateMeasurements:false,narrationMayCommitEffects:false},
    publicProjection:{source:'committed_state_only',claimTierWithoutDiscovery:'unverified',
      exposeInternalIds:false,exposeUncommittedConsequences:false}};
  const flow = {worldId:'demo-world',manifestRevision:'demo-r1',beats:[
    {id:'offer',type:'lesson_offer',applicationRef:'demo.application'},
    {id:'choice',type:'choice',next:['route-a','route-b']},
    {id:'route-a',type:'route',traceRef:'demo.trace-a',requiresCommit:true,eventType:'action_resolved'},
    {id:'route-b',type:'route',traceRef:'demo.trace-b',requiresCommit:true,eventType:'action_resolved'}]};
  const actions = {schema:'dungeon-skill-action-binding-v1',scope:'synthetic-mechanics-only',
    worldId:'demo-world',dungeonId:'demo-dungeon',manifestRevision:1,
    skills:[{chapter:0,skillId:'demo.target'}],bindings:[
      {actionKey:'demo.optional',baseActionKey:'demo.base',skillId:'demo.target',
        from:'demo.join',to:'demo.end',advantage:'evidence_option'}]};
  const graph = {nodes:world.nodes.map(n => ({id:n.id,next:[...n.next]}))};
  const route = s => ({routeBeatId:'route-'+s,traceRef:'demo.trace-'+s,
    entrySceneId:'demo.'+s,goalSceneId:'demo.end',actionKey:'demo.optional',
    baseActionKey:'demo.base',worldFrom:'demo.join',worldTo:'demo.end'});
  const proof = {schemaVersion:'dm-payoff-route-reachability-v1',synthetic:true,
    worldId:'demo-world',dmRevision:'demo-r1',dungeonId:'demo-dungeon',actionRevision:1,
    lessonBeatId:'offer',applicationRef:'demo.application',skillId:'demo.target',chapterIndex:0,
    routes:[route('a'),route('b')]};
  const bridge = {schemaVersion:'dm-world-route-entry-bridge-v1',synthetic:true,
    worldId:'demo-world',dmRevision:'demo-r1',routeBindings:[
      {routeBeatId:'route-a',routeCommitId:'demo.event-a',traceRef:'demo.trace-a'},
      {routeBeatId:'route-b',routeCommitId:'demo.event-b',traceRef:'demo.trace-b'}]};
  return {world,causal,flow,actions,graph,proof,bridge};
};
const run = x => check(x.world,x.causal,x.flow,x.actions,x.graph,x.proof,x.bridge);
const reject = (x,code) => {
  const result = run(x);
  assert.deepEqual(result,{ok:false,code});
  assert.doesNotMatch(JSON.stringify(result),/demo|private|secret/i);
};

test('two route entries are grounded in committed world branches',() => {
  const x=fixture(),before=JSON.stringify(x);
  assert.deepEqual(run(x),{ok:true,validatedRoutes:2});
  assert.equal(JSON.stringify(x),before);
});
test('route and commit registration order does not matter',() => {
  const x=fixture();x.bridge.routeBindings.reverse();x.causal.routeCommits.reverse();
  assert.deepEqual(run(x),{ok:true,validatedRoutes:2});
});
test('reachable but invented pre-choice entry cannot pass bridge',() => {
  const x=fixture();x.proof.routes[1].entrySceneId='demo.entry';
  reject(x,'route_binding_mismatch');
});
test('a route cannot borrow the other branch entry',() => {
  const x=fixture();x.proof.routes[0].entrySceneId='demo.b';
  reject(x,'route_binding_mismatch');
});
test('swapped route-to-commit assertions fail',() => {
  const x=fixture();x.bridge.routeBindings[0].routeCommitId='demo.event-b';
  x.bridge.routeBindings[1].routeCommitId='demo.event-a';
  reject(x,'route_binding_mismatch');
});
test('a fake extra world graph edge cannot create reachability',() => {
  const x=fixture();x.graph.nodes[2].next.push('demo.end');
  reject(x,'projection_mismatch');
});
test('a fabricated world graph scene is rejected',() => {
  const x=fixture();x.graph.nodes.push({id:'demo.orphan',next:[]});
  reject(x,'projection_mismatch');
});
test('a reordered graph with identical exits is allowed',() => {
  const x=fixture();x.graph.nodes.reverse();x.graph.nodes[4].next.reverse();
  assert.deepEqual(run(x),{ok:true,validatedRoutes:2});
});
test('duplicate bridge route mapping is rejected',() => {
  const x=fixture();x.bridge.routeBindings[1].routeBeatId='route-a';
  reject(x,'bridge_invalid');
});
test('bridge cannot invent a trace reference',() => {
  const x=fixture();x.bridge.routeBindings[1].traceRef='demo.other';
  reject(x,'route_binding_mismatch');
});
test('bridge revision must match both source contracts',() => {
  const x=fixture();x.bridge.dmRevision='demo.other';
  reject(x,'scope_mismatch');
});
test('unreviewed bridge metadata fails closed',() => {
  const x=fixture();x.bridge.extra='not-approved';
  reject(x,'bridge_invalid');
});
test('broken world causal contract cannot be laundered through bridge',() => {
  const x=fixture();x.causal.learning.allowsNonAcademicProgress=false;
  reject(x,'world_contract_invalid');
});
test('unreachable optional payoff fails before cross-contract binding',() => {
  const x=fixture();x.proof.routes[0].worldFrom='demo.entry';
  reject(x,'payoff_contract_invalid');
});
