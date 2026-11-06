import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmLearningPayoff as check} from '../scripts/validate-dm-learning-payoff.mjs';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const flow=read('./fixtures/dm-beat-flow-synthetic-v1.json');
const node=(id,{teaches=[],offers=[],exits=[],end=false}={})=>
  ({id,objectiveKey:id+'-goal',teaches,offers,exits,end});
const chapter=()=>({start:'demo-start',skills:['demo-target'],
  practices:[{id:'demo-card',skillId:'demo-target'}],nodes:[
    node('demo-start',{teaches:['demo-target'],exits:['demo-fork']}),
    node('demo-fork',{exits:['demo-left','demo-right']}),
    node('demo-left',{offers:['demo-card'],exits:['demo-join']}),
    node('demo-right',{offers:['demo-card'],exits:['demo-join']}),
    node('demo-join',{exits:['demo-end']}),
    node('demo-end',{end:true})]});
const alignment=()=>({schemaVersion:'dm-knowledge-alignment-v1',synthetic:true,
  worldId:'demo-world',manifestRevision:'demo-r1',lessonBeatId:'lesson-offer',
  conceptId:'demo.math-concept',skillId:'demo-target',practiceIds:['demo-card']});
const worldGraph=()=>({nodes:[
  {id:'demo-world-entry',next:['demo-world-fork']},
  {id:'demo-world-fork',next:['demo-world-left','demo-world-right']},
  {id:'demo-world-left',next:['demo-world-join']},
  {id:'demo-world-right',next:['demo-world-join']},
  {id:'demo-world-join',next:['demo-world-end']},
  {id:'demo-world-end',next:[]}]});
const actions=()=>({schema:'dungeon-skill-action-binding-v1',
  scope:'synthetic-mechanics-only',worldId:'demo-world',dungeonId:'demo-dungeon',
  manifestRevision:1,
  skills:[0,1,2,3].map(i=>({chapter:i,skillId:i===0?'demo-target':'demo-skill-'+i})),
  bindings:[
    {actionKey:'demo-action-0',from:'demo-world-fork',to:'demo-world-left',
     skillId:'demo-target',baseActionKey:'demo-base-0',advantage:'evidence_option'},
    {actionKey:'demo-action-1',from:'demo-world-fork',to:'demo-world-right',
     skillId:'demo-skill-1',baseActionKey:'demo-base-1',advantage:'risk_context'},
    {actionKey:'demo-action-2',from:'demo-world-left',to:'demo-world-join',
     skillId:'demo-skill-2',baseActionKey:'demo-base-2',advantage:'evidence_option'},
    {actionKey:'demo-action-3',from:'demo-world-join',to:'demo-world-end',
     skillId:'demo-skill-3',baseActionKey:'demo-base-3',advantage:'risk_context'}]});
const link=()=>({schemaVersion:'dm-learning-payoff-v1',synthetic:true,
  worldId:'demo-world',dmRevision:'demo-r1',dungeonId:'demo-dungeon',
  actionRevision:1,lessonBeatId:'lesson-offer',applicationRef:'demo.in-world-use',
  skillId:'demo-target',chapterIndex:0,actionKey:'demo-action-0',
  baseActionKey:'demo-base-0',routeBeatId:'route-a',traceRef:'demo.trace-a',
  worldFrom:'demo-world-fork',worldTo:'demo-world-left'});
const run=(patch={})=>check(patch.flow??flow,patch.chapter??chapter(),
  patch.alignment??alignment(),patch.actions??actions(),
  patch.worldGraph??worldGraph(),patch.link??link());
const fails=(patch,code)=>{const result=run(patch);
  assert.deepEqual(result,{ok:false,code});
  assert.equal(JSON.stringify(result).includes('demo-'),false);};

test('optional DM concept links to a real skill-enhanced exit',()=>
  assert.deepEqual(run(),{ok:true,matchedApplications:1}));
test('hidden unreviewed link field is rejected',()=>{
  const x=link();x.privatePlot='do-not-expose';fails({link:x},'link_invalid')});
test('DM revision mismatch is rejected',()=>{
  const x=link();x.dmRevision='demo-other';fails({link:x},'scope_mismatch')});
test('action revision mismatch is rejected',()=>{
  const x=link();x.actionRevision=2;fails({link:x},'scope_mismatch')});
test('dungeon mismatch is rejected',()=>{
  const x=link();x.dungeonId='demo-other';fails({link:x},'scope_mismatch')});
test('lesson application must match actual DM reference',()=>{
  const x=link();x.applicationRef='demo-other';fails({link:x},'lesson_application_unbound')});
test('lesson beat must be the real optional offer',()=>{
  const x=link();x.lessonBeatId='observation';fails({link:x},'lesson_application_unbound')});
test('route trace must match committed DM branch',()=>{
  const x=link();x.traceRef='demo-other';fails({link:x},'route_unbound')});
test('route must be a committed choice branch',()=>{
  const x=link();x.routeBeatId='aftermath';fails({link:x},'route_unbound')});
test('action must use the DM-bound chapter skill',()=>{
  const x=link();x.skillId='demo-skill-1';fails({link:x},'chapter_skill_mismatch')});
test('action must exist in the registered optional actions',()=>{
  const x=link();x.actionKey='demo-other';fails({link:x},'skill_action_unbound')});
test('base nonacademic action identity must match',()=>{
  const x=link();x.baseActionKey='demo-other';fails({link:x},'skill_action_unbound')});
test('world source scene must match registered action',()=>{
  const x=link();x.worldFrom='demo-world-entry';fails({link:x},'skill_action_unbound')});
test('world target scene must match registered action',()=>{
  const x=link();x.worldTo='demo-world-right';fails({link:x},'skill_action_unbound')});
test('chapter index must be the one owning the skill',()=>{
  const x=link();x.chapterIndex=1;fails({link:x},'chapter_skill_mismatch')});
test('invalid DM sheet cannot pass through a valid link',()=>{
  const x=structuredClone(flow);x.beats[0].next=['missing'];
  fails({flow:x},'dm_invalid')});
test('late target teaching cannot pass through a valid link',()=>{
  const x=chapter();x.nodes[0].teaches=[];
  x.nodes[4].teaches=['demo-target'];fails({chapter:x},'chapter_alignment_invalid')});
test('unregistered world exit cannot pass through',()=>{
  const x=worldGraph();x.nodes[1].next=['demo-world-right'];
  fails({worldGraph:x},'action_binding_invalid')});
test('arbitrary scope flag cannot masquerade as synthetic',()=>{
  const x=actions();x.scope='production';fails({actions:x},'action_binding_invalid')});
test('no data is echoed from malformed private-like input',()=>{
  const x=link();x.applicationRef='secret-answer-key';
  assert.equal(JSON.stringify(run({link:x})).includes('secret-answer-key'),false)});
