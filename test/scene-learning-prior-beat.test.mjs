import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneLearningFlow as check } from '../scripts/validate-scene-learning-flow.mjs';

// Demo-only graph: no actual world, characters, hidden facts or solutions.
const beat = (id, {end=false, teaches=[], offers=[], exits=[]}={}) =>
  ({id,objectiveKey:id+'-goal',end,teaches,offers,exits});
const base = () => ({
  start:'demo-entry',skills:['demo-skill'],
  practices:[{id:'demo-practice',skillId:'demo-skill'}],
  nodes:[
    beat('demo-entry',{teaches:['demo-skill'],exits:['demo-left','demo-right']}),
    beat('demo-left',{exits:['demo-join']}),
    beat('demo-right',{exits:['demo-join']}),
    beat('demo-join',{offers:['demo-practice'],exits:['demo-end']}),
    beat('demo-end',{end:true})
  ]
});
const rejected = (m,code='practice_before_teaching') => assert.deepEqual(check(m),{ok:false,code});

test('previous-beat teaching on all routes permits shared practice',()=>assert.equal(check(base()).ok,true));
test('teaching only in the same beat as its practice is not a proven prerequisite',()=>{
  const m=base();m.nodes[0].teaches=[];m.nodes[3].teaches=['demo-skill'];rejected(m);
});
test('a start beat cannot prove ordering of its own teaching and offer',()=>{
  const m=base();m.nodes[0].offers=['demo-practice'];rejected(m);
});
test('previous teaching remains valid when the practice beat also repeats the lesson',()=>{
  const m=base();m.nodes[3].teaches=['demo-skill'];assert.equal(check(m).ok,true);
});
test('one branch teaching only at the join does not count as prior teaching',()=>{
  const m=base();m.nodes[0].teaches=[];m.nodes[1].teaches=['demo-skill'];m.nodes[3].teaches=['demo-skill'];rejected(m);
});
test('teaching in each separate branch before the join is valid',()=>{
  const m=base();m.nodes[0].teaches=[];m.nodes[1].teaches=['demo-skill'];m.nodes[2].teaches=['demo-skill'];assert.equal(check(m).ok,true);
});
test('teaching only in the practice beat of each branch is rejected',()=>{
  const m=base();m.nodes[0].teaches=[];m.nodes[1].teaches=['demo-skill'];m.nodes[1].offers=['demo-practice'];m.nodes[2].teaches=['demo-skill'];m.nodes[2].offers=['demo-practice'];m.nodes[3].offers=[];rejected(m);
});
test('a preceding beat can teach, then a branch can practice immediately',()=>{
  const m=base();m.nodes[1].offers=['demo-practice'];m.nodes[2].offers=['demo-practice'];m.nodes[3].offers=[];assert.equal(check(m).ok,true);
});
test('an ending beat cannot rely on teaching inside itself',()=>{
  const m=base();m.nodes[0].teaches=[];m.nodes[3].offers=[];m.nodes[4].teaches=['demo-skill'];m.nodes[4].offers=['demo-practice'];rejected(m);
});
test('a multi-skill offer fails when even one skill is only taught in its own beat',()=>{
  const m=base();m.skills.push('demo-skill-two');m.practices.push({id:'demo-practice-two',skillId:'demo-skill-two'});
  m.nodes[3].teaches=['demo-skill-two'];m.nodes[3].offers.push('demo-practice-two');rejected(m);
});
test('a failure never echoes the authored objective or hidden placeholder',()=>{
  const m=base();m.nodes[0].teaches=[];m.nodes[3].teaches=['demo-skill'];m.nodes[3].objectiveKey='demo-private-placeholder';
  const result=check(m);assert.deepEqual(result,{ok:false,code:'practice_before_teaching'});
  assert.equal(JSON.stringify(result).includes('demo-private-placeholder'),false);
});
