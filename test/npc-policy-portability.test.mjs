import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {policy, initialState, applyCommitted, projectDialogue} from '../scripts/npc-testimony-reference.mjs';
import {validateDmNpcRouteBridge} from '../scripts/validate-dm-npc-route-bridge.mjs';

const baseFlow=JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/dm-npc-route-synthetic-v1.json',import.meta.url)),'utf8'));
const names={'demo-fork':'sample-crossroads','demo-route-a':'sample-east','demo-route-b':'sample-west','demo-join':'sample-reunion'};
const remap=x=>typeof x==='string'?(names[x]??x):Array.isArray(x)?x.map(remap):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,remap(v)])):x;
function fixture(){
  const p=structuredClone(policy);
  p.routes['demo-a']={from:'sample-crossroads',to:'sample-east',relation:'reserved',trace:'demo.trace-a'};
  p.routes['demo-b']={from:'sample-crossroads',to:'sample-west',relation:'welcoming',trace:'demo.trace-b'};
  p.convergence={from:['sample-east','sample-west'],to:'sample-reunion'};
  p.publicCopies['demo-guarded'].relation='reserved';
  p.publicCopies['demo-open'].relation='welcoming';
  const bridge={schemaVersion:'dm-npc-route-bridge-v1',synthetic:true,worldId:'demo-world',manifestRevision:'demo-r1',choiceBeatId:'sample-crossroads',convergenceBeatId:'sample-reunion',routeBindings:[
    {routeBeatId:'sample-east',npcRouteKey:'demo-a',traceRef:'demo.trace-a',callbackCopySlot:'demo.callback-a',dialogueCopyId:'demo-guarded'},
    {routeBeatId:'sample-west',npcRouteKey:'demo-b',traceRef:'demo.trace-b',callbackCopySlot:'demo.callback-b',dialogueCopyId:'demo-open'}
  ]};
  return {p,flow:remap(baseFlow),bridge};
}
const event=(s,type,more={})=>({id:'sample-event-'+s.version,type,scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version,...more});
const commit=(s,type,p,more)=>applyCommitted(s,event(s,type,more),p);

test('default demo fixture remains unchanged',()=>{
  assert.equal(initialState().scene,'demo-fork');
  assert.equal(initialState().npc.location,'demo-fork');
});
test('custom author origin determines both starting locations',()=>{
  const {p}=fixture(),s=initialState(p);
  assert.equal(s.scene,'sample-crossroads');
  assert.equal(s.npc.location,'sample-crossroads');
  assert.equal(s.npc.relation,'neutral');
});
test('both renamed routes preserve their own authored relations through convergence',()=>{
  const {p}=fixture();
  for(const [route,relation,copy] of [['demo-a','reserved','demo-guarded'],['demo-b','welcoming','demo-open']]){
    const first=commit(initialState(p),'route_committed',p,{route,next:p.routes[route].to});
    assert.equal(first.ok,true);
    assert.equal(first.state.npc.relation,relation);
    assert.equal(projectDialogue(first.state,copy,p).text,null);
    const join=commit(first.state,'scene_entered',p,{next:p.convergence.to});
    assert.equal(join.ok,true);
    assert.equal(join.state.npc.relation,relation);
    assert.equal(projectDialogue(join.state,copy,p).text,p.publicCopies[copy].text);
    const other=copy==='demo-guarded'?'demo-open':'demo-guarded';
    assert.equal(projectDialogue(join.state,other,p).text,null);
  }
});
test('renamed authored policy passes the existing full NPC/beat bridge',()=>{
  const {p,flow,bridge}=fixture();
  assert.deepEqual(validateDmNpcRouteBridge(flow,p,bridge),{ok:true,codes:[],errorCount:0});
});
test('different authored route origins are rejected without invented location',()=>{
  const {p,flow,bridge}=fixture();
  p.routes['demo-b'].from='sample-other';
  assert.throws(()=>initialState(p),/invalid_route_policy/);
  const result=validateDmNpcRouteBridge(flow,p,bridge);
  assert.equal(result.ok,false);
  assert.ok(result.codes.includes('invalid_npc_policy'));
  assert.equal(JSON.stringify(result).includes('sample-other'),false);
});
test('empty route policy is rejected without a fallback demo scene',()=>{
  const {p,flow,bridge}=fixture();
  p.routes={};
  assert.throws(()=>initialState(p),/invalid_route_policy/);
  assert.ok(validateDmNpcRouteBridge(flow,p,bridge).codes.includes('invalid_npc_policy'));
});
test('a corrupted relation outside authored bands cannot produce dialogue or commit',()=>{
  const {p}=fixture(),s=initialState(p);
  s.npc.relation='invented';
  assert.deepEqual(projectDialogue(s,'demo-neutral',p),{available:false,text:null});
  const result=commit(s,'route_committed',p,{route:'demo-a',next:'sample-east'});
  assert.equal(result.ok,false);
  assert.equal(result.code,'state_invalid');
  assert.strictEqual(result.state,s);
});
test('ASK and preview remain no-ops with a renamed starting scene',()=>{
  const {p}=fixture(),s=initialState(p);
  for(const mode of ['ask','preview']){
    const out=applyCommitted(s,{...event(s,'route_committed',{route:'demo-a',next:'sample-east'}),mode},p);
    assert.equal(out.ok,true);
    assert.equal(out.committed,false);
    assert.strictEqual(out.state,s);
  }
});
