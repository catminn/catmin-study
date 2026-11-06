import test from 'node:test';
import assert from 'node:assert/strict';
import {policy, initialState, applyCommitted, projectDialogue} from '../scripts/npc-testimony-reference.mjs';

// Only invented IDs and lines. This is not a trusted event log or production migration.
const event=(s,type,extra={})=>({id:'demo-ledger-'+(s.version+1),type,scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version,...extra});
const commit=(s,type,extra={})=>{const r=applyCommitted(s,event(s,type,extra));assert.equal(r.ok,true);return r.state;};
const route=(key='demo-a')=>commit(initialState(),'route_committed',{route:key,next:policy.routes[key].to});
const joined=(key='demo-a')=>commit(route(key),'scene_entered',{next:policy.convergence.to});
const mutate=(fn)=>{const s=joined();fn(s);return s;};
const reject=(s)=>{const snapshot=structuredClone(s);const r=applyCommitted(s,event(s,'availability_changed',{next:'unavailable'}));assert.equal(r.code,'state_invalid');assert.strictEqual(r.state,s);assert.deepEqual(s,snapshot);assert.deepEqual(projectDialogue(s,'demo-guarded'),{available:false,text:null});};
const edit=(s,index,fn)=>{const key=Object.keys(s.commits)[index];s.commits[key]=JSON.stringify(fn(JSON.parse(s.commits[key])));};
for(const key of ['demo-a','demo-b']) {
 test('valid synthetic route and reunion: '+key,()=>{
  for(const s of [route(key),joined(key)])assert.equal(commit(s,'availability_changed',{next:'unavailable'}).version,s.version+1);
 });
}
test('valid pre-route fact event and post-route availability preserve provenance',()=>{
 let s=commit(initialState(),'fact_verified',{factId:'demo-public-fact',subject:'player'});
 s=commit(s,'route_committed',{route:'demo-a',next:'demo-route-a'});
 s=commit(s,'availability_changed',{next:'available'});
 s=commit(s,'scene_entered',{next:'demo-join'});
 assert.equal(projectDialogue(s,'demo-guarded').text,policy.publicCopies['demo-guarded'].text);
});
test('valid NPC testimony events remain accepted',()=>{
 let s=commit(initialState(),'fact_verified',{factId:'demo-public-fact',subject:'npc'});
 s=commit(s,'npc_told_player',{factId:'demo-public-fact'});
 s=commit(s,'player_told_npc',{factId:'demo-public-fact'});
 assert.equal(s.player.heardClaims.includes('demo-public-fact'),true);
});
test('fabricated route record with other branch is rejected',()=>reject(mutate(s=>edit(s,0,e=>({...e,route:'demo-b',next:'demo-route-b'})))));
test('count-matched ledger without route event is rejected',()=>reject(mutate(s=>edit(s,0,e=>({type:'availability_changed',scope:e.scope,next:'available'})))));
test('count-matched ledger without reunion event is rejected',()=>reject(mutate(s=>edit(s,1,e=>({type:'availability_changed',scope:e.scope,next:'available'})))));
test('reunion evidence before route evidence is rejected',()=>reject(mutate(s=>{const keys=Object.keys(s.commits);[s.commits[keys[0]],s.commits[keys[1]]]=[s.commits[keys[1]],s.commits[keys[0]]];})));
test('malformed fingerprint fails closed',()=>reject(mutate(s=>{s.commits[Object.keys(s.commits)[0]]='invalid-json';})));
test('unknown committed event kind fails closed',()=>reject(mutate(s=>edit(s,0,e=>({...e,type:'secret_grant'})))));
test('route fingerprint from a different session fails closed',()=>reject(mutate(s=>edit(s,0,e=>({...e,scope:{...e.scope,sessionId:'other'}})))));
test('duplicate route evidence cannot justify reunion',()=>reject(mutate(s=>edit(s,1,e=>({...e,type:'route_committed',route:'demo-a',next:'demo-route-a'})))));
test('initial stage cannot have a route event hidden in its ledger',()=>{
 const s=commit(initialState(),'availability_changed',{next:'available'});
 edit(s,0,e=>({...e,type:'route_committed',route:'demo-a',next:'demo-route-a'}));reject(s);
});
test('route stage cannot claim reunion already happened',()=>{
 const s=commit(route(),'availability_changed',{next:'available'});
 edit(s,1,e=>({...e,type:'scene_entered',next:'demo-join'}));reject(s);
});
test('unknown fact evidence cannot be inserted into ledger',()=>reject(mutate(s=>edit(s,0,e=>({...e,type:'fact_verified',factId:'demo-unknown',subject:'npc'})))));
test('valid committed event still replays without another mutation',()=>{
 const s=initialState(),e=event(s,'route_committed',{route:'demo-a',next:'demo-route-a'}),r=applyCommitted(s,e);
 assert.equal(r.ok,true);const replay=applyCommitted(r.state,e);assert.equal(replay.replay,true);assert.strictEqual(replay.state,r.state);
});
test('ASK and preview reject corrupted persisted state',()=>{
 const s=mutate(x=>{x.commits[Object.keys(x.commits)[0]]='bad';});
 for(const mode of ['ask','preview'])assert.equal(applyCommitted(s,{scope:s.scope,mode}).code,'state_invalid');
});
