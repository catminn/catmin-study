// Synthetic v2 authoring contract only. No production migration or private content.
import test from 'node:test';
import assert from 'node:assert/strict';
const fields = ['eventId','type','scope','route','factId','next','subject'];
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const exact = (o,keys) => o && typeof o==='object' && !Array.isArray(o) && Object.keys(o).length===keys.length && keys.every(k=>own(o,k));
const safeId = s => typeof s==='string' && /^[a-z][a-z0-9-]{0,63}$/.test(s);
const record = (eventId,factId) => ({eventId,type:'fact_verified',scope:'demo',route:'neutral',factId,next:'verified',subject:'npc'});
// Legacy eventId -> fingerprint maps cannot prove their historical identity;
// do not infer or upgrade that identity from the key alone.
function validateV2(s) {
  if (!exact(s,['version','commits']) || s.version!==2 || !s.commits ||
      typeof s.commits!=='object' || Array.isArray(s.commits) ||
      Object.getPrototypeOf(s.commits)!==Object.prototype) return false;
  for (const [id,raw] of Object.entries(s.commits)) {
    if (!safeId(id) || typeof raw!=='string') return false;
    let v; try { v=JSON.parse(raw); } catch { return false; }
    if (!exact(v,fields) || v.eventId!==id || !safeId(v.eventId) ||
        !fields.every(k=>typeof v[k]==='string' && v[k].length>0) ||
        JSON.stringify(v)!==raw) return false;
  }
  return true;
}
const fixture = () => ({version:2,commits:{
  'demo-event-a':JSON.stringify(record('demo-event-a','demo-fact-a')),
  'demo-event-b':JSON.stringify(record('demo-event-b','demo-fact-b'))
}});
test('v2 accepts a bound synthetic ledger',()=>assert.equal(validateV2(fixture()),true));
test('v2 rejects swapped well-formed fingerprints',()=>{
  const s=fixture(); [s.commits['demo-event-a'],s.commits['demo-event-b']]=[s.commits['demo-event-b'],s.commits['demo-event-a']];
  assert.equal(validateV2(s),false);
});
test('legacy identity remains unverified',()=>{
  const s=fixture(); delete s.version; assert.equal(validateV2(s),false);
  assert.equal(validateV2({version:2,commits:{'demo-event-a':JSON.stringify({type:'fact_verified',scope:'demo'})}}),false);
});
test('v2 rejects spoofed identity, extra fields and malformed JSON',()=>{
  const s=fixture();
  s.commits['demo-event-a']=JSON.stringify(record('demo-event-b','demo-fact-a'));
  assert.equal(validateV2(s),false);
  s.commits['demo-event-a']=JSON.stringify({...record('demo-event-a','demo-fact-a'),extra:'x'});
  assert.equal(validateV2(s),false);
  s.commits['demo-event-a']='{'; assert.equal(validateV2(s),false);
});
test('v2 rejects unsupported versions and envelope extras',()=>{
  const s=fixture(); s.version=1; assert.equal(validateV2(s),false);
  s.version=2; s.trusted=true; assert.equal(validateV2(s),false);
});
