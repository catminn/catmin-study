import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteConsequenceOutline as check} from '../scripts/validate-route-consequence-outline.mjs';

// Purely synthetic stress fixtures. Never official story material.
const node=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
const edge=(to,impactKey=null)=>({to,impactKey});
const dense=(count)=>({start:'demo-n0',nodes:Array.from({length:count},(_,i)=>{
  const exits=Array.from({length:count-i-1},(_,j)=>edge('demo-n'+(i+j+1),
    count-i-1>1?'demo-impact-'+i+'-'+j:null));
  return node('demo-n'+i,exits,[],i===count-1);
})});
const chain=(count)=>({start:'demo-n0',nodes:Array.from({length:count},(_,i)=>
  node('demo-n'+i,i===count-1?[]:[edge('demo-n'+(i+1))],[],i===count-1))});
const fork=()=>({start:'demo-start',nodes:[
  node('demo-start',[edge('demo-a','demo-impact-a'),edge('demo-b','demo-impact-b')]),
  node('demo-a',[edge('demo-end')],['demo-impact-a']),
  node('demo-b',[edge('demo-end')],['demo-impact-b']),
  node('demo-end',[],[],true)]});

test('ordinary branching remains accepted',()=>{
  assert.deepEqual(check(fork()),{ok:true,nodeCount:4,branchOutcomeCount:2});
});
test('long linear story is not rejected by branch budget',()=>{
  assert.deepEqual(check(chain(200)),{ok:true,nodeCount:200,branchOutcomeCount:0});
});
test('dense DAG over edge budget fails before expensive route proof',()=>{
  assert.deepEqual(check(dense(70)),{ok:false,code:'graph_budget_exceeded'});
});
test('branch-outcome budget rejects many unique outcomes before route proof',()=>{
  assert.deepEqual(check(dense(35)),{ok:false,code:'graph_budget_exceeded'});
});
test('aggregate acknowledgement budget rejects repetitive callback declarations',()=>{
  const x=chain(200);
  // Each entry is locally unique; aggregate cost would otherwise be unchecked.
  for(let i=0;i<199;i++)x.nodes[i].acknowledges=Array.from({length:11},(_,j)=>'demo-key-'+i+'-'+j);
  assert.deepEqual(check(x),{ok:false,code:'graph_budget_exceeded'});
});
test('budget failures do not echo synthetic keys or arbitrary text',()=>{
  const x=dense(70);x.nodes[0].exits[0].impactKey='demo-secret-marker';
  const r=check(x);
  assert.equal(r.ok,false);
  assert.equal(JSON.stringify(r).includes('secret-marker'),false);
  assert.deepEqual(Object.keys(r).sort(),['code','ok']);
});
test('malformed root remains a shape error',()=>{
  assert.deepEqual(check({start:'demo-start',nodes:[]}),{ok:false,code:'shape_invalid'});
});
