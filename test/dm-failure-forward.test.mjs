import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDmFailureForward} from '../scripts/validate-dm-failure-forward.mjs';
const base=()=>({
  schemaVersion:'dm-failure-forward-v1',synthetic:true,worldId:'demo.world',manifestRevision:'demo.r1',
  scenes:[{id:'demo.entry',chapterIndex:0,order:0},{id:'demo.recovery',chapterIndex:0,order:1},{id:'demo.end',chapterIndex:1,order:0}],
  attempt:{id:'demo.attempt',sceneId:'demo.entry',recoverySceneId:'demo.recovery',endSceneId:'demo.end',optionalSkill:true,requiresQuiz:false,
    outcomes:[{kind:'success',eventRef:'demo.success',to:'demo.end',copySlot:'demo.copy.success',costRef:null,committed:true},
      {kind:'setback',eventRef:'demo.setback',to:'demo.recovery',copySlot:'demo.copy.setback',costRef:'demo.cost',committed:true},
      {kind:'refusal',eventRef:'demo.refusal',to:'demo.recovery',copySlot:'demo.copy.refusal',costRef:null,committed:true}],
    recovery:[{id:'demo.recover',from:'demo.recovery',to:'demo.end',eventRef:'demo.recovered',copySlot:'demo.copy.recovered',requiresSkill:false,committed:true}]},
  callbacks:[{eventRef:'demo.setback',at:'demo.end',copySlot:'demo.copy.setback-callback',requiresCommitted:true},
    {eventRef:'demo.refusal',at:'demo.end',copySlot:'demo.copy.refusal-callback',requiresCommitted:true}],
  previewPolicy:{askMutates:false,lessonDeclineMutates:false,previewMutates:false}
});
const clone=()=>structuredClone(base());
const cases=[
 ['valid baseline',()=>{},null],
 ['reject hidden prose at root',x=>x.secret='anything','invalid_root'],
 ['reject non synthetic',x=>x.synthetic=false,'invalid_schema'],
 ['reject duplicate scene',x=>x.scenes[1].id='demo.entry','duplicate_scene'],
 ['reject scene extra field',x=>x.scenes[0].directorSecret='hidden','invalid_scene'],
 ['reject backwards recovery',x=>x.scenes[1].order=0,'invalid_progression'],
 ['reject same-chapter payoff',x=>x.scenes[2].chapterIndex=0,'invalid_progression'],
 ['reject forced skill',x=>x.attempt.optionalSkill=false,'forced_academic_gate'],
 ['reject required quiz',x=>x.attempt.requiresQuiz=true,'forced_academic_gate'],
 ['reject missing outcome',x=>x.attempt.outcomes.pop(),'outcome_cardinality'],
 ['reject duplicate outcome kind',x=>x.attempt.outcomes[2].kind='setback','duplicate_outcome'],
 ['reject uncommitted setback',x=>x.attempt.outcomes[1].committed=false,'invalid_outcome'],
 ['reject direct setback bypass',x=>x.attempt.outcomes[1].to='demo.end','invalid_outcome_route'],
 ['reject setback without cost',x=>x.attempt.outcomes[1].costRef=null,'invalid_consequence'],
 ['reject punitive refusal',x=>x.attempt.outcomes[2].costRef='demo.cost','invalid_consequence'],
 ['reject reused outcome evidence',x=>x.attempt.outcomes[2].eventRef='demo.setback','outcome_alias_collision'],
 ['reject recovery with no base path',x=>x.attempt.recovery[0].requiresSkill=true,'no_nonacademic_recovery'],
 ['reject recovery loop',x=>x.attempt.recovery[0].to='demo.recovery','recovery_dead_end'],
 ['reject recovery event alias',x=>x.attempt.recovery[0].eventRef='demo.success','recovery_alias_collision'],
 ['reject missing setback callback',x=>x.callbacks[0].eventRef='demo.other','missing_consequence_callback'],
 ['reject callback before payoff',x=>x.callbacks[0].at='demo.recovery','premature_callback'],
 ['reject callback without commit',x=>x.callbacks[0].requiresCommitted=false,'invalid_callback'],
 ['reject duplicate callback copy',x=>x.callbacks[1].copySlot=x.callbacks[0].copySlot,'callback_alias_collision'],
 ['reject ASK mutation',x=>x.previewPolicy.askMutates=true,'preview_mutates'],
 ['reject lesson decline mutation',x=>x.previewPolicy.lessonDeclineMutates=true,'preview_mutates'],
 ['reject preview mutation',x=>x.previewPolicy.previewMutates=true,'preview_mutates'],
 ['reject arbitrary outcome payload',x=>x.attempt.outcomes[0].answer='hidden','invalid_outcome'],
 ['reject malformed preview policy',x=>x.previewPolicy=null,'preview_mutates'],
 ['reject non-opaque ID',x=>x.attempt.outcomes[0].eventRef='secret value','invalid_outcome'],
];
for(const [name,mutate,expected] of cases){test(name,()=>{const x=clone();mutate(x);const r=validateDmFailureForward(x);if(expected){assert.equal(r.ok,false);assert.ok(r.codes.includes(expected),JSON.stringify(r));}else assert.deepEqual(r,{ok:true,codes:[],errorCount:0});assert.deepEqual(Object.keys(r).sort(),['codes','errorCount','ok']);assert.ok(!JSON.stringify(r).includes('hidden'));});}
