import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneLearningFlow} from '../scripts/validate-scene-learning-flow.mjs';
import {validateRouteConsequenceOutline} from '../scripts/validate-route-consequence-outline.mjs';
import {validateRouteLearningAlignment as check} from '../scripts/validate-route-learning-alignment.mjs';

// Entirely invented demo IDs; no formal-world narrative, NPCs or secrets.
const beat = (id,exits=[],{end=false,teaches=[],offers=[]}={}) =>
  ({id,objectiveKey:id+'-goal',end,teaches,offers,exits});
const scene = (id,exits=[],acknowledges=[],end=false) =>
  ({id,end,exits,acknowledges});
const edge = (to,impactKey=null) => ({to,impactKey});
function fixture() {
  const learning = {start:'demo-entry',skills:['demo-skill'],
    practices:[{id:'demo-card',skillId:'demo-skill'}],nodes:[
      beat('demo-entry',['demo-left','demo-right'],{teaches:['demo-skill']}),
      beat('demo-left',['demo-join'],{offers:['demo-card']}),
      beat('demo-right',['demo-join'],{offers:['demo-card']}),
      beat('demo-join',['demo-end']),beat('demo-end',[],{end:true})
    ]};
  const consequence = {start:'demo-entry',nodes:[
    scene('demo-entry',[edge('demo-left','demo-impact-left'),edge('demo-right','demo-impact-right')]),
    scene('demo-left',[edge('demo-join')],['demo-impact-left']),
    scene('demo-right',[edge('demo-join')],['demo-impact-right']),
    scene('demo-join',[edge('demo-end')]),scene('demo-end',[],[],true)
  ]};
  return {learning,consequence};
}
const accepted = {ok:true,nodeCount:5,practiceCount:1,branchOutcomeCount:2};

test('aligned independent learning and route-consequence projections pass',()=>{
  const {learning,consequence}=fixture();
  assert.equal(validateSceneLearningFlow(learning).ok,true);
  assert.equal(validateRouteConsequenceOutline(consequence).ok,true);
  assert.deepEqual(check(learning,consequence),accepted);
});

test('independently valid graphs with a changed route edge are rejected',()=>{
  const {learning,consequence}=fixture();
  consequence.nodes.find(n=>n.id==='demo-left').exits=[edge('demo-right')];
  assert.equal(validateSceneLearningFlow(learning).ok,true);
  assert.equal(validateRouteConsequenceOutline(consequence).ok,true);
  assert.deepEqual(check(learning,consequence),{ok:false,code:'projection_mismatch'});
});

test('independently valid graphs with a renamed beat are rejected',()=>{
  const {learning,consequence}=fixture();
  consequence.nodes.find(n=>n.id==='demo-right').id='demo-other';
  consequence.nodes[0].exits[1].to='demo-other';
  assert.equal(validateRouteConsequenceOutline(consequence).ok,true);
  assert.deepEqual(check(learning,consequence),{ok:false,code:'projection_mismatch'});
});

test('editorial ordering and optional learning placement do not change route alignment',()=>{
  const {learning,consequence}=fixture();
  learning.nodes[1].offers=[];learning.nodes[2].offers=[];
  learning.nodes[3].offers=['demo-card'];
  learning.nodes.reverse();consequence.nodes.reverse();
  learning.nodes.find(n=>n.id==='demo-entry').exits.reverse();
  consequence.nodes.find(n=>n.id==='demo-entry').exits.reverse();
  assert.deepEqual(check(learning,consequence),accepted);
});

test('invalid independent projections fail closed with fixed non-leaking codes',()=>{
  const {learning,consequence}=fixture();
  learning.nodes[1].requiresVerifiedPractice='private-sentinel';
  assert.deepEqual(check(learning,consequence),{ok:false,code:'learning_invalid'});
  delete learning.nodes[1].requiresVerifiedPractice;
  consequence.nodes[1].acknowledges=['private-sentinel'];
  assert.deepEqual(check(learning,consequence),{ok:false,code:'consequence_invalid'});
  assert.deepEqual(check(null,consequence),{ok:false,code:'learning_invalid'});
});

test('the bridge does not mutate either input or echo author-controlled identifiers',()=>{
  const {learning,consequence}=fixture();
  const before=JSON.stringify([learning,consequence]);
  const ok=check(learning,consequence);
  assert.equal(JSON.stringify([learning,consequence]),before);
  assert.equal(JSON.stringify(ok).includes('demo-'),false);
  consequence.nodes[1].exits=[edge('demo-right')];
  const mismatch=check(learning,consequence);
  assert.equal(JSON.stringify(mismatch).includes('demo-'),false);
});
