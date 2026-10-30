import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneLearningFlow as check } from '../scripts/validate-scene-learning-flow.mjs';

// Synthetic IDs only. No first-world story, NPC, solution or private fact.
const fixture = () => ({
  start: 'demo-entry', skills: ['demo-skill'],
  practices: [{id:'demo-practice',skillId:'demo-skill'}],
  nodes: [
    {id:'demo-entry',objectiveKey:'demo-goal-1',end:false,teaches:[],offers:[],exits:['demo-a','demo-b']},
    {id:'demo-a',objectiveKey:'demo-goal-2',end:false,teaches:['demo-skill'],offers:[],exits:['demo-join']},
    {id:'demo-b',objectiveKey:'demo-goal-3',end:false,teaches:['demo-skill'],offers:[],exits:['demo-join']},
    {id:'demo-join',objectiveKey:'demo-goal-4',end:false,teaches:[],offers:['demo-practice'],exits:['demo-end']},
    {id:'demo-end',objectiveKey:'demo-goal-5',end:true,teaches:[],offers:[],exits:[]}
  ]
});
const mutate = fn => { const m=fixture(); fn(m); return m; };
const code = (m,c) => assert.deepEqual(check(m),{ok:false,code:c});
test('two routes teach before shared optional practice; story exit stays open',()=>{
  assert.deepEqual(check(fixture()),{ok:true,nodeCount:5,practiceCount:1});
});
test('one branch missing teaching cannot unlock practice at join',()=>code(mutate(m=>m.nodes[2].teaches=[]),'practice_before_teaching'));
test('practice on entry before teaching is rejected',()=>code(mutate(m=>m.nodes[0].offers=['demo-practice']),'practice_before_teaching'));
test('teaching in same beat precedes its optional practice',()=>{
  const m=mutate(m=>{m.nodes[1].offers=['demo-practice'];m.nodes[2].offers=['demo-practice'];m.nodes[3].offers=[];});
  assert.equal(check(m).ok,true);
});
test('a shared skill taught before fork is safe at join',()=>{
  const m=mutate(m=>{m.nodes[0].teaches=['demo-skill'];m.nodes[1].teaches=[];m.nodes[2].teaches=[];});
  assert.equal(check(m).ok,true);
});
test('a practice cannot reference an unregistered skill',()=>code(mutate(m=>m.practices[0].skillId='demo-unknown'),'catalog_invalid'));
test('a node cannot teach an unregistered skill',()=>code(mutate(m=>m.nodes[1].teaches=['demo-unknown']),'reference_invalid'));
test('a node cannot offer an unregistered practice',()=>code(mutate(m=>m.nodes[3].offers=['demo-unknown']),'reference_invalid'));
test('duplicate practice IDs are rejected',()=>code(mutate(m=>m.practices.push({...m.practices[0]})),'catalog_invalid'));
test('duplicate node IDs are rejected',()=>code(mutate(m=>m.nodes[1].id='demo-b'),'node_invalid'));
test('a future scene cannot be targeted without a defined node',()=>code(mutate(m=>m.nodes[0].exits.push('demo-future')),'exit_invalid'));
test('unreachable scene cannot silently ship',()=>code(mutate(m=>m.nodes.push({id:'demo-unused',objectiveKey:'demo-unused-goal',end:true,teaches:[],offers:[],exits:[]})),'unreachable_node'));
test('cycles are rejected by chapter-beat graph validator',()=>code(mutate(m=>{m.nodes[4].end=false;m.nodes[4].exits=['demo-entry'];m.nodes[0].exits.push('demo-safe-end');m.nodes.push({id:'demo-safe-end',objectiveKey:'demo-safe-goal',end:true,teaches:[],offers:[],exits:[]});}),'cycle_invalid'));
test('nonterminal node must retain a story-only exit',()=>code(mutate(m=>m.nodes[1].exits=[]),'exit_invalid'));
test('terminal node cannot require an additional transition',()=>code(mutate(m=>m.nodes[4].exits=['demo-entry']),'exit_invalid'));
test('at least one practice opportunity is required for learning-first chapter',()=>code(mutate(m=>m.nodes[3].offers=[]),'learning_missing'));
test('malformed null node fails closed without echoing its contents',()=>code(mutate(m=>m.nodes[1]=null),'node_invalid'));
test('invalid and magic IDs are rejected',()=>code(mutate(m=>m.nodes[0].id='__proto__'),'node_invalid'));
test('all failure outputs contain only a fixed code, not author metadata',()=>{
  const m=mutate(m=>{m.nodes[2].teaches=[];m.nodes[3].objectiveKey='demo-secret-placeholder';});
  assert.deepEqual(Object.keys(check(m)),['ok','code']);
  assert.equal(JSON.stringify(check(m)).includes('demo-secret-placeholder'),false);
});
