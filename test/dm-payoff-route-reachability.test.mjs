import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDmPayoffRouteReachability as check} from '../scripts/validate-dm-payoff-route-reachability.mjs';

const flow = () => ({worldId:'demo-world',manifestRevision:'demo-r1',beats:[
  {id:'offer',type:'lesson_offer',applicationRef:'demo.application'},
  {id:'choice',type:'choice',next:['route-a','route-b']},
  {id:'route-a',type:'route',traceRef:'demo.trace-a',requiresCommit:true,eventType:'action_resolved'},
  {id:'route-b',type:'route',traceRef:'demo.trace-b',requiresCommit:true,eventType:'action_resolved'}]});
const actions = () => ({schema:'dungeon-skill-action-binding-v1',scope:'synthetic-mechanics-only',
  worldId:'demo-world',dungeonId:'demo-dungeon',manifestRevision:1,
  skills:[{chapter:0,skillId:'demo-target'}],bindings:[
    {actionKey:'demo-optional',baseActionKey:'demo-base',skillId:'demo-target',
      from:'demo-join',to:'demo-goal',advantage:'evidence_option'}]});
const graph = () => ({nodes:[
  {id:'demo-start',next:['demo-left','demo-right']},
  {id:'demo-left',next:['demo-join']},
  {id:'demo-right',next:['demo-join']},
  {id:'demo-join',next:['demo-goal']},
  {id:'demo-goal',next:[]}]});
const route = (which, entry) => ({routeBeatId:'route-'+which,
  traceRef:'demo.trace-'+which,entrySceneId:entry,goalSceneId:'demo-goal',
  actionKey:'demo-optional',baseActionKey:'demo-base',worldFrom:'demo-join',worldTo:'demo-goal'});
const proof = () => ({schemaVersion:'dm-payoff-route-reachability-v1',synthetic:true,
  worldId:'demo-world',dmRevision:'demo-r1',dungeonId:'demo-dungeon',
  actionRevision:1,lessonBeatId:'offer',applicationRef:'demo.application',
  skillId:'demo-target',chapterIndex:0,
  routes:[route('a','demo-left'),route('b','demo-right')]});
const val = (patch, key, factory) => patch && Object.hasOwn(patch,key) ? patch[key] : factory();
const run = patch => check(val(patch,'flow',flow),val(patch,'actions',actions),
  val(patch,'graph',graph),val(patch,'proof',proof));
const reject = (patch, code) => {
  const result = run(patch);
  assert.deepEqual(result,{ok:false,code});
  assert.equal(JSON.stringify(result).includes('demo-'),false);
};

test('both committed routes reach one shared optional knowledge payoff',() =>
  assert.deepEqual(run(),{ok:true,coveredRoutes:2}));
test('either branch may use the same reviewed action after convergence',() => {
  const p=proof();p.routes[1].entrySceneId='demo-start';
  assert.equal(run({proof:p}).ok,true);
});
test('orphan action source cannot masquerade as usable learning payoff',() => {
  const g=graph();g.nodes.push({id:'demo-orphan',next:['demo-goal']});
  const a=actions();a.bindings[0].from='demo-orphan';
  const p=proof();for(const r of p.routes)r.worldFrom='demo-orphan';
  reject({graph:g,actions:a,proof:p},'action_unreachable');
});
test('only one branch can reach action is insufficient',() => {
  const g=graph();g.nodes[2].next=['demo-goal'];
  reject({graph:g},'action_unreachable');
});
test('action must lead toward declared story goal',() => {
  const g=graph();g.nodes.push({id:'demo-dead',next:[]});
  g.nodes[3].next=['demo-dead'];
  const a=actions();a.bindings[0].to='demo-dead';
  const p=proof();for(const r of p.routes)r.worldTo='demo-dead';
  reject({graph:g,actions:a,proof:p},'goal_unreachable');
});
test('knowledge payoff reached only after story goal is not valid',() => {
  const g=graph();g.nodes[1].next=['demo-goal'];g.nodes[2].next=['demo-goal'];
  g.nodes[4].next=['demo-join'];
  reject({graph:g},'action_unreachable');
});
test('world loops are finite to traverse and may be valid',() => {
  const g=graph();g.nodes[1].next.push('demo-start');
  assert.equal(run({graph:g}).ok,true);
});
test('missing route proof is rejected',() => {
  const p=proof();p.routes.pop();reject({proof:p},'proof_invalid');
});
test('duplicate route proof is rejected',() => {
  const p=proof();p.routes[1]=structuredClone(p.routes[0]);
  reject({proof:p},'route_coverage_invalid');
});
test('uncommitted DM branch cannot pass',() => {
  const f=flow();f.beats[3].requiresCommit=false;
  reject({flow:f},'route_coverage_invalid');
});
test('route trace mismatch cannot pass',() => {
  const p=proof();p.routes[1].traceRef='demo.wrong';
  reject({proof:p},'route_coverage_invalid');
});
test('world revision mismatch cannot pass',() => {
  const p=proof();p.dmRevision='demo-other';
  reject({proof:p},'flow_scope_invalid');
});
test('action revision mismatch cannot pass',() => {
  const p=proof();p.actionRevision=2;
  reject({proof:p},'action_scope_invalid');
});
test('wrong chapter skill cannot pass',() => {
  const p=proof();p.skillId='demo-other';
  reject({proof:p},'action_unbound');
});
test('wrong registered base exit cannot pass',() => {
  const p=proof();p.routes[0].baseActionKey='demo-other';
  reject({proof:p},'action_unbound');
});
test('unregistered action cannot pass',() => {
  const p=proof();p.routes[0].actionKey='demo-other';
  reject({proof:p},'action_unbound');
});
test('broken world edge fails closed',() => {
  const g=graph();g.nodes[1].next=['demo-missing'];
  reject({graph:g},'graph_invalid');
});
test('duplicate world node fails closed',() => {
  const g=graph();g.nodes.push(structuredClone(g.nodes[0]));
  reject({graph:g},'graph_invalid');
});
test('hidden author-only fields are not silently accepted',() => {
  const p=proof();p.secretEnding='do-not-expose';
  reject({proof:p},'proof_invalid');
});
test('unknown route-level fields are not silently accepted',() => {
  const p=proof();p.routes[0].secretIdentity='do-not-expose';
  reject({proof:p},'proof_invalid');
});
test('no identifiers or hidden text appear in diagnostics',() => {
  const p=proof();p.routes[0].entrySceneId='secret-identity';
  const result=run({proof:p});
  assert.deepEqual(result,{ok:false,code:'action_unreachable'});
  assert.equal(JSON.stringify(result).includes('secret-identity'),false);
});
test('a missing graph never throws or passes',() =>
  reject({graph:null},'graph_invalid'));

test('duplicate DM beat IDs cannot select a favorable route shadow',() => {
  const f=flow();f.beats.push({...f.beats[2],requiresCommit:false});
  reject({flow:f},'flow_scope_invalid');
});
test('duplicate registered optional keys are rejected even if first matches',() => {
  const a=actions();a.bindings.push({...a.bindings[0],to:'demo-left'});
  reject({actions:a},'action_registry_invalid');
});
test('duplicate skill IDs are not an unambiguous chapter binding',() => {
  const a=actions();a.skills.push({chapter:1,skillId:'demo-target'});
  reject({actions:a},'action_registry_invalid');
});
test('duplicate chapter assignments are not an unambiguous registry',() => {
  const a=actions();a.skills.push({chapter:0,skillId:'demo-other'});
  reject({actions:a},'action_registry_invalid');
});
test('an optional action cannot be its own ordinary base action',() => {
  const a=actions();a.bindings[0].baseActionKey='demo-optional';
  const p=proof();for(const r of p.routes)r.baseActionKey='demo-optional';
  reject({actions:a,proof:p},'action_registry_invalid');
});
test('unknown advantage type cannot masquerade as a valid payoff',() => {
  const a=actions();a.bindings[0].advantage='auto_success';
  reject({actions:a},'action_registry_invalid');
});
test('unreviewed action binding metadata is rejected',() => {
  const a=actions();a.bindings[0].secretGate='private';
  reject({actions:a},'action_registry_invalid');
});
test('unreviewed action registry root fields are rejected',() => {
  const a=actions();a.privateOverride=true;
  reject({actions:a},'action_scope_invalid');
});
test('unreviewed world node gate cannot be silently treated as traversable',() => {
  const g=graph();g.nodes[1].requiresStudy=true;
  reject({graph:g},'graph_invalid');
});
test('unreviewed world graph root metadata cannot silently disappear',() => {
  const g=graph();g.secretRoute='private';
  reject({graph:g},'graph_invalid');
});
test('ordinary valid synthetic action remains optional after checks',() =>
  assert.deepEqual(run(),{ok:true,coveredRoutes:2}));
