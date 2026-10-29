import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmContractBridge} from '../scripts/validate-dm-contract-bridge.mjs';
const flowBase=JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json',import.meta.url),'utf8'));
const failureBase={
 schemaVersion:'dm-failure-forward-v1',synthetic:true,worldId:'demo-world',manifestRevision:'demo-r1',
 scenes:[{id:'route-a',chapterIndex:0,order:0},{id:'merge',chapterIndex:0,order:1},{id:'aftermath',chapterIndex:1,order:0}],
 attempt:{id:'demo.attempt',sceneId:'route-a',recoverySceneId:'merge',endSceneId:'aftermath',optionalSkill:true,requiresQuiz:false,
 outcomes:[{kind:'success',eventRef:'demo.success',to:'aftermath',copySlot:'demo.outcome.success',costRef:null,committed:true},
 {kind:'setback',eventRef:'demo.setback',to:'merge',copySlot:'demo.outcome.setback',costRef:'demo.cost',committed:true},
 {kind:'refusal',eventRef:'demo.refusal',to:'merge',copySlot:'demo.outcome.refusal',costRef:null,committed:true}],
 recovery:[{id:'demo.recover',from:'merge',to:'aftermath',eventRef:'demo.recovered',copySlot:'demo.outcome.recovered',requiresSkill:false,committed:true}]},
 callbacks:[{eventRef:'demo.setback',at:'aftermath',copySlot:'demo.outcome.setback.callback',requiresCommitted:true},
 {eventRef:'demo.refusal',at:'aftermath',copySlot:'demo.outcome.refusal.callback',requiresCommitted:true}],
 previewPolicy:{askMutates:false,lessonDeclineMutates:false,previewMutates:false}
};
const bridgeBase={schemaVersion:'dm-contract-bridge-v1',synthetic:true,routeBeatId:'route-a',routeTraceRef:'demo.trace-a',recoveryBeatId:'merge',aftermathBeatId:'aftermath'};
const run=(f=()=>{})=>{const v={flow:structuredClone(flowBase),failure:structuredClone(failureBase),bridge:structuredClone(bridgeBase)};f(v);return validateDmContractBridge(v.flow,v.failure,v.bridge)};
const cases=[
 ['baseline',null,null],
 ['reject wrong world',v=>v.failure.worldId='other-world','scope_mismatch'],
 ['reject wrong revision',v=>v.failure.manifestRevision='demo-r2','scope_mismatch'],
 ['reject route beat mismatch',v=>v.bridge.routeBeatId='route-b','route_unbound'],
 ['reject unknown route',v=>v.bridge.routeBeatId='absent','route_unbound'],
 ['reject wrong route trace',v=>v.bridge.routeTraceRef='demo.trace-b','route_unbound'],
 ['reject wrong recovery beat',v=>v.bridge.recoveryBeatId='decision','recovery_unbound'],
 ['reject wrong aftermath beat',v=>v.bridge.aftermathBeatId='merge','aftermath_unbound'],
 ['reject failure attempt scene mismatch',v=>{v.failure.attempt.sceneId='route-b';v.failure.scenes[0].id='route-b';},'scene_mismatch'],
 ['reject failure recovery scene mismatch',v=>v.failure.attempt.recoverySceneId='aftermath','invalid_failure_contract'],
 ['reject failure end mismatch',v=>v.failure.attempt.endSceneId='merge','invalid_failure_contract'],
 ['reject copy slot reuse',v=>v.failure.attempt.outcomes[0].copySlot='demo.entry','copy_slot_collision'],
 ['reject callback slot reuse',v=>v.failure.callbacks[0].copySlot='demo.callback-a','copy_slot_collision'],
 ['reject route trace used as event',v=>{v.failure.attempt.outcomes[0].eventRef='demo.trace-a';},'trace_event_alias'],
 ['reject other route trace used as event',v=>{v.failure.attempt.outcomes[0].eventRef='demo.trace-b';},'trace_event_alias'],
 ['reject hidden field in bridge',v=>v.bridge.directorSecret='x','invalid_bridge'],
 ['reject author approval claim',v=>v.bridge.approved=true,'invalid_bridge'],
 ['reject hidden field in beat',v=>v.flow.beats[0].hidden='x','invalid_beat_contract'],
 ['reject hidden field in failure',v=>v.failure.attempt.outcomes[0].secret='x','invalid_failure_contract'],
 ['reject forced quiz',v=>v.failure.attempt.requiresQuiz=true,'invalid_failure_contract'],
 ['reject nonoptional lesson',v=>v.flow.beats.find(b=>b.type==='lesson_offer').optional=false,'invalid_beat_contract'],
 ['reject uncommitted route',v=>v.flow.beats.find(b=>b.id==='route-a').requiresCommit=false,'invalid_beat_contract'],
 ['reject uncommitted callback',v=>v.failure.callbacks[0].requiresCommitted=false,'invalid_failure_contract'],
 ['reject invalid bridge type',v=>v.bridge.synthetic='yes','invalid_bridge'],
 ['reject missing binding',v=>delete v.bridge.routeTraceRef,'invalid_bridge'],
 ['reject nonopaque identifier',v=>v.bridge.routeTraceRef='a secret','invalid_bridge'],
 ['reject missing recovery path',v=>v.flow.beats.find(b=>b.id==='merge').next=[],'invalid_beat_contract'],
];
for(const [name,mutation,expected] of cases)test(name,()=>{
 const result=run(mutation||(()=>{}));
 if(expected){assert.equal(result.ok,false);assert.ok(result.codes.includes(expected),JSON.stringify(result));}
 else assert.deepEqual(result,{ok:true,codes:[],errorCount:0});
 assert.deepEqual(Object.keys(result).sort(),['codes','errorCount','ok']);
 assert.ok(!JSON.stringify(result).includes('secret'));
});
