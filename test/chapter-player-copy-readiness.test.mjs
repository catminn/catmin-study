import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChapterPlayerCopyReadiness as check} from '../scripts/validate-chapter-player-copy-readiness.mjs';

// Synthetic route names and sample copy only; no formal-world plot or NPC data.
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
function copyPlan() {
  return {schema:'route-response-differentiation-v1',responses:[
    {impactKey:'demo-impact-left',approved:true,copy:'The left route changes the observation.'},
    {impactKey:'demo-impact-right',approved:true,copy:'The right route changes the observation.'}
  ]};
}
const passed={ok:true,nodeCount:5,practiceCount:1,branchOutcomeCount:2,
  latestTeachBeat:1,latestPracticeBeat:2,latestCallbackBeat:1,
  approvedResponseCount:2,branchChoiceCount:1};

test('one author preflight proves scoped pacing and distinct approved player responses',()=>{
  const input=fixture(),plan=copyPlan(),before=JSON.stringify([input,plan]);
  assert.deepEqual(check(input,plan),passed);
  assert.equal(JSON.stringify([input,plan]),before);
});

test('a route callback can be timely yet narratively indistinct',()=>{
  const plan=copyPlan();
  plan.responses[1].copy=' THE LEFT ROUTE CHANGES THE OBSERVATION!!! ';
  assert.deepEqual(check(fixture(),plan),{ok:false,code:'response_indistinct'});
});

test('unapproved or empty route copy cannot satisfy a structurally valid chapter',()=>{
  const plan=copyPlan();plan.responses[1].approved=false;
  assert.deepEqual(check(fixture(),plan),{ok:false,code:'response_unapproved'});
  plan.responses[1].approved=true;plan.responses[1].copy='  ';
  assert.deepEqual(check(fixture(),plan),{ok:false,code:'response_unapproved'});
});

test('every branch outcome needs its own reviewed response',()=>{
  const plan=copyPlan();plan.responses.pop();
  assert.deepEqual(check(fixture(),plan),{ok:false,code:'response_missing'});
  plan.responses.push({impactKey:'demo-impact-unknown',approved:true,copy:'A separate demo response.'});
  assert.deepEqual(check(fixture(),plan),{ok:false,code:'public_copy_invalid'});
});

test('unreviewed fields, director delimiters and malformed copy fail without echoing text',()=>{
  const plan=copyPlan();plan.responses[0].secret='demo-sentinel-secret';
  assert.deepEqual(check(fixture(),plan),{ok:false,code:'public_copy_invalid'});
  delete plan.responses[0].secret;
  plan.responses[0].copy='⟦DG:demo-sentinel-secret⟧';
  const result=check(fixture(),plan);
  assert.deepEqual(result,{ok:false,code:'public_copy_invalid'});
  assert.equal(JSON.stringify(result).includes('demo-sentinel-secret'),false);
});

test('response approval cannot conceal an over-late callback',()=>{
  const input=fixture();
  input.learning.graph.nodes.find(n=>n.id==='demo-right').exits=['demo-delay'];
  input.learning.graph.nodes.push(beat('demo-delay',['demo-join']));
  const right=input.consequence.graph.nodes.find(n=>n.id==='demo-right');
  right.exits=[edge('demo-delay')];right.acknowledges=[];
  input.consequence.graph.nodes.push(scene('demo-delay',[edge('demo-join')],['demo-impact-right']));
  assert.deepEqual(check(input,copyPlan(),undefined,{callbackBy:1}),
    {ok:false,code:'callback_too_late'});
  assert.deepEqual(check(input,copyPlan(),undefined,{callbackBy:2}),
    {...passed,nodeCount:6,latestCallbackBeat:2});
});

test('approved route copy cannot conceal a late optional practice',()=>{
  const input=fixture();
  input.learning.graph.nodes.find(n=>n.id==='demo-right').offers=[];
  input.learning.graph.nodes.find(n=>n.id==='demo-join').offers=['demo-card'];
  assert.deepEqual(check(input,copyPlan(),{teachBy:1,practiceBy:2}),
    {ok:false,code:'practice_too_late'});
  assert.deepEqual(check(input,copyPlan(),{teachBy:1,practiceBy:3}),
    {...passed,latestPracticeBeat:3});
});

test('editorial ordering of nodes, exits and copy catalog does not change the verdict',()=>{
  const input=fixture(),plan=copyPlan();
  input.learning.graph.nodes.reverse();
  input.consequence.graph.nodes.reverse();
  input.learning.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  input.consequence.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  plan.responses.reverse();
  assert.deepEqual(check(input,plan),passed);
});

test('scope and limit errors precede private copy inspection',()=>{
  const input=fixture(),plan=copyPlan();
  input.consequence.scope.manifestRevision='demo-other';
  assert.deepEqual(check(input,plan),{ok:false,code:'scope_mismatch'});
  input.consequence.scope.manifestRevision='demo-rev-1';
  assert.deepEqual(check(input,plan,{teachBy:0,practiceBy:6}),
    {ok:false,code:'limits_invalid'});
  assert.deepEqual(check(input,plan,undefined,{callbackBy:0}),
    {ok:false,code:'callback_limits_invalid'});
});
