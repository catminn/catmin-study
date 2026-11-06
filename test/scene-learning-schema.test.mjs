import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSceneLearningFlow as check } from '../scripts/validate-scene-learning-flow.mjs';
const fixture=()=>({start:'demo-entry',skills:['demo-skill'],practices:[{id:'demo-practice',skillId:'demo-skill'}],nodes:[
{id:'demo-entry',objectiveKey:'demo-goal-1',end:false,teaches:['demo-skill'],offers:[],exits:['demo-middle']},
{id:'demo-middle',objectiveKey:'demo-goal-2',end:false,teaches:[],offers:['demo-practice'],exits:['demo-end']},
{id:'demo-end',objectiveKey:'demo-goal-3',end:true,teaches:[],offers:[],exits:[]}
]});
const rejects=(mutator,code)=>{const m=fixture();mutator(m);assert.deepEqual(check(m),{ok:false,code});};
test('known complete author schema remains valid',()=>assert.deepEqual(check(fixture()),{ok:true,nodeCount:3,practiceCount:1}));
test('root metadata cannot silently change the graph interpretation',()=>rejects(m=>m.requiresPractice=true,'shape_invalid'));
test('root extra source metadata is not accepted by this narrow schema',()=>rejects(m=>m.storyVersion=2,'shape_invalid'));
test('root missing required key is rejected',()=>rejects(m=>delete m.skills,'shape_invalid'));
test('root hidden story gate cannot be ignored',()=>rejects(m=>m.progressionGate={practice:'demo-practice'},'shape_invalid'));
test('practice catalog cannot hide mandatory grading',()=>rejects(m=>m.practices[0].required=true,'catalog_invalid'));
test('practice catalog cannot hide additional unlocking rule',()=>rejects(m=>m.practices[0].unlockCondition='demo-practice','catalog_invalid'));
test('practice catalog extra source text is rejected without echo',()=>rejects(m=>m.practices[0].privateText='demo-private-placeholder','catalog_invalid'));
test('node cannot mark exit as requiring a practice',()=>rejects(m=>m.nodes[1].requiresPractice='demo-practice','node_invalid'));
test('node cannot hide gated exits in extra field',()=>rejects(m=>m.nodes[1].exitGates={'demo-end':'demo-practice'},'node_invalid'));
test('node cannot hide a verified-practice gate',()=>rejects(m=>m.nodes[1].requiresVerifiedPractice=true,'node_invalid'));
test('node cannot add optionality-overriding flag',()=>rejects(m=>m.nodes[1].practiceMandatory=true,'node_invalid'));
test('node extra objective prose rejected',()=>rejects(m=>m.nodes[1].objectiveText='demo-secret-placeholder','node_invalid'));
test('node missing required exits field rejected',()=>rejects(m=>delete m.nodes[1].exits,'node_invalid'));
test('fixed-code error does not echo metadata',()=>{const m=fixture();m.nodes[1].exitGates={secret:'demo-secret-placeholder'};const out=check(m);assert.deepEqual(out,{ok:false,code:'node_invalid'});assert.equal(JSON.stringify(out).includes('demo-secret-placeholder'),false)});
