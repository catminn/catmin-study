import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmKnowledgeAlignment} from '../scripts/validate-dm-knowledge-alignment.mjs';

// Exhaustive synthetic author-side paths. No formal-world scenes, NPCs, facts,
// answers, private identifiers, or importable narrative content.
const flow = JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json', import.meta.url), 'utf8'));
const beat = (id, {teaches=[], offers=[], exits=[], end=false}={}) =>
  ({id, objectiveKey:id+'-objective', teaches, offers, exits, end});
const binding = () => ({
  schemaVersion:'dm-knowledge-alignment-v1', synthetic:true,
  worldId:'demo-world', manifestRevision:'demo-r1',
  lessonBeatId:'lesson-offer', conceptId:'demo.math-concept',
  skillId:'demo-target', practiceIds:['demo-target-card']
});
const chapter = () => ({
  start:'demo-start',
  skills:['demo-target','demo-other'],
  practices:[
    {id:'demo-target-card',skillId:'demo-target'},
    {id:'demo-other-card',skillId:'demo-other'}
  ],
  nodes:[
    beat('demo-start',{teaches:['demo-other'],exits:['demo-fork']}),
    beat('demo-fork',{exits:['demo-left-1','demo-right-1']}),
    beat('demo-left-1',{offers:['demo-other-card'],exits:['demo-left-2']}),
    beat('demo-left-2',{exits:['demo-join']}),
    beat('demo-right-1',{offers:['demo-other-card'],exits:['demo-right-2']}),
    beat('demo-right-2',{exits:['demo-join']}),
    beat('demo-join',{exits:['demo-end']}),
    beat('demo-end',{end:true})
  ]
});
const byId = g => new Map(g.nodes.map(n=>[n.id,n]));
const LEFT=['demo-start','demo-fork','demo-left-1','demo-left-2','demo-join','demo-end'];
const RIGHT=['demo-start','demo-fork','demo-right-1','demo-right-2','demo-join','demo-end'];

// Independent path enumeration: first target encounter on each complete route.
// This oracle intentionally does not reuse the validator's topological algorithm.
function firstOnEachPath(g,field) {
  const nodes=byId(g);
  return [LEFT,RIGHT].map(path => {
    const index=path.findIndex(id => nodes.get(id)[field].includes('demo-target'));
    return index<0 ? null : index+1;
  });
}
function expected(g,limits) {
  const teaches=firstOnEachPath(g,'teaches');
  const offers=firstOnEachPath(g,'offers');
  // The offer catalog ID is distinct from the target skill ID.
  const offerPaths=[LEFT,RIGHT].map(path => {
    const nodes=byId(g);
    const i=path.findIndex(id=>nodes.get(id).offers.includes('demo-target-card'));
    return i<0?null:i+1;
  });
  if(teaches.includes(null)) return {ok:false,code:'target_teaching_missing'};
  if(offerPaths.includes(null)) return {ok:false,code:'target_practice_missing'};
  const teach=Math.max(...teaches),practice=Math.max(...offerPaths);
  if(teach>limits.teachBy)return {ok:false,code:'target_teaching_too_late'};
  if(practice>limits.practiceBy)return {ok:false,code:'target_practice_too_late'};
  return {ok:true,latestTargetTeachBeat:teach,latestTargetPracticeBeat:practice};
}

test('31 target-offer combinations agree with both independent story paths and four pacing budgets',()=>{
  let passed=0, rejected=0;
  const locations=['demo-left-1','demo-left-2','demo-right-1','demo-right-2','demo-join'];
  for(let mask=1;mask<32;mask++){
    const g=chapter(),nodes=byId(g);
    nodes.get('demo-start').teaches.push('demo-target');
    for(let i=0;i<locations.length;i++)
      if(mask&(1<<i))nodes.get(locations[i]).offers.push('demo-target-card');
    for(const practiceBy of [3,4,5,6]){
      const limits={teachBy:1,practiceBy};
      const before=JSON.stringify(g);
      const actual=validateDmKnowledgeAlignment(flow,g,binding(),limits);
      const want=expected(g,limits);
      assert.deepEqual(actual,want,'offer mask '+mask+', practiceBy '+practiceBy);
      assert.equal(JSON.stringify(g),before,'mutated offer mask '+mask);
      if(actual.ok)passed++;else rejected++;
    }
  }
  assert.ok(passed>0&&rejected>0);
});

test('branch-local teaching and offers cannot hide missing target paths or late teaching',()=>{
  let checked=0,passed=0,rejected=0;
  // Bits: target teaching at start/left/right, target offer at left/right.
  for(let mask=1;mask<32;mask++){
    const g=chapter(),nodes=byId(g);
    if(mask&1)nodes.get('demo-start').teaches.push('demo-target');
    if(mask&2)nodes.get('demo-left-1').teaches.push('demo-target');
    if(mask&4)nodes.get('demo-right-1').teaches.push('demo-target');
    if(mask&8)nodes.get('demo-left-2').offers.push('demo-target-card');
    if(mask&16)nodes.get('demo-right-2').offers.push('demo-target-card');
    // Keep only well-formed chapter graphs: each offered card was taught
    // on that path in a strictly preceding beat; the card is offered somewhere.
    if(!(mask&24)||((mask&8)&&!(mask&3))||((mask&16)&&!(mask&5)))continue;
    for(const teachBy of [1,3]){
      for(const practiceBy of [3,4]){
        const limits={teachBy,practiceBy};
        const before=JSON.stringify(g);
        const actual=validateDmKnowledgeAlignment(flow,g,binding(),limits);
        assert.deepEqual(actual,expected(g,limits),
          'teaching mask '+mask+', limits '+JSON.stringify(limits));
        assert.equal(JSON.stringify(g),before);
        if(actual.ok)passed++;else rejected++;
        checked++;
      }
    }
  }
  assert.ok(checked>=20&&passed>0&&rejected>0);
});
