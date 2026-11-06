import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmKnowledgeAlignment as check} from '../scripts/validate-dm-knowledge-alignment.mjs';

// Entirely synthetic. Never include real first-world plot, NPCs or solutions.
const flow=JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json',import.meta.url),'utf8'));
const node=(id,{teaches=[],offers=[],exits=[],end=false}={})=>
  ({id,objectiveKey:id+'-goal',teaches,offers,exits,end});
const base=()=>({start:'demo-start',skills:['demo-target'],
  practices:[{id:'demo-card',skillId:'demo-target'}],nodes:[
    node('demo-start',{teaches:['demo-target'],exits:['demo-fork']}),
    node('demo-fork',{exits:['demo-left','demo-right']}),
    node('demo-left',{offers:['demo-card'],exits:['demo-join']}),
    node('demo-right',{offers:['demo-card'],exits:['demo-join']}),
    node('demo-join',{exits:['demo-end']}),
    node('demo-end',{end:true})]});
const binding=()=>({schemaVersion:'dm-knowledge-alignment-v1',synthetic:true,
  worldId:'demo-world',manifestRevision:'demo-r1',lessonBeatId:'lesson-offer',
  conceptId:'demo.math-concept',skillId:'demo-target',practiceIds:['demo-card']});
const expectFail=(graph,b,code,limits)=>{
  const r=check(flow,graph,b,limits);
  assert.deepEqual(r,{ok:false,code});
  assert.equal(JSON.stringify(r).includes('demo.'),false);
};
const twoSkills=()=>{
  const g=base();g.skills.push('demo-early');
  g.practices.push({id:'demo-early-card',skillId:'demo-early'});
  g.nodes[0].teaches.push('demo-early');
  g.nodes[2].offers.push('demo-early-card');
  g.nodes[3].offers.push('demo-early-card');
  return g;
};

test('bound target concept has early teaching and practice on both paths',()=>
  assert.deepEqual(check(flow,base(),binding()),
    {ok:true,latestTargetTeachBeat:1,latestTargetPracticeBeat:3}));
test('explicit inclusive limits are accepted',()=>
  assert.equal(check(flow,base(),binding(),{teachBy:1,practiceBy:3}).ok,true));
test('unknown binding fields are rejected',()=>{
  const b=binding();b.hiddenScript='PRIVATE';expectFail(base(),b,'binding_invalid');
});
test('scope mismatch fails',()=>{
  const b=binding();b.manifestRevision='demo-other';expectFail(base(),b,'scope_mismatch');
});
test('wrong lesson beat fails',()=>{
  const b=binding();b.lessonBeatId='decision';expectFail(base(),b,'lesson_unbound');
});
test('wrong concept fails',()=>{
  const b=binding();b.conceptId='demo-other';expectFail(base(),b,'lesson_unbound');
});
test('missing target skill fails',()=>{
  const b=binding();b.skillId='demo-other';expectFail(base(),b,'target_catalog_mismatch');
});
test('card belonging to a different skill fails',()=>{
  const g=twoSkills(),b=binding();b.practiceIds=['demo-early-card'];
  expectFail(g,b,'target_catalog_mismatch');
});
test('duplicate or missing card binding fails',()=>{
  const b=binding();b.practiceIds=['demo-card','demo-card'];
  expectFail(base(),b,'binding_invalid');
});
test('an early unrelated lesson cannot conceal late target teaching',()=>{
  const g=twoSkills();
  g.nodes[0].teaches=['demo-early'];
  g.nodes[2].offers=['demo-early-card'];
  g.nodes[3].offers=['demo-early-card'];
  g.nodes[4].teaches=['demo-target'];
  g.nodes[4].exits=['demo-target-card'];
  g.nodes.push(node('demo-target-card',{offers:['demo-card'],exits:['demo-end']}));
  expectFail(g,binding(),'target_teaching_too_late');
});
test('an early unrelated practice cannot conceal late target practice',()=>{
  const g=twoSkills();
  g.nodes[2].offers=['demo-early-card'];g.nodes[3].offers=['demo-early-card'];
  g.nodes[4].exits=['demo-wait-1'];
  g.nodes.push(node('demo-wait-1',{exits:['demo-wait-2']}),
    node('demo-wait-2',{exits:['demo-wait-3']}),
    node('demo-wait-3',{exits:['demo-target-card']}),
    node('demo-target-card',{offers:['demo-card'],exits:['demo-end']}));
  expectFail(g,binding(),'target_practice_too_late');
});
test('target practice on only one route is not enough',()=>{
  const g=twoSkills();
  g.nodes[2].offers=['demo-early-card','demo-card'];
  g.nodes[3].offers=['demo-early-card'];
  expectFail(g,binding(),'target_practice_missing');
});
test('two distinct branch-local target cards are allowed',()=>{
  const g=base(),b=binding();
  g.practices.push({id:'demo-card-b',skillId:'demo-target'});
  g.nodes[3].offers=['demo-card-b'];
  b.practiceIds=['demo-card','demo-card-b'];
  assert.deepEqual(check(flow,g,b),
    {ok:true,latestTargetTeachBeat:1,latestTargetPracticeBeat:3});
});
test('unreviewed graph gates fail through the chapter validator',()=>{
  const g=base();g.nodes[1].requiresPass=true;
  expectFail(g,binding(),'chapter_invalid');
});
test('invalid limits fail without echo',()=>
  expectFail(base(),binding(),'limits_invalid',{teachBy:3,practiceBy:201}));
test('malformed DM beat sheet fails closed',()=>{
  const f=JSON.parse(JSON.stringify(flow));f.beats[0].next=['missing'];
  assert.deepEqual(check(f,base(),binding()),{ok:false,code:'dm_invalid'});
});
test('terminal-only target practice is not a valid opportunity',()=>{
  const g=base();g.nodes[2].offers=[];g.nodes[3].offers=[];
  g.nodes[5].offers=['demo-card'];expectFail(g,binding(),'chapter_invalid');
});
