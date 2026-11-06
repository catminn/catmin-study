import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneLearningFlow as check} from '../scripts/validate-scene-learning-flow.mjs';
// Entirely synthetic author fixtures. No formal world, NPC, clue, answer or private text.
const beat=(id,{end=false,teaches=[],offers=[],exits=[]}={})=>
  ({id,objectiveKey:id+'-goal',end,teaches,offers,exits});
const fixture=()=>({
  start:'demo-entry',skills:['demo-skill'],
  practices:[{id:'demo-practice',skillId:'demo-skill'}],
  nodes:[
    beat('demo-entry',{teaches:['demo-skill'],exits:['demo-left','demo-right']}),
    beat('demo-left',{offers:['demo-practice'],exits:['demo-join']}),
    beat('demo-right',{offers:['demo-practice'],exits:['demo-join']}),
    beat('demo-join',{exits:['demo-end']}),
    beat('demo-end',{end:true})
  ]
});
const reject=(m,code)=>assert.deepEqual(check(m),{ok:false,code});

test('complete one-skill chapter remains valid',()=>
  assert.deepEqual(check(fixture()),{ok:true,nodeCount:5,practiceCount:1}));
test('a declared second skill with no practice is not a phantom curriculum item',()=>{
  const m=fixture();m.skills.push('demo-second');reject(m,'skill_without_practice');
});
test('teaching a second skill without any corresponding practice still fails',()=>{
  const m=fixture();m.skills.push('demo-second');m.nodes[0].teaches.push('demo-second');
  reject(m,'skill_without_practice');
});
test('teaching the second skill at the ending cannot substitute for practice',()=>{
  const m=fixture();m.skills.push('demo-second');m.nodes[4].teaches.push('demo-second');
  reject(m,'skill_without_practice');
});
test('a second skill with its own taught and offered practice is valid',()=>{
  const m=fixture();m.skills.push('demo-second');
  m.practices.push({id:'demo-practice-two',skillId:'demo-second'});
  m.nodes[0].teaches.push('demo-second');m.nodes[1].offers.push('demo-practice-two');
  assert.deepEqual(check(m),{ok:true,nodeCount:5,practiceCount:2});
});
test('a branch-specific second skill and exercise are allowed',()=>{
  const m=fixture();m.skills.push('demo-second');
  m.practices.push({id:'demo-practice-two',skillId:'demo-second'});
  m.nodes[0].teaches.push('demo-second');m.nodes[2].offers.push('demo-practice-two');
  assert.equal(check(m).ok,true);
});
test('an unoffered exercise retains its more specific error',()=>{
  const m=fixture();m.skills.push('demo-second');
  m.practices.push({id:'demo-practice-two',skillId:'demo-second'});
  reject(m,'practice_unoffered');
});
test('an exercise offered without prior teaching retains its error',()=>{
  const m=fixture();m.skills.push('demo-second');
  m.practices.push({id:'demo-practice-two',skillId:'demo-second'});
  m.nodes[1].offers.push('demo-practice-two');
  reject(m,'practice_before_teaching');
});
test('one practice cannot count as coverage for two different skills',()=>{
  const m=fixture();m.skills.push('demo-second');m.nodes[0].teaches.push('demo-second');
  reject(m,'skill_without_practice');
});
test('repeated offers for one skill do not cover an unused skill',()=>{
  const m=fixture();m.skills.push('demo-second');m.nodes[3].offers.push('demo-practice');
  reject(m,'skill_without_practice');
});
test('fixed diagnostics do not reveal the missing skill ID',()=>{
  const m=fixture();m.skills.push('demo-private-placeholder');
  const out=check(m);reject(m,'skill_without_practice');
  assert.equal(JSON.stringify(out).includes('demo-private-placeholder'),false);
});
