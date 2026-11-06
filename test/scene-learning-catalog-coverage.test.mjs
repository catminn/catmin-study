import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneLearningFlow as check} from '../scripts/validate-scene-learning-flow.mjs';
// All identifiers are synthetic; no actual world, character, lesson or puzzle content.
const beat=(id,{end=false,teaches=[],offers=[],exits=[]}={})=>({id,objectiveKey:id+'-goal',end,teaches,offers,exits});
const fixture=()=>({
  start:'demo-entry',skills:['demo-skill'],
  practices:[{id:'demo-one',skillId:'demo-skill'}],
  nodes:[
    beat('demo-entry',{teaches:['demo-skill'],exits:['demo-left','demo-right']}),
    beat('demo-left',{offers:['demo-one'],exits:['demo-join']}),
    beat('demo-right',{offers:['demo-one'],exits:['demo-join']}),
    beat('demo-join',{exits:['demo-end']}),
    beat('demo-end',{end:true})
  ]
});
const add=(m,id='demo-two',skillId='demo-skill')=>m.practices.push({id,skillId});
const rejects=(m,code='practice_unoffered')=>assert.deepEqual(check(m),{ok:false,code});
test('a fully represented practice catalog is accepted',()=>assert.deepEqual(check(fixture()),{ok:true,nodeCount:5,practiceCount:1}));
test('unused second practice is rejected despite every route offering another',()=>{const m=fixture();add(m);rejects(m)});
test('unused practice for a second declared skill is rejected',()=>{const m=fixture();m.skills.push('demo-second-skill');add(m,'demo-two','demo-second-skill');rejects(m)});
test('a second practice offered before ending on a single branch is legitimate',()=>{const m=fixture();add(m);m.nodes[1].offers.push('demo-two');assert.equal(check(m).ok,true)});
test('a second practice offered before ending on both branches is legitimate',()=>{const m=fixture();add(m);m.nodes[1].offers.push('demo-two');m.nodes[2].offers.push('demo-two');assert.equal(check(m).ok,true)});
test('a practice offered only at the terminal beat is not a chapter opportunity',()=>{const m=fixture();add(m);m.nodes[4].offers.push('demo-two');rejects(m)});
test('an optional practice can be repeated at the ending if already offered earlier',()=>{const m=fixture();add(m);m.nodes[1].offers.push('demo-two');m.nodes[4].offers.push('demo-two');assert.equal(check(m).ok,true)});
test('a second practice must still have prior teaching on every path',()=>{const m=fixture();m.skills.push('demo-second-skill');add(m,'demo-two','demo-second-skill');m.nodes[3].offers.push('demo-two');rejects(m,'practice_before_teaching')});
test('a same-beat teaching-only practice still fails before catalog check',()=>{const m=fixture();m.nodes[0].teaches=[];m.nodes[1].teaches=['demo-skill'];m.nodes[2].teaches=['demo-skill'];rejects(m,'practice_before_teaching')});
test('duplicate catalog IDs keep their original rejection code',()=>{const m=fixture();add(m,'demo-one');rejects(m,'catalog_invalid')});
test('failure never echoes an unused opaque practice identifier',()=>{const m=fixture();add(m,'demo-private-placeholder');const out=check(m);assert.deepEqual(out,{ok:false,code:'practice_unoffered'});assert.equal(JSON.stringify(out).includes('demo-private-placeholder'),false)});
test('missing all offers keeps the learning_missing code',()=>{const m=fixture();m.nodes[1].offers=[];m.nodes[2].offers=[];rejects(m,'learning_missing')});
