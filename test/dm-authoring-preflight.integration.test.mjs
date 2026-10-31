import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmAuthoringPreflight as check} from '../scripts/validate-dm-authoring-preflight.mjs';

// Synthetic fixtures only. Never use a formal world's identities or text.
function fixture(){
  const flow=JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json',import.meta.url),'utf8'));
  const guards=JSON.parse(readFileSync(new URL('./fixtures/dm-event-guards-synthetic-v1.json',import.meta.url),'utf8'));
  for(const t of guards.transitions)
    if(t.id.startsWith('demo-callback-'))t.copySlot=t.copySlot.replace('callback-copy','callback');
  guards.publicCopySlots=guards.publicCopySlots.map(s=>s.replace('callback-copy','callback'));
  const bridge={schemaVersion:'dm-event-guard-bridge-v1',synthetic:true,
    worldId:flow.worldId,manifestRevision:flow.manifestRevision,
    routes:['a','b'].map(s=>({
      routeBeatId:'route-'+s,traceRef:'demo.trace-'+s,
      choiceTransitionId:'demo-choose-'+s,choiceEventRef:'demo.event-'+s,
      choiceCopySlot:'demo.choice-'+s,callbackTransitionId:'demo-callback-'+s,
      callbackEventRef:'demo.event-callback-'+s,callbackCopySlot:'demo.callback-'+s
    }))};
  const node=(id,exits=[],teaches=[],offers=[],end=false)=>({
    id,objectiveKey:id+'-goal',teaches,offers,exits,end});
  const chapter={start:'demo-start',skills:['demo-target'],
    practices:[{id:'demo-card',skillId:'demo-target'}],nodes:[
      node('demo-start',['demo-fork'],['demo-target']),
      node('demo-fork',['demo-left','demo-right']),
      node('demo-left',['demo-join'],[],['demo-card']),
      node('demo-right',['demo-join'],[],['demo-card']),
      node('demo-join',['demo-end']),node('demo-end',[],[],[],true)]};
  const alignment={schemaVersion:'dm-knowledge-alignment-v1',synthetic:true,
    worldId:'demo-world',manifestRevision:'demo-r1',lessonBeatId:'lesson-offer',
    conceptId:'demo.math-concept',skillId:'demo-target',practiceIds:['demo-card']};
  const worldGraph={nodes:[
    {id:'demo-world-entry',next:['demo-world-fork']},
    {id:'demo-world-route-b',next:['demo-world-fork']},
    {id:'demo-world-fork',next:['demo-world-left','demo-world-right']},
    {id:'demo-world-left',next:['demo-world-join']},
    {id:'demo-world-right',next:['demo-world-join']},
    {id:'demo-world-join',next:['demo-world-end']},
    {id:'demo-world-end',next:[]}]};
  const actions={schema:'dungeon-skill-action-binding-v1',
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
        advantage:'risk_context'}]};
  const shared={worldId:'demo-world',dmRevision:'demo-r1',
    dungeonId:'demo-dungeon',actionRevision:1,lessonBeatId:'lesson-offer',
    applicationRef:'demo.in-world-use',skillId:'demo-target',chapterIndex:0};
  const route=(s,entry)=>({routeBeatId:'route-'+s,traceRef:'demo.trace-'+s,
    entrySceneId:entry,goalSceneId:'demo-world-end',actionKey:'demo-action-0',
    baseActionKey:'demo-base-0',worldFrom:'demo-world-fork',worldTo:'demo-world-left'});
  const proof={schemaVersion:'dm-payoff-route-reachability-v1',synthetic:true,
    ...shared,routes:[route('a','demo-world-entry'),route('b','demo-world-route-b')]};
  const links=proof.routes.map(({entrySceneId,goalSceneId,...r})=>({
    schemaVersion:'dm-learning-payoff-v1',synthetic:true,...shared,...r}));
  return {flow,guards,bridge,chapter,alignment,actions,worldGraph,links,proof};
}
function rejects(x,code){
  const result=check(x);
  assert.deepEqual(result,{ok:false,code});
  assert.doesNotMatch(JSON.stringify(result),/demo|secret|private|trace/i);
}
test('real validators approve a shared synthetic two-route authoring sheet',()=>{
  assert.deepEqual(check(fixture()),{ok:true,validatedRoutes:2,validatedLinks:2});
});
test('route order does not matter',()=>{
  const x=fixture();x.bridge.routes.reverse();x.links.reverse();x.proof.routes.reverse();
  assert.deepEqual(check(x),{ok:true,validatedRoutes:2,validatedLinks:2});
});
test('missing root field fails closed',()=>{const x=fixture();delete x.guards;rejects(x,'input_invalid');});
test('extra root field fails closed',()=>{const x=fixture();x.secret='private';rejects(x,'input_invalid');});
test('non-object root fails closed',()=>rejects(null,'input_invalid'));
test('invalid event guard fails before payoff approval',()=>{
  const x=fixture();x.guards.transitions[1].guard.none=[];rejects(x,'event_guard_invalid');
});
test('invalid bridge fails before payoff approval',()=>{
  const x=fixture();x.bridge.routes[1].callbackEventRef='secret';
  rejects(x,'event_guard_invalid');
});
test('invalid second-route payoff fails even if event guards pass',()=>{
  const x=fixture();x.links[1].traceRef='secret';rejects(x,'learning_payoff_invalid');
});
test('unreachable world action fails even if event guards pass',()=>{
  const x=fixture();x.proof.routes[1].entrySceneId='demo-world-right';
  rejects(x,'learning_payoff_invalid');
});
test('missing practice on one learning branch fails',()=>{
  const x=fixture();x.chapter.nodes[2].offers=[];rejects(x,'learning_payoff_invalid');
});
test('cross-route identity cannot be silently substituted',()=>{
  const x=fixture();x.bridge.routes[1].traceRef='secret';rejects(x,'event_guard_invalid');
});
test('does not mutate any input',()=>{
  const x=fixture(),before=JSON.stringify(x);
  assert.deepEqual(check(x),{ok:true,validatedRoutes:2,validatedLinks:2});
  assert.equal(JSON.stringify(x),before);
});
