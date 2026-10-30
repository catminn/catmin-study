import test from 'node:test';
import assert from 'node:assert/strict';
import {policy,initialState,applyCommitted,projectDialogue} from '../scripts/npc-testimony-reference.mjs';

// Invented IDs only; this is an author-reference test, never a trusted server log.
const event=(s,type,extra={})=>({id:'demo-knowledge-'+(s.version+1),type,
  scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version,...extra});
const emit=(s,type,extra={})=>{const r=applyCommitted(s,event(s,type,extra));assert.equal(r.ok,true);return r.state;};
const fact=(s,subject='npc',factId='demo-public-fact')=>emit(s,'fact_verified',{subject,factId});
const rewrite=(s,index,patch)=>{const k=Object.keys(s.commits)[index];s.commits[k]=JSON.stringify({...JSON.parse(s.commits[k]),...patch});};
const invalid=s=>{const before=structuredClone(s);
  const r=applyCommitted(s,event(s,'availability_changed',{next:'unavailable'}));
  assert.equal(r.code,'state_invalid');assert.strictEqual(r.state,s);assert.deepEqual(s,before);
  assert.deepEqual(projectDialogue(s,'demo-neutral'),{available:false,text:null});
};
test('NPC verification legitimately unlocks a confirmed-tier line',()=>{
  assert.equal(projectDialogue(fact(initialState()),'demo-confirmed').text,policy.publicCopies['demo-confirmed'].text);
});
test('player verification and testimony legitimately unlock heard-tier NPC copy',()=>{
  const s=emit(fact(initialState(),'player'),'player_told_npc',{factId:'demo-public-fact'});
  assert.equal(projectDialogue(s,'demo-heard').text,policy.publicCopies['demo-heard'].text);
});
test('NPC testimony legitimately creates player hearsay',()=>{
  const s=emit(fact(initialState()),'npc_told_player',{factId:'demo-public-fact'});
  assert.deepEqual(s.player.heardClaims,['demo-public-fact']);
});
test('private NPC verification remains valid without public disclosure',()=>{
  const s=fact(initialState(),'npc','demo-private-fact');
  assert.equal(projectDialogue(s,'demo-private-gated').text,policy.publicCopies['demo-private-gated'].text);
});
test('legitimate evidence survives route and reunion',()=>{
  let s=fact(initialState());
  s=emit(s,'route_committed',{route:'demo-a',next:'demo-route-a'});
  s=emit(s,'scene_entered',{next:'demo-join'});
  assert.equal(projectDialogue(s,'demo-guarded').text,policy.publicCopies['demo-guarded'].text);
});
test('availability toggles and repeated verification preserve legitimate state',()=>{
  let s=fact(initialState());s=fact(s);
  s=emit(s,'availability_changed',{next:'unavailable'});
  s=emit(s,'availability_changed',{next:'available'});
  assert.deepEqual(s.npc.confirmedFacts,['demo-public-fact']);
  assert.equal(projectDialogue(s,'demo-confirmed').text,policy.publicCopies['demo-confirmed'].text);
});
for(const [label,owner,field] of [
  ['NPC confirmed','npc','confirmedFacts'],['player confirmed','player','confirmedFacts'],
  ['NPC heard','npc','heardClaims'],['player heard','player','heardClaims']
]) test('fabricated persisted '+label+' knowledge fails closed',()=>{
  const s=initialState();s[owner][field].push('demo-public-fact');invalid(s);
});
test('missing persisted knowledge after a legitimate commit fails closed',()=>{
  const s=fact(initialState());s.npc.confirmedFacts=[];invalid(s);
});
test('availability snapshot cannot contradict the ledger',()=>{
  const s=emit(initialState(),'availability_changed',{next:'unavailable'});
  s.npc.availability='available';invalid(s);
});
test('forged player verification of private fact in fingerprint fails closed',()=>{
  const s=fact(initialState(),'npc','demo-private-fact');
  rewrite(s,0,{subject:'player'});s.npc.confirmedFacts=[];invalid(s);
});
test('forged player-to-NPC testimony without player knowledge fails closed',()=>{
  const s=emit(fact(initialState()),'npc_told_player',{factId:'demo-public-fact'});
  rewrite(s,1,{type:'player_told_npc'});s.player.heardClaims=[];s.npc.heardClaims=['demo-public-fact'];invalid(s);
});
test('forged NPC-to-player testimony without NPC knowledge fails closed',()=>{
  const s=emit(fact(initialState(),'player'),'player_told_npc',{factId:'demo-public-fact'});
  rewrite(s,1,{type:'npc_told_player'});s.npc.heardClaims=[];s.player.heardClaims=['demo-public-fact'];invalid(s);
});
test('forged testimony while NPC is in another scene fails closed',()=>{
  let s=fact(initialState());
  s=emit(s,'route_committed',{route:'demo-a',next:'demo-route-a'});
  s=emit(s,'availability_changed',{next:'available'});
  s=emit(s,'scene_entered',{next:'demo-join'});
  rewrite(s,2,{type:'npc_told_player',factId:'demo-public-fact'});
  s.player.heardClaims=['demo-public-fact'];invalid(s);
});
test('forged testimony during NPC unavailability fails closed',()=>{
  let s=fact(initialState());
  s=emit(s,'availability_changed',{next:'unavailable'});
  s=emit(s,'availability_changed',{next:'available'});
  rewrite(s,2,{type:'npc_told_player',factId:'demo-public-fact'});
  s.player.heardClaims=['demo-public-fact'];s.npc.availability='unavailable';invalid(s);
});
