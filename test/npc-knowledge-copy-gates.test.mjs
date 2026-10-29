import test from 'node:test';
import assert from 'node:assert/strict';
import { policy, initialState, applyCommitted, projectDialogue } from '../scripts/npc-testimony-reference.mjs';
const fresh = () => initialState();
const emit = (s, type, extra={}) => {
  const e={id:'demo-gate-'+(s.version+1),type,scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version,...extra};
  const result=applyCommitted(s,e);
  assert.equal(result.ok,true);
  return result.state;
};
const text = (s,id,p=policy) => projectDialogue(s,id,p).text;

test('knowledge-dependent dialogue is silent before the NPC learns the claim',()=>{
  const s=fresh();
  for(const id of ['demo-heard','demo-confirmed','demo-private-gated'])assert.equal(text(s,id),null);
});
test('NPC hearing a claim unlocks only heard-tier wording, not confirmed wording',()=>{
  const s=emit(fresh(),'player_told_npc',{factId:'demo-public-fact'});
  assert.equal(text(s,'demo-heard'),'I have heard that account.');
  assert.equal(text(s,'demo-confirmed'),null);
  assert.deepEqual(s.npc.confirmedFacts,[]);
});
test('NPC independently verifying a fact unlocks both heard and confirmed copy',()=>{
  const s=emit(fresh(),'fact_verified',{factId:'demo-public-fact',subject:'npc'});
  assert.equal(text(s,'demo-heard'),'I have heard that account.');
  assert.equal(text(s,'demo-confirmed'),'I checked the account.');
});
test('player-only verification cannot grant NPC knowledge',()=>{
  const s=emit(fresh(),'fact_verified',{factId:'demo-public-fact',subject:'player'});
  assert.equal(text(s,'demo-heard'),null);
  assert.equal(text(s,'demo-confirmed'),null);
});
test('private NPC knowledge may gate neutral reviewed wording but is never serialized',()=>{
  const s=emit(fresh(),'fact_verified',{factId:'demo-private-fact',subject:'npc'});
  const projection=projectDialogue(s,'demo-private-gated');
  assert.deepEqual(projection,{available:true,text:'The person looks away.'});
  const out=JSON.stringify(projection);
  for(const secret of ['demo-private-fact','confirmedFacts','requiresNpcKnowledge','server_only'])assert.equal(out.includes(secret),false);
});
test('invalid knowledge gates fail closed even when a copy is flagged approved',()=>{
  const invalid=[null,{},[],{factId:'demo-public-fact',tier:'rumor'},
    {factId:'not-in-policy',tier:'heard'}, {factId:'demo-public-fact',tier:'heard',extra:'hidden'}];
  const s=emit(fresh(),'fact_verified',{factId:'demo-public-fact',subject:'npc'});
  for(const gate of invalid){
    const p=structuredClone(policy);
    p.publicCopies['demo-neutral'].requiresNpcKnowledge=gate;
    assert.equal(text(s,'demo-neutral',p),null);
  }
});
test('unapproved, wrong-relation, unavailable and remote copies remain inaccessible',()=>{
  const s=fresh();
  assert.equal(text(s,'demo-guarded'),null);
  const p=structuredClone(policy);
  p.publicCopies['demo-heard'].approved=false;
  const heard=emit(s,'player_told_npc',{factId:'demo-public-fact'});
  assert.equal(text(heard,'demo-heard',p),null);
  const away=emit(heard,'availability_changed',{next:'unavailable'});
  assert.deepEqual(projectDialogue(away,'demo-heard'),{available:false,text:null});
  const route=emit(heard,'route_committed',{route:'demo-a',next:'demo-route-a'});
  assert.deepEqual(projectDialogue(route,'demo-heard'),{available:false,text:null});
});
test('ASK and preview cannot create knowledge or unlock a line',()=>{
  const s=fresh();
  for(const mode of ['ask','preview']){
    const r=applyCommitted(s,{id:'demo-ask',mode,type:'fact_verified',factId:'demo-public-fact',subject:'npc',scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version});
    assert.equal(r.committed,false);
    assert.strictEqual(r.state,s);
    assert.equal(text(s,'demo-confirmed'),null);
  }
});
