import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSceneLearningFlow} from '../scripts/validate-scene-learning-flow.mjs';
import {validateSceneLearningPacing} from '../scripts/validate-scene-learning-pacing.mjs';

// Exhaustive, spoiler-free authoring fixture. No production world, NPC, answers
// or hidden narrative data. The independent oracle enumerates complete routes.
const beat = (id, exits, end = false) => ({
  id, objectiveKey: id + '-objective', end, teaches: [], offers: [], exits
});
const makeGraph = mask => {
  const nodes = [
    beat('demo-entry', ['demo-left', 'demo-right']),
    beat('demo-left', ['demo-join']),
    beat('demo-right', ['demo-join']),
    beat('demo-join', ['demo-end']),
    beat('demo-end', [], true)
  ];
  for (let i = 0; i < 4; i++) {
    if (mask & (1 << i)) nodes[i].teaches.push('demo-skill');
    if (mask & (1 << (i + 4))) nodes[i].offers.push('demo-card');
  }
  return {
    start: 'demo-entry', skills: ['demo-skill'],
    practices: [{id: 'demo-card', skillId: 'demo-skill'}], nodes
  };
};
function independentRouteOracle(graph) {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const paths = [];
  function walk(id, visited) {
    const n = nodes.get(id);
    const path = [...visited, n];
    if (n.end) { paths.push(path); return; }
    for (const next of n.exits) walk(next, path);
  }
  walk(graph.start, []);
  assert.equal(paths.length, 2);
  const first = (path, field) => {
    const i = path.findIndex(n => n[field].length > 0);
    assert.ok(i >= 0, 'valid graph must offer learning on each route');
    return i + 1;
  };
  return {
    latestTeachBeat: Math.max(...paths.map(path => first(path, 'teaches'))),
    latestPracticeBeat: Math.max(...paths.map(path => first(path, 'offers')))
  };
}
function expectedResult(graph, limits) {
  const {latestTeachBeat, latestPracticeBeat} = independentRouteOracle(graph);
  if (latestTeachBeat > limits.teachBy) return {ok: false, code: 'teaching_too_late'};
  if (latestPracticeBeat > limits.practiceBy) return {ok: false, code: 'practice_too_late'};
  return {ok: true, latestTeachBeat, latestPracticeBeat};
}

test('exhaustive two-route learning pacing agrees with independent path enumeration', () => {
  let valid = 0, invalid = 0, assertions = 0;
  for (let mask = 0; mask < 256; mask++) {
    const graph = makeGraph(mask);
    const base = validateSceneLearningFlow(graph);
    if (!base.ok) {
      invalid++;
      assert.deepEqual(validateSceneLearningPacing(graph, {teachBy: 4, practiceBy: 4}),
        {ok: false, code: 'graph_invalid'});
      assertions++;
      continue;
    }
    valid++;
    for (let teachBy = 1; teachBy <= 4; teachBy++)
      for (let practiceBy = 1; practiceBy <= 4; practiceBy++) {
        const limits = {teachBy, practiceBy};
        assert.deepEqual(validateSceneLearningPacing(graph, limits),
          expectedResult(graph, limits), 'mask=' + mask + ' limits=' + JSON.stringify(limits));
        assertions++;
      }
  }
  assert.ok(valid > 0 && invalid > 0);
  assert.ok(assertions > 256);
});

test('authoring node order and sibling route order cannot hide a late learning opportunity', () => {
  let cases = 0;
  for (let mask = 0; mask < 256; mask++) {
    const graph = makeGraph(mask);
    if (!validateSceneLearningFlow(graph).ok) continue;
    const shuffled = structuredClone(graph);
    shuffled.nodes.reverse();
    shuffled.nodes.find(n => n.id === 'demo-entry').exits.reverse();
    for (const limits of [{teachBy: 1, practiceBy: 2}, {teachBy: 2, practiceBy: 3}, {teachBy: 4, practiceBy: 4}]) {
      assert.deepEqual(validateSceneLearningPacing(shuffled, limits),
        validateSceneLearningPacing(graph, limits));
      cases++;
    }
  }
  assert.ok(cases > 0);
});
