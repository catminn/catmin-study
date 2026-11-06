/** P0 isolated learning core: not imported by current production page. */
export const STUDY_SCHEMA_VERSION = 1;
export const LEARNING_EVENT_TYPES = Object.freeze(['knowledge_attempt','study_session_completed','daily_checkin_completed','course_task_completed','mastery_reviewed']);
const types=new Set(LEARNING_EVENT_TYPES);
const correct=new Set(['correct','incorrect','partial','unknown']);
const reasoning=new Set(['valid','partial','invalid','not_assessed']);
const assistance=new Set(['none','minor_hint','major_hint','worked_solution','unknown']);
const verification=new Set(['confirmed','pending','rejected']);
const context=new Set(['adventure','tutor','daily','practice','offline','other']);
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const label=x=>typeof x==='string'&&x.length>0&&x.length<=180;
const clone=x=>JSON.parse(JSON.stringify(x));
/** Never mutate an existing legacy save. */
export function inspectLegacyState(s){
 if(!object(s))throw new TypeError('Legacy state must be an object');
 const alerts=[];
 if(s.v!==2)alerts.push('Unknown legacy schema: review manually');
 if(!Array.isArray(s.ledger))alerts.push('Missing ledger: do not infer historical rewards');
 if(typeof s.points!=='number'||!Number.isFinite(s.points))alerts.push('Invalid points: block migration');
 for(const k of ['resetTag','chatReset','sagaTag'])if(typeof s[k]!=='string')alerts.push(k+' absent: legacy startup may reset data');
 return {legacyVersion:s.v??null,points:Number.isFinite(s.points)?s.points:null,ledgerEntries:Array.isArray(s.ledger)?s.ledger.length:null,mistakes:Array.isArray(s.mistakes)?s.mistakes.length:null,alerts};
}
/** Portable complete JSON-value backup. Caller is responsible for safe durable storage. */
export function makeLegacyBackup(s,{backupId,capturedAt}={}){
 if(!object(s)||!label(backupId)||!Number.isSafeInteger(capturedAt)||capturedAt<0)throw new TypeError('Invalid backup input');
 return {format:'zhushen-legacy-backup-v1',backupId,capturedAt,original:clone(s)};
}
export function createStudyStore(){return{schemaVersion:STUDY_SCHEMA_VERSION,learningEvents:[],rewardEvents:[],rewardBalanceDelta:0}}
export function validateLearningEvent(e){
 if(!object(e)||!label(e.id)||!types.has(e.type)||!label(e.topicId)||!Number.isSafeInteger(e.at)||e.at<0||!correct.has(e.correctness)||!reasoning.has(e.reasoning)||!assistance.has(e.assistance)||!verification.has(e.verification)||!context.has(e.context)||typeof e.transfer!=='boolean')throw new TypeError('Invalid learning event');
 return clone(e);
}
/** Idempotent immutable addition; an ID collision with different content is rejected. */
export function appendLearningEvent(store,event){
 if(!object(store)||store.schemaVersion!==STUDY_SCHEMA_VERSION||!Array.isArray(store.learningEvents))throw new TypeError('Invalid store');
 const e=validateLearningEvent(event),old=store.learningEvents.find(x=>x.id===e.id);
 if(old){if(JSON.stringify(old)!==JSON.stringify(e))throw new Error('Learning event ID conflict');return{store:clone(store),inserted:false}}
 const next=clone(store);next.learningEvents.push(e);return{store:next,inserted:true};
}
/** A source learning event can issue at most one reward, pending evidence cannot pay. */
export function awardLearningEvent(store,{rewardId,sourceEventId,points,at}){
 if(!object(store)||store.schemaVersion!==STUDY_SCHEMA_VERSION||!Array.isArray(store.rewardEvents)||!label(rewardId)||!label(sourceEventId)||!Number.isSafeInteger(points)||points<0||points>10000||!Number.isSafeInteger(at)||at<0)throw new TypeError('Invalid reward');
 const source=store.learningEvents.find(x=>x.id===sourceEventId);
 if(!source||source.verification!=='confirmed')throw new Error('Source evidence not confirmed');
 const old=store.rewardEvents.find(x=>x.rewardId===rewardId||x.sourceEventId===sourceEventId);
 if(old){if(old.rewardId===rewardId&&old.sourceEventId===sourceEventId&&old.points===points)return{store:clone(store),inserted:false};throw new Error('Reward conflict / duplicate source')}
 const next=clone(store);next.rewardEvents.push({rewardId,sourceEventId,points,at});next.rewardBalanceDelta+=points;
 return{store:next,inserted:true};
}
