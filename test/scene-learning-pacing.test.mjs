import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneLearningPacing as check} from '../scripts/validate-scene-learning-pacing.mjs';

// Invented author beats only. No real-world story, NPC, solution or private fact.
const beat=(id,{teaches=[],offers=[],exits=[],end=false}={})=>
  ({id,objectiveKey:id+'-goal',teaches,offers,exits,end});
const base=()=>({start:'demo-start',skills:['demo-skill'],
  practices:[{id:'demo-card',skillId:'demo-skill'}],nodes:[
    beat('demo-start',{teaches:['demo-skill'],exits:['demo-fork']}),
    beat('demo-fork',{exits:['demo-left','demo-right']}),
    beat('demo-left',{offers:['demo-card'],exits:['demo-join']}),
    beat('demo-right',{offers:['demo-card'],exits:['demo-join']}),
    beat('demo-join',{exits:['demo-end']}),
    beat('demo-end',{end:true})]});
const extra=(g,branch,count)=>{
  const n=g.nodes.find(n=>n.id===branch);
  const old=n.offers;
  n.offers=[];
  const end=n.exits[0];
  let next=end;
  for(let i=count;i>=1;i--){const id=branch+'-wait-'+i;
    g.nodes.push(beat(id,{offers:i===count?old:[],exits:[next]}));next=id;}
  n.exits=[next];
  return g;
};
const reject=(g,code,limits)=>assert.deepEqual(check(g,limits),{ok:false,code});

test('first teaching and practice are bounded on both story branches',()=>
  assert.deepEqual(check(base()),{ok:true,latestTeachBeat:1,latestPracticeBeat:3}));
test('the limit is inclusive',()=>
  assert.deepEqual(check(base(),{teachBy:1,practiceBy:3}),{ok:true,latestTeachBeat:1,latestPracticeBeat:3}));
test('a stricter practice limit rejects an otherwise valid learning graph',()=>
  reject(base(),'practice_too_late',{teachBy:1,practiceBy:2}));
test('a stricter teaching limit rejects a valid delayed lesson',()=>{
  const g=base();g.nodes[0].teaches=[];g.nodes[1].teaches=['demo-skill'];
  reject(g,'teaching_too_late',{teachBy:1,practiceBy:6});
});
test('an overlong alternate route cannot hide behind the short route',()=>{
  const g=extra(base(),'demo-right',4);reject(g,'practice_too_late');
});
test('a longer route still passes if it offers practice before the budget',()=>{
  const g=extra(base(),'demo-right',2);
  assert.deepEqual(check(g),{ok:true,latestTeachBeat:1,latestPracticeBeat:5});
});
test('extra story beats after the first practice do not count against pacing',()=>{
  const g=base();g.nodes.find(n=>n.id==='demo-join').exits=['demo-tail-1'];
  g.nodes.push(beat('demo-tail-1',{exits:['demo-tail-2']}),beat('demo-tail-2',{exits:['demo-end']}));
  assert.equal(check(g).ok,true);
});
test('branch-specific teaching can be late on one branch even when practice is covered',()=>{
  const g=base();g.nodes[0].teaches=[];
  g.nodes[2].teaches=['demo-skill'];g.nodes[2].offers=[];
  g.nodes[3].teaches=['demo-skill'];g.nodes[3].offers=[];
  g.nodes[4].offers=['demo-card'];
  assert.deepEqual(check(g),{ok:true,latestTeachBeat:3,latestPracticeBeat:4});
  reject(g,'teaching_too_late',{teachBy:2,practiceBy:6});
});
test('practice in the same beat as first teaching is rejected by the base graph validator',()=>{
  const g=base();g.nodes[0].teaches=[];g.nodes[2].teaches=['demo-skill'];
  reject(g,'graph_invalid');
});
test('practice only at a terminal is not a valid opportunity',()=>{
  const g=base();g.nodes[2].offers=[];g.nodes[3].offers=[];g.nodes[5].offers=['demo-card'];
  reject(g,'graph_invalid');
});
test('unknown extra gate fields are rejected by the base graph validator',()=>{
  const g=base();g.nodes[1].requiresPass=true;reject(g,'graph_invalid');
});
test('malformed or cyclic graphs fail closed without throwing',()=>{
  reject(null,'graph_invalid');
  const g=base();g.nodes[4].exits=['demo-fork'];reject(g,'graph_invalid');
});
test('invalid, missing or oversized limits fail closed',()=>{
  reject(base(),'limits_invalid',{teachBy:3});
  reject(base(),'limits_invalid',{teachBy:3,practiceBy:201});
  reject(base(),'limits_invalid',{teachBy:3,practiceBy:6,ignoreLate:true});
  reject(base(),'limits_invalid',null);
});
test('failure results never echo authored IDs or objective keys',()=>{
  const g=extra(base(),'demo-right',4);g.nodes[3].objectiveKey='private-sentinel';
  const r=check(g);assert.deepEqual(r,{ok:false,code:'practice_too_late'});
  assert.equal(JSON.stringify(r).includes('private-sentinel'),false);
});
test('two distinct route-local cards may each meet the budget',()=>{
  const g=base();g.practices.push({id:'demo-card-b',skillId:'demo-skill'});
  g.nodes[3].offers=['demo-card-b'];
  assert.deepEqual(check(g),{ok:true,latestTeachBeat:1,latestPracticeBeat:3});
});
