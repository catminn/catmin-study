import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChapterProjectionReadiness} from '../scripts/validate-chapter-projection-readiness.mjs';
import {validateRouteConsequencePacing} from '../scripts/validate-route-consequence-pacing.mjs';
import {validateChapterNarrativeReadiness as check} from '../scripts/validate-chapter-narrative-readiness.mjs';

// Entirely synthetic, public example: no real-world plot, NPC, or private identifiers.
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
const passed={ok:true,nodeCount:5,practiceCount:1,branchOutcomeCount:2,
  latestTeachBeat:1,latestPracticeBeat:2,latestCallbackBeat:1};

function delayRight(input) {
  input.learning.graph.nodes.find(n=>n.id==='demo-right').exits=['demo-right-delay'];
  input.learning.graph.nodes.push(beat('demo-right-delay',['demo-join']));
  const right=input.consequence.graph.nodes.find(n=>n.id==='demo-right');
  right.exits=[edge('demo-right-delay')];right.acknowledges=[];
  input.consequence.graph.nodes.push(scene('demo-right-delay',[edge('demo-join')],['demo-impact-right']));
  return input;
}

test('one scoped preflight checks learning and route callbacks without mutating inputs',()=>{
  const input=fixture(),before=JSON.stringify(input);
  assert.deepEqual(check(input),passed);
  assert.equal(JSON.stringify(input),before);
  assert.equal(validateChapterProjectionReadiness(input).ok,true);
  assert.equal(validateRouteConsequencePacing(input.consequence.graph).ok,true);
});

test('individually valid projections with a late callback fail the joint preflight',()=>{
  const input=delayRight(fixture());
  assert.equal(validateChapterProjectionReadiness(input).ok,true);
  assert.equal(validateRouteConsequencePacing(input.consequence.graph,{callbackBy:1}).code,'callback_too_late');
  assert.deepEqual(check(input,undefined,{callbackBy:1}),{ok:false,code:'callback_too_late'});
  assert.deepEqual(check(input,undefined,{callbackBy:2}),
    {...passed,nodeCount:6,latestCallbackBeat:2});
});

test('joint preflight still rejects late practice on an otherwise timely narrative route',()=>{
  const input=fixture();
  input.learning.graph.nodes.find(n=>n.id==='demo-right').offers=[];
  input.learning.graph.nodes.find(n=>n.id==='demo-join').offers=['demo-card'];
  assert.equal(validateRouteConsequencePacing(input.consequence.graph).ok,true);
  assert.deepEqual(check(input,{teachBy:1,practiceBy:2},{callbackBy:1}),
    {ok:false,code:'practice_too_late'});
  assert.deepEqual(check(input,{teachBy:1,practiceBy:3},{callbackBy:1}),
    {...passed,latestPracticeBeat:3});
});

test('scope mismatches and malformed author fields fail before callback inspection',()=>{
  const input=fixture();input.consequence.scope.chapterId='demo-other';
  assert.deepEqual(check(input),{ok:false,code:'scope_mismatch'});
  input.consequence.scope.chapterId='demo-chapter';
  input.consequence.graph.nodes[1].privateText='demo-secret-sentinel';
  assert.deepEqual(check(input),{ok:false,code:'projection_invalid'});
  assert.equal(JSON.stringify(check(input)).includes('demo-secret-sentinel'),false);
  assert.deepEqual(check(null),{ok:false,code:'input_invalid'});
});

test('invalid callback limits have a fixed, distinct error code',()=>{
  for(const limits of [null,{}, {callbackBy:0},{callbackBy:201},
    {callbackBy:1.5},{callbackBy:1,extra:'demo-secret-sentinel'}]) {
    const result=check(fixture(),undefined,limits);
    assert.deepEqual(result,{ok:false,code:'callback_limits_invalid'});
    assert.equal(JSON.stringify(result).includes('demo-secret-sentinel'),false);
  }
  assert.deepEqual(check(fixture(),{teachBy:0,practiceBy:2},{callbackBy:1}),
    {ok:false,code:'limits_invalid'});
});

test('node and exit editorial order cannot change joint readiness',()=>{
  const input=fixture();
  input.learning.graph.nodes.reverse();input.consequence.graph.nodes.reverse();
  input.learning.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  input.consequence.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  assert.deepEqual(check(input),passed);
});

test('synthetic callback budgets are inclusive while optional practice remains independent',()=>{
  let checks=0;
  for(const delayed of [false,true])for(let budget=1;budget<=4;budget++) {
    const input=delayed?delayRight(fixture()):fixture();
    const latest=delayed?2:1;
    const result=check(input,{teachBy:1,practiceBy:2},{callbackBy:budget});
    if(budget<latest) assert.deepEqual(result,{ok:false,code:'callback_too_late'});
    else assert.deepEqual(result,{...passed,nodeCount:delayed?6:5,latestCallbackBeat:latest});
    checks++;
  }
  assert.equal(checks,8);
});
