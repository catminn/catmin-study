import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateDmTurn,evaluateTranscript} from "./lib/dm-experience-qa.mjs";
const fixture=JSON.parse(readFileSync(new URL("./fixtures/dm-experience-cases-v1.json",import.meta.url),"utf8"));
test("fixture structure and coverage",()=>{
 assert.equal(fixture.schema,"dm-experience-cases-v1");
 assert.ok(fixture.sequences.length>=6);
 assert.ok(fixture.sequences.every(s=>s.steps.length>=2));
 assert.equal(new Set(fixture.sequences.map(s=>s.id)).size,fixture.sequences.length);
 assert.ok(fixture.negative.length>=7);
});
for(const seq of fixture.sequences)
 test("approved multi-turn experience: "+seq.id,()=>{
  const r=evaluateTranscript(seq.steps);
  assert.deepEqual(r.failures,[],JSON.stringify(r.failures));
  assert.equal(r.turnCount,seq.steps.length);
 });
for(const bad of fixture.negative)
 test("reject DM regression: "+bad.id,()=>{
  const r=evaluateDmTurn(bad.turn);
  assert.equal(r.pass,false);
  for(const code of bad.expect) assert.ok(r.failures.includes(code),JSON.stringify(r.failures)+" missing "+code);
 });
test("math remains optional when evidence is relevant",()=>{
 assert.equal(evaluateDmTurn({kind:"explore",hasRelevantMathClue:true,input:"我想推测坡向",reply:"可以比较水流与梯度方向，也可以直接观察沿途的水痕。"}).pass,true);
});
test("uncommitted travel cannot be described as completed",()=>{
 assert.ok(evaluateDmTurn({kind:"travel",input:"先别去",committed:false,reply:"你已经到达对岸。"}).failures.includes("uncommitted_travel_claim"));
});
