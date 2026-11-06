import test from 'node:test';
import assert from 'node:assert/strict';
// Synthetic authoring boundary, not a production verifier or legacy migration.
const scope={worldId:'demo-world',revision:'demo-r1',sessionId:'demo-session'};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>own(o,k));
const payloadFields={fact_verified:['factId','subject'],availability_changed:['next']};
const fingerprint=(id,type,payload={})=>JSON.stringify({eventId:id,type,scope,...payload});
const make=()=>({ledgerSchemaVersion:2,commitCount:2,scope:{...scope},commits:{
  'event-a':fingerprint('event-a','fact_verified',{factId:'demo-fact',subject:'npc'}),
  'event-b':fingerprint('event-b','fact_verified',{factId:'demo-fact',subject:'npc'})
}});
function validLedger(s){
  if(!exact(s,['ledgerSchemaVersion','commitCount','scope','commits'])||s.ledgerSchemaVersion!==2||
     !Number.isSafeInteger(s.commitCount)||s.commitCount<0||
     !exact(s.scope,['worldId','revision','sessionId'])||
     !Object.keys(scope).every(k=>s.scope[k]===scope[k])||
     !s.commits||typeof s.commits!=='object'||Array.isArray(s.commits)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(s.commits)))return false;
  const ids=Object.keys(s.commits);
  if(ids.length!==s.commitCount)return false;
  return ids.every(id=>{
    if(!/^[a-z][a-z0-9._-]{0,79}$/.test(id)||typeof s.commits[id]!=='string')return false;
    let entry;try{entry=JSON.parse(s.commits[id]);}catch{return false;}
    if(!entry||typeof entry.type!=='string'||!own(payloadFields,entry.type)||
       !exact(entry,['eventId','type','scope',...payloadFields[entry.type]])||
       entry.eventId!==id||!exact(entry.scope,['worldId','revision','sessionId'])||
       !Object.keys(scope).every(k=>entry.scope[k]===scope[k]))return false;
    const payload=Object.fromEntries(payloadFields[entry.type].map(k=>[k,entry[k]]));
    return s.commits[id]===fingerprint(id,entry.type,payload);
  });
}
test('accepts synthetic bound v2 ledger',()=>assert.equal(validLedger(make()),true));
test('rejects swapped identities with identical effects',()=>{
  const s=make();[s.commits['event-a'],s.commits['event-b']]=[s.commits['event-b'],s.commits['event-a']];
  assert.equal(validLedger(s),false);
});
test('rejects count tampering and legacy snapshot',()=>{
  const s=make();s.commitCount=1;assert.equal(validLedger(s),false);
  const old=make();delete old.ledgerSchemaVersion;assert.equal(validLedger(old),false);
});
test('rejects unknown fields and foreign scope',()=>{
  const s=make();s.extra=true;assert.equal(validLedger(s),false);
  const t=make();t.scope.sessionId='other';assert.equal(validLedger(t),false);
});
test('rejects malformed and mismatched records',()=>{
  const s=make();s.commits['event-a']='{';assert.equal(validLedger(s),false);
  const t=make();t.commits['event-a']=JSON.stringify({...JSON.parse(t.commits['event-a']),extra:true});
  assert.equal(validLedger(t),false);
  const u=make();delete u.commits['event-a'];u.commits['bad id']='{}';assert.equal(validLedger(u),false);
});
