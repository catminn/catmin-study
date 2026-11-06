import test from 'node:test';
import assert from 'node:assert/strict';
import {validateChapterScopedCopyReadiness as check} from '../scripts/validate-chapter-scoped-copy-readiness.mjs';
import {validateChapterCopyPlacementReadiness as legacy} from '../scripts/validate-chapter-copy-placement-readiness.mjs';

// Synthetic graph, synthetic text, and invented identifiers only.
const scope=()=>({worldId:'demo-world',manifestRevision:'demo-rev-1',chapterId:'demo-chapter'});
const edge=(to,impactKey=null)=>({to,impactKey});
const beat=(id,exits=[],teaches=[],offers=[],end=false)=>
  ({id,objectiveKey:id+'-goal',end,teaches,offers,exits});
const scene=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
function input() {
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
const responses=()=>({schema:'chapter-scoped-response-v1',scope:scope(),plan:{
  schema:'route-response-differentiation-v1',responses:[
    {impactKey:'demo-impact-left',approved:true,copy:'Left choice has a consequence.'},
    {impactKey:'demo-impact-right',approved:true,copy:'Right choice has a consequence.'}
  ]}});
const placements=()=>({schema:'chapter-scoped-placement-v1',scope:scope(),plan:{
  schema:'chapter-copy-placement-v1',placements:[
    {sceneId:'demo-left',impactKey:'demo-impact-left',responseKey:'demo-impact-left'},
    {sceneId:'demo-right',impactKey:'demo-impact-right',responseKey:'demo-impact-right'}
  ]}});
const pass={ok:true,nodeCount:5,practiceCount:1,branchOutcomeCount:2,
  latestTeachBeat:1,latestPracticeBeat:2,latestCallbackBeat:1,
  approvedResponseCount:2,branchChoiceCount:1,copyPlacementCount:2,copyScopeMatched:true};

test('same world/revision/chapter copy and placements pass without input mutation',()=>{
  const i=input(),r=responses(),p=placements(),before=JSON.stringify([i,r,p]);
  assert.deepEqual(check(i,r,p),pass);
  assert.equal(JSON.stringify([i,r,p]),before);
});

test('old unscoped catalog accepts cross-revision reuse; scoped preflight rejects it',()=>{
  const i=input(),r=responses(),p=placements();
  assert.equal(legacy(i,r.plan,p.plan).ok,true);
  r.scope.manifestRevision='demo-rev-2';
  assert.deepEqual(check(i,r,p),{ok:false,code:'copy_scope_mismatch'});
  r.scope.manifestRevision='demo-rev-1';p.scope.manifestRevision='demo-rev-2';
  assert.deepEqual(check(i,r,p),{ok:false,code:'copy_scope_mismatch'});
});

test('world, chapter, and learning/consequence mismatches fail before copy inspection',()=>{
  const i=input(),r=responses(),p=placements();
  r.scope.worldId='demo-other';
  assert.deepEqual(check(i,r,p),{ok:false,code:'copy_scope_mismatch'});
  r.scope.worldId='demo-world';p.scope.chapterId='demo-other';
  assert.deepEqual(check(i,r,p),{ok:false,code:'copy_scope_mismatch'});
  p.scope.chapterId='demo-chapter';i.consequence.scope.chapterId='demo-other';
  assert.deepEqual(check(i,r,p),{ok:false,code:'copy_scope_mismatch'});
});

test('missing, malformed, and unexpected scope fields fail closed without echoing data',()=>{
  const r=responses(),p=placements();
  delete r.scope.chapterId;
  assert.deepEqual(check(input(),r,p),{ok:false,code:'copy_scope_invalid'});
  r.scope.chapterId='demo-chapter';p.scope.secret='demo-sentinel-secret';
  const result=check(input(),r,p);
  assert.deepEqual(result,{ok:false,code:'copy_scope_invalid'});
  assert.equal(JSON.stringify(result).includes('demo-sentinel-secret'),false);
  delete p.scope.secret;p.scope.worldId='INVALID';
  assert.deepEqual(check(input(),r,p),{ok:false,code:'copy_scope_invalid'});
});

test('envelope schemas, extra fields, and null envelopes are rejected',()=>{
  const r=responses(),p=placements();
  r.schema='chapter-scoped-placement-v1';
  assert.deepEqual(check(input(),r,p),{ok:false,code:'copy_scope_invalid'});
  r.schema='chapter-scoped-response-v1';p.unreviewed=true;
  assert.deepEqual(check(input(),r,p),{ok:false,code:'copy_scope_invalid'});
  assert.deepEqual(check(input(),null,placements()),{ok:false,code:'copy_scope_invalid'});
});

test('a matched scope cannot bypass approval, callback, or learning requirements',()=>{
  const i=input(),r=responses(),p=placements();
  r.plan.responses[0].approved=false;
  assert.deepEqual(check(i,r,p),{ok:false,code:'response_unapproved'});
  r.plan.responses[0].approved=true;p.plan.placements.pop();
  assert.deepEqual(check(i,r,p),{ok:false,code:'copy_placement_missing'});
  p.plan=placements().plan;
  i.learning.graph.nodes.find(n=>n.id==='demo-right').offers=[];
  i.learning.graph.nodes.find(n=>n.id==='demo-join').offers=['demo-card'];
  assert.deepEqual(check(i,r,p,{teachBy:1,practiceBy:2}),{ok:false,code:'practice_too_late'});
});

test('node, edge, catalog, and placement order do not change the result',()=>{
  const i=input(),r=responses(),p=placements();
  i.learning.graph.nodes.reverse();i.consequence.graph.nodes.reverse();
  i.learning.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  i.consequence.graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  r.plan.responses.reverse();p.plan.placements.reverse();
  assert.deepEqual(check(i,r,p),pass);
});

test('malformed chapter scope cannot be hidden by valid copy envelope',()=>{
  const i=input();delete i.learning.scope.manifestRevision;
  assert.deepEqual(check(i,responses(),placements()),{ok:false,code:'input_invalid'});
  assert.deepEqual(check(null,responses(),placements()),{ok:false,code:'input_invalid'});
});
