import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteConsequenceOutline as check} from '../scripts/validate-route-consequence-outline.mjs';
// All IDs are invented; there is no formal-world plot, character, puzzle, or secret.
const node=(id,{end=false,exits=[],acknowledges=[]}={})=>({id,end,exits,acknowledges});
const edge=(to,impactKey=null)=>({to,impactKey});
const fixture=()=>({start:'demo-entry',nodes:[
  node('demo-entry',{exits:[edge('demo-left','demo-left-effect'),edge('demo-right','demo-right-effect')]}),
  node('demo-left',{acknowledges:['demo-left-effect'],exits:[edge('demo-join')]}),
  node('demo-right',{acknowledges:['demo-right-effect'],exits:[edge('demo-join')]}),
  node('demo-join',{exits:[edge('demo-end')]}),node('demo-end',{end:true})
]});
const reject=(m,code)=>assert.deepEqual(check(m),{ok:false,code});
test('every outcome acknowledged before merge is accepted',()=>assert.deepEqual(check(fixture()),{ok:true,nodeCount:5,branchOutcomeCount:2}));
test('missing one branch callback is rejected',()=>{const m=fixture();m.nodes[2].acknowledges=[];reject(m,'callback_missing')});
test('callback in shared beat may be conditionally keyed to chosen outcome',()=>{const m=fixture();m.nodes[1].acknowledges=[];m.nodes[2].acknowledges=[];m.nodes[3].acknowledges=['demo-left-effect','demo-right-effect'];assert.equal(check(m).ok,true)});
test('callback on only one suffix after a second fork is insufficient',()=>{const m=fixture();m.nodes[1].acknowledges=[];m.nodes.splice(3,0,node('demo-detour',{exits:[edge('demo-join')]}));m.nodes[1].exits=[edge('demo-detour','demo-detour-effect'),edge('demo-join','demo-shortcut-effect')];m.nodes[3].acknowledges=['demo-left-effect','demo-detour-effect'];m.nodes[4].acknowledges=['demo-shortcut-effect'];reject(m,'callback_missing')});
test('a later shared callback covers all suffixes of an outcome',()=>{const m=fixture();m.nodes[1].acknowledges=[];m.nodes[3].acknowledges=['demo-left-effect'];assert.equal(check(m).ok,true)});
test('terminal callbacks are not a pre-ending consequence',()=>{const m=fixture();m.nodes[1].acknowledges=[];m.nodes[4].acknowledges=['demo-left-effect'];reject(m,'exit_invalid')});
test('unknown callback keys fail closed',()=>{const m=fixture();m.nodes[3].acknowledges=['demo-unknown'];reject(m,'reference_invalid')});
test('duplicate impact keys across choices are rejected',()=>{const m=fixture();m.nodes[0].exits[1].impactKey='demo-left-effect';reject(m,'impact_invalid')});
test('a fork cannot silently omit its impact key',()=>{const m=fixture();m.nodes[0].exits[1].impactKey=null;reject(m,'impact_invalid')});
test('a linear edge cannot masquerade as a new choice',()=>{const m=fixture();m.nodes[1].exits[0].impactKey='demo-extra';reject(m,'impact_invalid')});
test('two branch outcomes cannot share the same target',()=>{const m=fixture();m.nodes[0].exits[1].to='demo-left';reject(m,'edge_invalid')});
test('unknown destination is rejected',()=>{const m=fixture();m.nodes[1].exits[0].to='demo-absent';reject(m,'edge_invalid')});
test('a cycle is rejected',()=>{const m=fixture();m.nodes[3].exits=[edge('demo-entry')];reject(m,'cycle_invalid')});
test('unreachable branch is rejected',()=>{const m=fixture();m.nodes.push(node('demo-island',{exits:[edge('demo-end')]}));reject(m,'unreachable_node')});
test('extra unreviewed fields cannot hide runtime gates',()=>{const m=fixture();m.nodes[1].requiresPractice=true;reject(m,'node_invalid')});
test('unreviewed edge fields are rejected',()=>{const m=fixture();m.nodes[0].exits[0].requiresVerifiedPractice=true;reject(m,'edge_invalid')});
test('errors never echo opaque author keys',()=>{const m=fixture();m.nodes[2].acknowledges=[];const out=check(m);assert.deepEqual(out,{ok:false,code:'callback_missing'});assert.equal(JSON.stringify(out).includes('demo-right-effect'),false)});
test('a linear chapter without choices is allowed',()=>{const m={start:'demo-a',nodes:[node('demo-a',{exits:[edge('demo-b')]}),node('demo-b',{end:true})]};assert.deepEqual(check(m),{ok:true,nodeCount:2,branchOutcomeCount:0})});

test('callback for one outcome on the opposite exclusive route is rejected even when correctly covered',()=>{
  const m=fixture();
  m.nodes[2].acknowledges.push('demo-left-effect');
  reject(m,'callback_off_route');
});
test('callback before the decision is rejected even when correctly covered afterward',()=>{
  const m=fixture();
  m.nodes.unshift(node('demo-prologue',{exits:[edge('demo-entry')],acknowledges:['demo-left-effect']}));
  m.start='demo-prologue';
  reject(m,'callback_off_route');
});
test('multiple conditional callbacks at shared reunion are allowed',()=>{
  const m=fixture();
  m.nodes[3].acknowledges=['demo-left-effect','demo-right-effect'];
  assert.equal(check(m).ok,true);
});
test('wrong-route callback failure does not echo its key',()=>{
  const m=fixture();
  m.nodes[2].acknowledges.push('demo-left-effect');
  const r=check(m);
  assert.deepEqual(r,{ok:false,code:'callback_off_route'});
  assert.equal(JSON.stringify(r).includes('demo-left-effect'),false);
});
