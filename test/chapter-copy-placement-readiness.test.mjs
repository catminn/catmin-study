import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChapterCopyPlacementReadiness as check} from '../scripts/validate-chapter-copy-placement-readiness.mjs';

// Entirely synthetic demo graph: no formal-world plot, identities or solutions.
const edge=(to,impactKey=null)=>({to,impactKey});
const beat=(id,exits=[],teaches=[],offers=[],end=false)=>
  ({id,objectiveKey:id+'-goal',end,teaches,offers,exits});
const scene=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
const scope=()=>({worldId:'demo-world',manifestRevision:'demo-rev-1',chapterId:'demo-chapter'});
function fixture() {
  return {learning:{scope:scope(),graph:{start:'demo-start',skills:['demo-skill'],
    practices:[{id:'demo-card',skillId:'demo-skill'}],nodes:[
      beat('demo-start',['demo-left','demo-right'],['demo-skill']),
      beat('demo-left',['demo-join'],[],['demo-card']),
      beat('demo-right',['demo-join'],[],['demo-card']),
      beat('demo-join',['demo-end']),beat('demo-end',[],[],[],true)
    ]}},consequence:{scope:scope(),graph:{start:'demo-start',nodes:[
      scene('demo-start',[edge('demo-left','demo-impact-left'),edge('demo-right','demo-impact-right')]),
      scene('demo-left',[edge('demo-join')],['demo-impact-left']),
      scene('demo-right',[edge('demo-join')],['demo-impact-right']),
      scene('demo-join',[edge('demo-end')]),scene('demo-end',[],[],true)
    ]}}};
}
const response=()=>({schema:'route-response-differentiation-v1',responses:[
  {impactKey:'demo-impact-left',approved:true,copy:'The left path changes the observation.'},
  {impactKey:'demo-impact-right',approved:true,copy:'The right path changes the observation.'}
]});
const placement=()=>({schema:'chapter-copy-placement-v1',placements:[
  {sceneId:'demo-left',impactKey:'demo-impact-left',responseKey:'demo-impact-left'},
  {sceneId:'demo-right',impactKey:'demo-impact-right',responseKey:'demo-impact-right'}
]});
const passed={ok:true,nodeCount:5,practiceCount:1,branchOutcomeCount:2,
  latestTeachBeat:1,latestPracticeBeat:2,latestCallbackBeat:1,
  approvedResponseCount:2,branchChoiceCount:1,copyPlacementCount:2};

test('each conditional callback has its own explicitly bound approved response',()=>{
  const input=fixture(),copy=response(),places=placement();
  const before=JSON.stringify([input,copy,places]);
  assert.deepEqual(check(input,copy,places),passed);
  assert.equal(JSON.stringify([input,copy,places]),before);
});

test('missing copy at a real callback beat fails even when all copy is approved',()=>{
  const p=placement();p.placements.pop();
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_missing'});
});

test('a response for the wrong route cannot be bound at a callback beat',()=>{
  const p=placement();p.placements[0].responseKey='demo-impact-right';
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_invalid'});
});

test('placing copy at a non-acknowledgement scene or on a different route fails',()=>{
  const p=placement();p.placements[0].sceneId='demo-join';
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_invalid'});
  p.placements[0].sceneId='demo-right';
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_invalid'});
});

test('duplicate, unknown and unreviewed placement fields fail closed',()=>{
  const p=placement();p.placements.push({...p.placements[0]});
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_invalid'});
  p.placements.pop();p.placements[0].hidden='demo-sentinel-secret';
  const result=check(fixture(),response(),p);
  assert.deepEqual(result,{ok:false,code:'copy_placement_invalid'});
  assert.equal(JSON.stringify(result).includes('demo-sentinel-secret'),false);
});

test('invalid schema, excess placements and malformed input are rejected',()=>{
  const p=placement();p.schema='other';
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_invalid'});
  p.schema='chapter-copy-placement-v1';p.placements=Array(2049).fill(p.placements[0]);
  assert.deepEqual(check(fixture(),response(),p),{ok:false,code:'copy_placement_invalid'});
  assert.deepEqual(check(fixture(),response(),null),{ok:false,code:'copy_placement_invalid'});
});

test('node and placement order cannot change the verdict',()=>{
  const input=fixture(),p=placement(),copy=response();
  input.learning.graph.nodes.reverse();input.consequence.graph.nodes.reverse();
  input.learning.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  input.consequence.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  p.placements.reverse();copy.responses.reverse();
  assert.deepEqual(check(input,copy,p),passed);
});

test('invalid chapter or copy is rejected before inspecting placement bindings',()=>{
  const input=fixture(),copy=response(),p=placement();
  input.learning.scope.chapterId='demo-other';
  assert.deepEqual(check(input,copy,p),{ok:false,code:'scope_mismatch'});
  input.learning.scope.chapterId='demo-chapter';copy.responses[0].approved=false;
  assert.deepEqual(check(input,copy,p),{ok:false,code:'response_unapproved'});
});
