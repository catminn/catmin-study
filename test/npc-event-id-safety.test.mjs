import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted} from '../scripts/npc-testimony-reference.mjs';

const fresh = () => initialState();
const committed = (s, id) => ({
  id, type:'route_committed', scope:structuredClone(s.scope), source:'server',
  status:'committed', expectedVersion:s.version, route:'demo-a', next:'demo-route-a'
});
const fail = (id) => {
  const s=fresh(), snapshot=structuredClone(s);
  const result=applyCommitted(s,committed(s,id));
  assert.deepEqual(result,{ok:false,code:'not_committed',state:s});
  assert.strictEqual(result.state,s);
  assert.deepEqual(s,snapshot);
  assert.equal(s.version,0);
  assert.deepEqual(Object.keys(s.commits),[]);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SECRET/);
};

test('prototype magic key is rejected before NPC state or commit ledger changes',()=>fail('__proto__'));
test('blank and whitespace event IDs fail closed',()=>{for(const id of ['', ' ', 'demo event', '\n'])fail(id)});
test('event IDs with forbidden separators and path-like syntax fail closed',()=>{for(const id of ['demo/event','demo:event','demo\\event'])fail(id)});
test('oversized and non-ASCII event IDs fail closed',()=>{for(const id of ['a'.repeat(81),'秘密事件','PRIVATE_SECRET'])fail(id)});
test('non-string event IDs fail closed',()=>{for(const id of [null,undefined,0,{},['demo-event']])fail(id)});
test('valid dotted, dashed, and underscored IDs still commit once',()=>{
  for(const id of ['demo-event-1','demo.event_2','a','a'.repeat(80)]){
    const s=fresh(),e=committed(s,id),r=applyCommitted(s,e);
    assert.equal(r.ok,true);assert.equal(r.committed,true);assert.equal(r.state.version,1);
    assert.equal(Object.hasOwn(r.state.commits,id),true);
    const again=applyCommitted(r.state,e);
    assert.equal(again.ok,true);assert.equal(again.replay,true);assert.equal(again.committed,false);
    assert.strictEqual(again.state,r.state);
  }
});
test('valid event ID collision with a different route is denied without mutation',()=>{
  const s=fresh(),e=committed(s,'demo-event-1'),r=applyCommitted(s,e);
  const snapshot=structuredClone(r.state);
  const collision=applyCommitted(r.state,{...e,route:'demo-b',next:'demo-route-b'});
  assert.equal(collision.code,'event_id_reused');
  assert.strictEqual(collision.state,r.state);
  assert.deepEqual(r.state,snapshot);
});
test('ASK and preview remain non-committing even with malformed event ID',()=>{
  const s=fresh(),snapshot=structuredClone(s);
  for(const mode of ['ask','preview']){
    const r=applyCommitted(s,{...committed(s,'__proto__'),mode});
    assert.equal(r.ok,true);assert.equal(r.committed,false);assert.strictEqual(r.state,s);
  }
  assert.deepEqual(s,snapshot);
});
