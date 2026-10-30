import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneLearningFlow as check } from '../scripts/validate-scene-learning-flow.mjs';

// Pure demo graph. No formal-world plot, NPC identity, answers or hidden facts.
const beat = (id, {end=false, teaches=[], offers=[], exits=[]}={}) =>
  ({id, objectiveKey:`${id}-goal`, end, teaches, offers, exits});
const fixture = () => ({
  start:'demo-entry', skills:['demo-skill'],
  practices:[{id:'demo-practice',skillId:'demo-skill'}],
  nodes:[
    beat('demo-entry',{teaches:['demo-skill'],exits:['demo-left','demo-right']}),
    beat('demo-left',{offers:['demo-practice'],exits:['demo-join']}),
    beat('demo-right',{exits:['demo-join']}),
    beat('demo-join',{exits:['demo-end']}),
    beat('demo-end',{end:true})
  ]
});
const expectCode = (m, code) => assert.deepEqual(check(m),{ok:false,code});

test('one optional exercise on only one branch does not cover every story route',()=>
  expectCode(fixture(),'learning_path_missing'));
test('both branches may offer the same optional practice without requiring completion',()=>{
  const m=fixture();m.nodes[2].offers=['demo-practice'];
  assert.deepEqual(check(m),{ok:true,nodeCount:5,practiceCount:1});
});
test('a shared opportunity before a fork covers both routes',()=>{
  const m=fixture();m.nodes[0].offers=['demo-practice'];m.nodes[1].offers=[];
  assert.equal(check(m).ok,true);
});
test('a shared opportunity after a fork but before ending covers both routes',()=>{
  const m=fixture();m.nodes[1].offers=[];m.nodes[3].offers=['demo-practice'];
  assert.equal(check(m).ok,true);
});
test('terminal-only practice does not count as a pre-ending opportunity',()=>{
  const m=fixture();m.nodes[1].offers=[];m.nodes[4].offers=['demo-practice'];
  expectCode(m,'learning_path_missing');
});
test('an optional exercise on one ending does not cover an alternate ending',()=>{
  const m=fixture();m.nodes[1].exits=['demo-end'];m.nodes[2].exits=['demo-alt-end'];
  m.nodes.splice(3,1);m.nodes.push(beat('demo-alt-end',{end:true}));
  expectCode(m,'learning_path_missing');
});
test('different optional practice IDs may cover different routes',()=>{
  const m=fixture();m.practices.push({id:'demo-practice-2',skillId:'demo-skill'});
  m.nodes[2].offers=['demo-practice-2'];
  assert.deepEqual(check(m),{ok:true,nodeCount:5,practiceCount:2});
});
test('a practice must still be taught on every route to its offered beat',()=>{
  const m=fixture();m.nodes[0].teaches=[];m.nodes[1].teaches=['demo-skill'];
  m.nodes[3].offers=['demo-practice'];
  expectCode(m,'practice_before_teaching');
});
test('an unrelated branch with no practice still fails despite a rich other branch',()=>{
  const m=fixture();m.nodes[1].offers=['demo-practice'];m.nodes[2].exits=['demo-end'];
  expectCode(m,'learning_path_missing');
});
test('the fixed failure code never echoes authored node IDs',()=>{
  const m=fixture();m.nodes[2].objectiveKey='demo-private-placeholder';
  const out=check(m);assert.deepEqual(Object.keys(out),['ok','code']);
  assert.equal(JSON.stringify(out).includes('demo-private-placeholder'),false);
});
