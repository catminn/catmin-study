import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectLegacyState,makeLegacyBackup,createStudyStore,appendLearningEvent,awardLearningEvent} from '../public/study-core.mjs';
const evidence=(id='ev1',verification='confirmed')=>({id,type:'knowledge_attempt',topicId:'math1920.gradient',at:123,correctness:'correct',reasoning:'valid',assistance:'none',verification,context:'adventure',transfer:true});
test('legacy inspection is read-only and warns of missing reset flags',()=>{
 const s={v:2,points:80,ledger:[{d:80}],mistakes:[],progress:{math:[1]}},before=JSON.stringify(s),r=inspectLegacyState(s);
 assert.equal(r.points,80);assert.equal(r.ledgerEntries,1);assert.ok(r.alerts.some(x=>x.includes('resetTag')));assert.equal(JSON.stringify(s),before);
});
test('backup captures full array without mutating source',()=>{
 const s={points:10,ledger:Array.from({length:450},(_,i)=>({d:i})),nested:{v:1}},b=makeLegacyBackup(s,{backupId:'test',capturedAt:123});
 s.ledger.pop();s.nested.v=2;assert.equal(b.original.ledger.length,450);assert.equal(b.original.nested.v,1);
});
test('learning evidence insertion is idempotent and detects collisions',()=>{
 const s=createStudyStore(),a=appendLearningEvent(s,evidence());
 assert.equal(s.learningEvents.length,0);assert.equal(a.store.learningEvents.length,1);
 assert.equal(appendLearningEvent(a.store,evidence()).inserted,false);
 assert.throws(()=>appendLearningEvent(a.store,{...evidence(),reasoning:'invalid'}),/conflict/);
});
test('only verified evidence is rewardable, source cannot be paid twice',()=>{
 const pending=appendLearningEvent(createStudyStore(),evidence('p','pending')).store;
 assert.throws(()=>awardLearningEvent(pending,{rewardId:'r0',sourceEventId:'p',points:1,at:125}),/not confirmed/);
 const s=appendLearningEvent(createStudyStore(),evidence()).store;
 const a=awardLearningEvent(s,{rewardId:'r1',sourceEventId:'ev1',points:10,at:125});
 assert.equal(a.store.rewardBalanceDelta,10);
 assert.equal(awardLearningEvent(a.store,{rewardId:'r1',sourceEventId:'ev1',points:10,at:125}).inserted,false);
 assert.throws(()=>awardLearningEvent(a.store,{rewardId:'r2',sourceEventId:'ev1',points:10,at:126}),/duplicate source/);
});
test('reject invalid evidence and negative rewards',()=>{
 assert.throws(()=>appendLearningEvent(createStudyStore(),{...evidence(),correctness:'great'}),/Invalid learning event/);
 const s=appendLearningEvent(createStudyStore(),evidence()).store;
 assert.throws(()=>awardLearningEvent(s,{rewardId:'r',sourceEventId:'ev1',points:-1,at:1}),/Invalid reward/);
});
