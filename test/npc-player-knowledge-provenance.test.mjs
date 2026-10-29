import test from 'node:test';
import assert from 'node:assert/strict';
import {policy,initialState,applyCommitted,projectDialogue} from '../scripts/npc-testimony-reference.mjs';
const fresh=()=>initialState();
const event=(s,type,extra={})=>({id:'demo-provenance-'+(s.version+1),type,scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version,...extra});
const apply=(s,type,extra,p=policy)=>applyCommitted(s,event(s,type,extra),p);
const verified=(subject='player')=>apply(fresh(),'fact_verified',{factId:'demo-public-fact',subject}).state;
test('unlearned public fact cannot be laundered from player to NPC',()=>{
 const s=fresh(),snapshot=structuredClone(s),r=apply(s,'player_told_npc',{factId:'demo-public-fact'});
 assert.equal(r.code,'player_cannot_testify');assert.strictEqual(r.state,s);assert.deepEqual(s,snapshot);assert.equal(projectDialogue(s,'demo-heard').text,null);
});
test('server-only fact cannot be introduced by player even if local player state is forged',()=>{
 const s=fresh();s.player.heardClaims.push('demo-private-fact');const r=apply(s,'player_told_npc',{factId:'demo-private-fact'});
 assert.equal(r.code,'audience_denied');assert.strictEqual(r.state,s);assert.deepEqual(s.npc.heardClaims,[]);
});
test('verified player may tell NPC, but NPC remains unconfirmed',()=>{
 const s=verified(),r=apply(s,'player_told_npc',{factId:'demo-public-fact'});
 assert.equal(r.ok,true);assert.deepEqual(r.state.npc.heardClaims,['demo-public-fact']);assert.deepEqual(r.state.npc.confirmedFacts,[]);
 assert.equal(projectDialogue(r.state,'demo-heard').text,'I have heard that account.');assert.equal(projectDialogue(r.state,'demo-confirmed').text,null);
});
test('NPC testimony gives player hearsay which can be repeated without confirmation',()=>{
 const s=verified('npc'),heard=apply(s,'npc_told_player',{factId:'demo-public-fact'}).state;
 assert.deepEqual(heard.player.heardClaims,['demo-public-fact']);assert.deepEqual(heard.player.confirmedFacts,[]);
 const repeated=apply(heard,'player_told_npc',{factId:'demo-public-fact'});assert.equal(repeated.ok,true);assert.deepEqual(repeated.state.player.confirmedFacts,[]);
});
test('NPC knowing a fact does not transfer it to player before testimony',()=>{
 assert.equal(apply(verified('npc'),'player_told_npc',{factId:'demo-public-fact'}).code,'player_cannot_testify');
});
test('wrong fact and malformed player knowledge fail closed',()=>{
 const s=verified(),p=structuredClone(policy);p.facts['demo-other-public']={audience:'player'};
 assert.equal(apply(s,'player_told_npc',{factId:'demo-other-public'},p).code,'player_cannot_testify');
 const corrupt=structuredClone(s);corrupt.player.heardClaims=null;corrupt.player.confirmedFacts=null;
 assert.equal(apply(corrupt,'player_told_npc',{factId:'demo-public-fact'}).code,'player_cannot_testify');
});
test('remote player testimony remains blocked after player learns',()=>{
 const s=verified(),away=apply(s,'route_committed',{route:'demo-a',next:'demo-route-a'}).state;
 assert.equal(apply(away,'player_told_npc',{factId:'demo-public-fact'}).code,'encounter_invalid');
});
test('ASK and preview cannot launder facts into NPC memory',()=>{
 const s=fresh();for(const mode of ['ask','preview']){const r=applyCommitted(s,{...event(s,'player_told_npc',{factId:'demo-public-fact'}),mode});
 assert.equal(r.ok,true);assert.equal(r.committed,false);assert.strictEqual(r.state,s);}
 assert.deepEqual(s.player.heardClaims,[]);assert.deepEqual(s.npc.heardClaims,[]);
});