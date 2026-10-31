import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDmPayoffFullPreflight as check} from '../scripts/validate-dm-payoff-full-preflight.mjs';

// Synthetic-only author test. No formal story, NPC, hidden answer or real route ID.
const beat=(id,type,copySlot,next,extra={})=>({id,type,copySlot,next,...extra});
const flow=()=>({schemaVersion:'dm-beat-flow-v1',synthetic:true,
  worldId:'demo-world',manifestRevision:'demo-r1',start:'entry',end:'aftermath',
  beats:[
    beat('entry','entry','demo.entry',['observation']),
    beat('observation','observation','demo.observation',['lesson-offer'],
      {observationRef:'demo.visible-evidence'}),
    beat('lesson-offer','lesson_offer','demo.offer',['decision'],
      {anchorBeat:'observation',conceptId:'demo.math-concept',
       applicationRef:'demo.in-world-use',optional:true,mutatesWorld:false,
       requiresPass:false,skipTo:'decision',resumeTo:'decision'}),
    beat('decision','choice','demo.decision',['route-a','route-b']),
    beat('route-a','route','demo.route-a',['merge'],
      {traceRef:'demo.trace-a',requiresCommit:true,eventType:'action_resolved'}),
    beat('route-b','route','demo.route-b',['merge'],
      {traceRef:'demo.trace-b',requiresCommit:true,eventType:'action_resolved'}),
    beat('merge','convergence','demo.merge',['aftermath'],{callbacks:[
      {traceRef:'demo.trace-a',copySlot:'demo.callback-a',requiresCommittedTrace:true},
      {traceRef:'demo.trace-b',copySlot:'demo.callback-b',requiresCommittedTrace:true}]}),
    beat('aftermath','aftermath','demo.aftermath',[])]});
const node=(id,exits=[],teaches=[],offers=[],end=false)=>({
  id,objectiveKey:id+'-goal',teaches,offers,exits,end});
const chapter=()=>({start:'demo-start',skills:['demo-target'],
  practices:[{id:'demo-card',skillId:'demo-target'}],nodes:[
    node('demo-start',['demo-fork'],['demo-target']),
    node('demo-fork',['demo-left','demo-right']),
    node('demo-left',['demo-join'],[],['demo-card']),
    node('demo-right',['demo-join'],[],['demo-card']),
    node('demo-join',['demo-end']),node('demo-end',[],[],[],true)]});
const alignment=()=>({schemaVersion:'dm-knowledge-alignment-v1',synthetic:true,
  worldId:'demo-world',manifestRevision:'demo-r1',lessonBeatId:'lesson-offer',
  conceptId:'demo.math-concept',skillId:'demo-target',practiceIds:['demo-card']});
const worldGraph=()=>({nodes:[
  {id:'demo-world-entry',next:['demo-world-fork']},
  {id:'demo-world-route-b',next:['demo-world-fork']},
  {id:'demo-world-fork',next:['demo-world-left','demo-world-right']},
  {id:'demo-world-left',next:['demo-world-join']},
  {id:'demo-world-right',next:['demo-world-join']},
  {id:'demo-world-join',next:['demo-world-end']},
  {id:'demo-world-end',next:[]}]});
const actions=()=>({schema:'dungeon-skill-action-binding-v1',
  scope:'synthetic-mechanics-only',worldId:'demo-world',dungeonId:'demo-dungeon',
  manifestRevision:1,skills:[0,1,2,3].map(i=>({
    chapter:i,skillId:i===0?'demo-target':'demo-skill-'+i})),
  bindings:[
    {actionKey:'demo-action-0',baseActionKey:'demo-base-0',
      from:'demo-world-fork',to:'demo-world-left',skillId:'demo-target',
      advantage:'evidence_option'},
    {actionKey:'demo-action-1',baseActionKey:'demo-base-1',
      from:'demo-world-fork',to:'demo-world-right',skillId:'demo-skill-1',
      advantage:'risk_context'},
    {actionKey:'demo-action-2',baseActionKey:'demo-base-2',
      from:'demo-world-left',to:'demo-world-join',skillId:'demo-skill-2',
      advantage:'evidence_option'},
    {actionKey:'demo-action-3',baseActionKey:'demo-base-3',
      from:'demo-world-join',to:'demo-world-end',skillId:'demo-skill-3',
      advantage:'risk_context'}]});
const shared=()=>({worldId:'demo-world',dmRevision:'demo-r1',
  dungeonId:'demo-dungeon',actionRevision:1,lessonBeatId:'lesson-offer',
  applicationRef:'demo.in-world-use',skillId:'demo-target',chapterIndex:0});
const route=(s,entry)=>({routeBeatId:'route-'+s,traceRef:'demo.trace-'+s,
  entrySceneId:entry,goalSceneId:'demo-world-end',actionKey:'demo-action-0',
  baseActionKey:'demo-base-0',worldFrom:'demo-world-fork',worldTo:'demo-world-left'});
const fixture=()=>{
  const proof={schemaVersion:'dm-payoff-route-reachability-v1',synthetic:true,
    ...shared(),routes:[route('a','demo-world-entry'),
      route('b','demo-world-route-b')]};
  const links=proof.routes.map(({entrySceneId,goalSceneId,...r})=>({
    schemaVersion:'dm-learning-payoff-v1',synthetic:true,...shared(),...r}));
  return {flow:flow(),chapter:chapter(),alignment:alignment(),
    actions:actions(),worldGraph:worldGraph(),links,proof};
};
const reject=(x,code)=>{
  const result=check(x);assert.deepEqual(result,{ok:false,code});
  assert.doesNotMatch(JSON.stringify(result),/demo|secret|private/i);
};

test('real validators accept two complete optional learning routes',()=>{
  assert.deepEqual(check(fixture()),{ok:true,validatedLinks:2,validatedRoutes:2});
});
test('link ordering does not remove either route',()=>{
  const x=fixture();x.links.reverse();
  assert.deepEqual(check(x),{ok:true,validatedLinks:2,validatedRoutes:2});
});
test('cross-route trace mismatch fails first',()=>{
  const x=fixture();x.links[1].traceRef='demo.fake';
  reject(x,'cross_route_invalid');
});
test('second route skill mismatch is caught after first route passes',()=>{
  const x=fixture(),patch={actionKey:'demo-action-1',baseActionKey:'demo-base-1',
    worldFrom:'demo-world-fork',worldTo:'demo-world-right'};
  Object.assign(x.links[1],patch);Object.assign(x.proof.routes[1],patch);
  reject(x,'route_link_invalid');
});
test('second route world entry cannot bypass actual reachability',()=>{
  const x=fixture();x.proof.routes[1].entrySceneId='demo-world-right';
  reject(x,'route_reachability_invalid');
});
test('missing practice on one chapter branch is rejected',()=>{
  const x=fixture();x.chapter.nodes[2].offers=[];
  reject(x,'route_link_invalid');
});
test('invalid DM beat sequence cannot pass via a valid action registry',()=>{
  const x=fixture();x.flow.beats[0].next=['decision'];
  reject(x,'route_link_invalid');
});
test('unreviewed world gate is not assumed to be a free exit',()=>{
  const x=fixture();x.worldGraph.nodes[2].requiresStudy=true;
  reject(x,'route_reachability_invalid');
});
test('mismatched proof scope fails without exposing source text',()=>{
  const x=fixture();x.proof.applicationRef='secret-application';
  reject(x,'cross_route_invalid');
});
