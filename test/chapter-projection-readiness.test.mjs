import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneLearningFlow} from '../scripts/validate-scene-learning-flow.mjs';
import {validateRouteConsequenceOutline} from '../scripts/validate-route-consequence-outline.mjs';
import {validateRouteLearningAlignment} from '../scripts/validate-route-learning-alignment.mjs';
import {validateChapterProjectionReadiness as check} from '../scripts/validate-chapter-projection-readiness.mjs';

// All identifiers and graph structures are synthetic. No private world content.
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
  latestTeachBeat:1,latestPracticeBeat:2};

test('matching scoped outlines pass with early, optional learning on both routes',()=>{
  const input=fixture(),before=JSON.stringify(input);
  assert.deepEqual(check(input),passed);
  assert.equal(JSON.stringify(input),before);
});

test('same graph cannot be accidentally paired across world, revision or chapter',()=>{
  for(const field of ['worldId','manifestRevision','chapterId']) {
    const input=fixture();input.consequence.scope[field]='demo-different';
    assert.equal(validateRouteLearningAlignment(input.learning.graph,input.consequence.graph).ok,true);
    assert.deepEqual(check(input),{ok:false,code:'scope_mismatch'});
    assert.equal(JSON.stringify(check(input)).includes('demo-'),false);
  }
});

test('late learning on one branch fails even when both graphs align and base contracts pass',()=>{
  const input=fixture();
  input.learning.graph.nodes.find(n=>n.id==='demo-right').offers=[];
  input.learning.graph.nodes.find(n=>n.id==='demo-join').offers=['demo-card'];
  assert.equal(validateSceneLearningFlow(input.learning.graph).ok,true);
  assert.equal(validateRouteConsequenceOutline(input.consequence.graph).ok,true);
  assert.equal(validateRouteLearningAlignment(input.learning.graph,input.consequence.graph).ok,true);
  assert.deepEqual(check(input,{teachBy:2,practiceBy:2}),{ok:false,code:'practice_too_late'});
  assert.deepEqual(check(input,{teachBy:2,practiceBy:3}),
    {...passed,latestPracticeBeat:3});
});

test('different route edges fail even when each independent graph is valid',()=>{
  const input=fixture();
  input.consequence.graph.nodes.find(n=>n.id==='demo-left').exits=[edge('demo-right')];
  assert.equal(validateRouteConsequenceOutline(input.consequence.graph).ok,true);
  assert.deepEqual(check(input),{ok:false,code:'route_mismatch'});
});

test('unknown gate fields and invalid scope fail closed without echoing content',()=>{
  const input=fixture();input.learning.graph.nodes[1].requiresVerifiedPractice='demo-private-sentinel';
  assert.deepEqual(check(input),{ok:false,code:'projection_invalid'});
  delete input.learning.graph.nodes[1].requiresVerifiedPractice;
  input.learning.scope.extra='demo-private-sentinel';
  assert.deepEqual(check(input),{ok:false,code:'scope_invalid'});
  delete input.learning.scope.extra;
  assert.deepEqual(check(input,{teachBy:0,practiceBy:2}),{ok:false,code:'limits_invalid'});
  assert.deepEqual(check(null),{ok:false,code:'input_invalid'});
});

test('editorial ordering does not change scoped readiness',()=>{
  const input=fixture();input.learning.graph.nodes.reverse();input.consequence.graph.nodes.reverse();
  input.learning.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  input.consequence.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  assert.deepEqual(check(input),passed);
});

test('exhaustive synthetic two-route practice placements match independent path oracle',()=>{
  const sites=['demo-left','demo-right','demo-join'];
  let valid=0,invalid=0,checks=0;
  for(let mask=0;mask<8;mask++) for(let limit=1;limit<=4;limit++) {
    const input=fixture();
    for(const id of sites)input.learning.graph.nodes.find(n=>n.id===id).offers=[];
    sites.forEach((id,i)=>{if(mask&(1<<i))
      input.learning.graph.nodes.find(n=>n.id===id).offers=['demo-card'];});
    const left=(mask&1)?2:(mask&4)?3:Infinity;
    const right=(mask&2)?2:(mask&4)?3:Infinity;
    const latest=Math.max(left,right);
    const result=check(input,{teachBy:1,practiceBy:limit});
    const expected=!Number.isFinite(latest)?{ok:false,code:'projection_invalid'}:
      latest>limit?{ok:false,code:'practice_too_late'}:
      {...passed,latestPracticeBeat:latest};
    assert.deepEqual(result,expected,`mask=${mask},limit=${limit}`);
    assert.equal(JSON.stringify(result).includes('demo-'),false);
    if(result.ok)valid++;else invalid++;
    checks++;
  }
  assert.equal(checks,32);
  assert.ok(valid>0 && invalid>0);
});
