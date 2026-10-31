import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmBeatFlow as check} from '../scripts/validate-dm-beat-flow.mjs';

// Entirely invented authoring beats; no first-world plot, NPCs or answers.
const base = JSON.parse(readFileSync(new URL('./fixtures/dm-beat-flow-synthetic-v1.json',import.meta.url),'utf8'));
const copy = () => structuredClone(base);
const beat = (g,id) => g.beats.find(b=>b.id===id);
const has = (g,code) => {
  const result=check(g);
  assert.equal(result.ok,false);
  assert.ok(result.codes.includes(code),JSON.stringify(result));
  assert.equal(result.errorCount,result.codes.length);
  assert.deepEqual(Object.keys(result).sort(),['codes','errorCount','ok']);
};
const lateLesson = () => {
  const g=copy();
  // The old validator accepted this fully connected, acyclic permutation:
  // entry -> choice -> routes -> convergence -> observation -> lesson -> end.
  beat(g,'entry').next=['decision'];
  beat(g,'merge').next=['observation'];
  beat(g,'lesson-offer').next=['aftermath'];
  beat(g,'lesson-offer').skipTo='aftermath';
  beat(g,'lesson-offer').resumeTo='aftermath';
  return g;
};

test('the intended world-observation-lesson-choice-consequence order passes',()=>
  assert.deepEqual(check(copy()),{ok:true,codes:[],errorCount:0}));
test('fully connected late lesson after committed route is rejected',()=>
  has(lateLesson(),'beat_sequence_invalid'));
test('entry cannot bypass the world observation',()=>{
  const g=copy();beat(g,'entry').next=['decision'];has(g,'beat_sequence_invalid');
});
test('the optional lesson must resume at the consequential choice',()=>{
  const g=copy();beat(g,'lesson-offer').next=['aftermath'];
  beat(g,'lesson-offer').skipTo='aftermath';beat(g,'lesson-offer').resumeTo='aftermath';
  has(g,'beat_sequence_invalid');
});
test('convergence must lead to the aftermath, not a delayed lesson',()=>{
  const g=copy();beat(g,'merge').next=['observation'];has(g,'beat_sequence_invalid');
});
test('the observation must still precede its anchored lesson',()=>{
  const g=copy();beat(g,'observation').next=['decision'];has(g,'beat_sequence_invalid');
});
test('changing route presentation order does not change story beat sequence',()=>{
  const g=copy();beat(g,'decision').next.reverse();
  assert.equal(check(g).ok,true);
});
test('the late-lesson rejection never echoes private author values',()=>{
  const g=lateLesson();beat(g,'observation').observationRef='demo-private-sentinel';
  const r=check(g);has(g,'beat_sequence_invalid');
  assert.equal(JSON.stringify(r).includes('demo-private-sentinel'),false);
});
test('existing schema diagnostics remain available',()=>{
  const g=copy();g.unreviewedPayload='demo-private-sentinel';
  has(g,'unknown_root_field');
});
