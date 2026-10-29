import test from 'node:test';
import assert from 'node:assert/strict';
import {projectAdvantageEvidence} from '../scripts/validate-dungeon-advantage-evidence.mjs';
const annotation = Object.freeze({schema:'dungeon-advantage-evidence-v1',worldId:'demo-world',dungeonId:'demo-dungeon',manifestRevision:1,sessionId:'demo-session',commitId:'demo-commit',eventKey:'demo-event',actionKey:'demo.action.01',advantage:'evidence_option',evidenceRefs:['demo.evidence.01']});
const binding = {worldId:'demo-world',dungeonId:'demo-dungeon',manifestRevision:1,actionKey:'demo.action.01',advantage:'evidence_option'};
const committedEvent = {...Object.fromEntries(['worldId','dungeonId','manifestRevision','sessionId','commitId','eventKey','actionKey'].map(k=>[k,annotation[k]])),status:'committed',outcome:'success',publicOutcome:'A neutral approved outcome.'};
const context = {binding,committedEvent,trustedEvidenceRefs:['demo.evidence.01','demo.evidence.02'],publicCopyApproved:true};
const run = (a=annotation,c=context) => projectAdvantageEvidence(a,c);
const copy = x=>structuredClone(x);
const reject = (a,c=context)=>assert.deepEqual(run(a,c),{ok:false,code:'not_authorized'});

test('only reviewed publicOutcome is projected after a committed action',()=>assert.deepEqual(run(),{ok:true,public:{publicOutcome:'A neutral approved outcome.'}}));
test('private evidence refs and event metadata never appear in public projection',()=>{const r=run();assert.deepEqual(Object.keys(r.public),['publicOutcome']);assert.doesNotMatch(JSON.stringify(r),/demo\.evidence|demo-event|demo-commit|demo.action/)});
test('failed world action can have its own reviewed narrative; advantage does not auto-succeed',()=>{const c=copy(context);c.committedEvent.outcome='failure';c.committedEvent.publicOutcome='The attempt did not succeed.';assert.equal(run(annotation,c).public.publicOutcome,'The attempt did not succeed.')});
test('preview, ASK and rejected actions cannot project committed outcomes',()=>{for(const s of ['preview','asked','rejected','pending']){const c=copy(context);c.committedEvent.status=s;reject(annotation,c)}});
test('world mismatch is rejected',()=>{const a=copy(annotation);a.worldId='other-world';reject(a)});
test('dungeon mismatch is rejected',()=>{const a=copy(annotation);a.dungeonId='other-dungeon';reject(a)});
test('revision mismatch is rejected',()=>{const a=copy(annotation);a.manifestRevision=2;reject(a)});
test('session mismatch is rejected',()=>{const a=copy(annotation);a.sessionId='other-session';reject(a)});
test('commit mismatch is rejected',()=>{const a=copy(annotation);a.commitId='other-commit';reject(a)});
test('event mismatch is rejected',()=>{const a=copy(annotation);a.eventKey='other-event';reject(a)});
test('action mismatch is rejected',()=>{const a=copy(annotation);a.actionKey='other-action';reject(a)});
test('wrong advantage category is rejected',()=>{const a=copy(annotation);a.advantage='risk_context';reject(a)});
test('risk_context is supported without a public risk score',()=>{const a=copy(annotation),c=copy(context);a.advantage='risk_context';c.binding.advantage='risk_context';assert.equal(run(a,c).ok,true);assert.equal('risk' in run(a,c).public,false)});
test('unknown evidence ref is rejected',()=>{const a=copy(annotation);a.evidenceRefs=['demo.evidence.99'];reject(a)});
test('empty evidence is rejected',()=>{const a=copy(annotation);a.evidenceRefs=[];reject(a)});
test('duplicate evidence refs are rejected',()=>{const a=copy(annotation);a.evidenceRefs=['demo.evidence.01','demo.evidence.01'];reject(a)});
test('more than eight evidence refs is rejected',()=>{const a=copy(annotation);a.evidenceRefs=Array.from({length:9},(_,i)=>'demo.evidence.'+i);reject(a)});
test('client-supplied narration, success or effects are rejected',()=>{for(const k of ['publicOutcome','success','effects','riskScore','privateTruth']){const a=copy(annotation);a[k]='untrusted';reject(a)}});
test('unreviewed public copy is rejected',()=>reject(annotation,{...context,publicCopyApproved:false}));
test('missing public copy is rejected',()=>{const c=copy(context);c.committedEvent.publicOutcome='';reject(annotation,c)});
test('trusted evidence registry must exist and be valid',()=>{for(const r of [undefined,null,['demo.evidence.01','demo.evidence.01'],['bad ref']])reject(annotation,{...context,trustedEvidenceRefs:r})});
test('tampered committed event metadata is rejected',()=>{for(const k of ['worldId','dungeonId','manifestRevision','sessionId','commitId','eventKey','actionKey']){const c=copy(context);c.committedEvent[k]='tampered';reject(annotation,c)}});
test('same committed event replay is pure and deterministic',()=>{const before=copy(context),a=copy(annotation);assert.deepEqual(run(),run());assert.deepEqual(context,before);assert.deepEqual(annotation,a)});
test('malformed inputs fail closed and do not echo secrets',()=>{for(const a of [null,{},[],{...annotation,evidenceRefs:['SECRET-NPC-NAME']}, {...annotation,evidenceRefs:null}]){const r=run(a);assert.deepEqual(r,{ok:false,code:'not_authorized'});assert.doesNotMatch(JSON.stringify(r),/SECRET|NPC|demo/)} });

test('binding must include explicit pinned world, dungeon and revision',()=>{
  for(const key of ['worldId','dungeonId','manifestRevision']){const c=copy(context);delete c.binding[key];reject(annotation,c)}
});
test('binding with a different world is rejected even if actionKey collides',()=>{
  const c=copy(context);c.binding.worldId='other-world';reject(annotation,c);
});
test('binding with a different dungeon is rejected even if actionKey collides',()=>{
  const c=copy(context);c.binding.dungeonId='other-dungeon';reject(annotation,c);
});
test('binding from a stale or future manifest revision is rejected',()=>{
  for(const revision of [0,2,99]){const c=copy(context);c.binding.manifestRevision=revision;reject(annotation,c)}
});
test('binding revision must be a positive safe integer',()=>{
  for(const revision of ['1',1.5,-1,NaN,Infinity]){const c=copy(context);c.binding.manifestRevision=revision;reject(annotation,c)}
});
test('malformed binding scope is rejected',()=>{
  for(const [key,value] of [['worldId',null],['worldId',42],['dungeonId','bad space'],['dungeonId',[]]]){const c=copy(context);c.binding[key]=value;reject(annotation,c)}
});
test('valid scoped binding still supports failure outcomes without granting success',()=>{
  const c=copy(context);c.committedEvent.outcome='failure';c.committedEvent.publicOutcome='The attempt did not succeed.';
  assert.deepEqual(run(annotation,c),{ok:true,public:{publicOutcome:'The attempt did not succeed.'}});
});
test('scope rejection never echoes untrusted or private identifiers',()=>{
  const c=copy(context);c.binding.worldId='SECRET_PRIVATE_WORLD';
  const r=run(annotation,c);assert.deepEqual(r,{ok:false,code:'not_authorized'});
  assert.doesNotMatch(JSON.stringify(r),/SECRET|PRIVATE|demo/);
});
test('scope denial does not mutate annotation, binding or committed event',()=>{
  const a=copy(annotation),c=copy(context);c.binding.manifestRevision=2;
  const before=JSON.stringify({a,c});reject(a,c);assert.equal(JSON.stringify({a,c}),before);
});
