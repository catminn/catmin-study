// Spoiler-free synthetic contract; not a production adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>own(o,k));
const idOk=id=>typeof id==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(id);
const scope={worldId:'demo-world',revision:'demo-r1',sessionId:'demo-session'};
const event=id=>({eventId:id,type:'fact_verified',scope,factId:'demo-public',subject:'npc'});
const fixture=()=>({ledgerSchemaVersion:2,commitCount:2,commits:{'demo-a':JSON.stringify(event('demo-a')),'demo-b':JSON.stringify(event('demo-b'))}});
function validEnvelope(s){
 if(!exact(s,['ledgerSchemaVersion','commitCount','commits'])||s.ledgerSchemaVersion!==2||!Number.isSafeInteger(s.commitCount)||s.commitCount<0||!s.commits||typeof s.commits!=='object'||Array.isArray(s.commits)||Object.getPrototypeOf(s.commits)!==Object.prototype)return false;
 const ids=Object.keys(s.commits);if(ids.length!==s.commitCount)return false;
 for(const id of ids){
  if(!idOk(id)||typeof s.commits[id]!=='string')return false;
  let entry;try{entry=JSON.parse(s.commits[id]);}catch{return false;}
  if(!exact(entry,['eventId','type','scope','factId','subject'])||entry.eventId!==id||entry.type!=='fact_verified'||entry.subject!=='npc'||entry.factId!=='demo-public'||!exact(entry.scope,['worldId','revision','sessionId'])||Object.keys(scope).some(k=>entry.scope[k]!==scope[k])||JSON.stringify(entry)!==s.commits[id])return false;
 }return true;
}
test('schema version is independent of commit count',()=>{
 assert.equal(validEnvelope({ledgerSchemaVersion:2,commitCount:0,commits:{}}),true);
 assert.equal(validEnvelope(fixture()),true);
 const s=fixture();s.commits['demo-c']=JSON.stringify(event('demo-c'));s.commitCount=3;assert.equal(validEnvelope(s),true);
});
test('count tampering and swapped identities fail closed',()=>{
 const s=fixture();s.commitCount=3;assert.equal(validEnvelope(s),false);
 s.commitCount=2;[s.commits['demo-a'],s.commits['demo-b']]=[s.commits['demo-b'],s.commits['demo-a']];assert.equal(validEnvelope(s),false);
});
test('legacy count-only snapshots and extra fields fail closed',()=>{
 const s=fixture();delete s.ledgerSchemaVersion;assert.equal(validEnvelope(s),false);
 s.ledgerSchemaVersion=2;s.version=2;assert.equal(validEnvelope(s),false);
});
test('scope changes, malformed JSON and extra fingerprint fields fail closed',()=>{
 const s=fixture();s.commits['demo-a']=JSON.stringify({...event('demo-a'),scope:{...scope,sessionId:'other'}});assert.equal(validEnvelope(s),false);
 s.commits['demo-a']=JSON.stringify({...event('demo-a'),secret:'unreviewed'});assert.equal(validEnvelope(s),false);
 s.commits['demo-a']='not-json';assert.equal(validEnvelope(s),false);
});