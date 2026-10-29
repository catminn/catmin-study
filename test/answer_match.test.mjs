import { test } from "node:test"; import assert from "node:assert/strict";
import { answerMatches as m } from "../src/answer.ts";
test("answers", () => {
  const Y = [["1.0×10⁻⁵","1e-5"],["10^-5","1e-5"],["0.00001","1e-5"],["1/2","0.5"],["0.5","1/2"],["pH=3","3"],["20000 Pa","20000"],["6 N·m","6"],["( 2 , 3 )","(2,3)"],["[4,1]","(4,1)"],["x=5","5"],["298.150","298.15"],["-25","-25"],["3t³","3t^3"],["局部极小值","局部极小值"]];
  for (const [g, k] of Y) assert.ok(m(g, [k]), g + " vs " + k);
  const N = [["2","3"],["0.51","1/2"],["(3,2)","(2,3)"],["-12","12"],["1e-4","1e-5"],["abc","6xy"]];
  for (const [g, k] of N) assert.ok(!m(g, [k]), g + " !~ " + k);
});
