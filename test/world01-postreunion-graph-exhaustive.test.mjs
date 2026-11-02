import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorld01RouteAgency} from '../scripts/validate-world01-route-agency.mjs';

// Public mechanics-only fixtures. The detours below are invented graph nodes,
// not formal scenes, dialogue, hidden facts, or an importable story package.
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const worldFixture = () => read('../content/contracts/world01-opening-skeleton.json');
const causalFixture = () => read('./fixtures/world01-causal-authoring-v1.json');
const A = 'w01.synthetic_detour_a';
const B = 'w01.synthetic_detour_b';
const END = 'w01.aftermath';
const targets = [A, B, END];

function build(mask) {
  const world = worldFixture();
  const reunion = world.nodes.find(n => n.id === 'w01.discover');
  reunion.next.push(A, B); // Both detours are reachable without blocking the original route.
  const edges = offset => targets.filter((_, i) => (mask & (1 << (offset + i))) !== 0);
  world.nodes.push({id:A, role:'optional_detour', next:edges(0)});
  world.nodes.push({id:B, role:'optional_detour', next:edges(3)});
  return world;
}

// Independent forward-search oracle: every post-reunion node must have a finite
// path to some terminal. An optional cycle is fine if it has an exit.
function hasFiniteEnding(nodes, start) {
  const byId = new Map(nodes.map(n => [n.id, n.next]));
  const seen = new Set();
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (seen.has(at)) continue;
    seen.add(at);
    const next = byId.get(at);
    if (next.length === 0) return true;
    queue.push(...next);
  }
  return false;
}

test('all 64 two-detour exit graphs agree with independent finite-ending oracle', () => {
  const causal = causalFixture();
  let accepted = 0;
  let trapped = 0;
  for (let mask = 0; mask < 64; mask++) {
    const world = build(mask);
    const before = JSON.stringify(world);
    const result = validateWorld01RouteAgency(world, causal);
    const expected = [A, B].every(id => hasFiniteEnding(world.nodes, id));
    if (expected) {
      assert.deepEqual(result, {ok:true, validatedRoutes:2}, 'mask ' + mask);
      accepted++;
    } else {
      assert.deepEqual(result, {ok:false, code:'ending_trap'}, 'mask ' + mask);
      assert.doesNotMatch(JSON.stringify(result), /synthetic_detour|world01/i);
      trapped++;
    }
    assert.equal(JSON.stringify(world), before, 'validator mutated graph ' + mask);
  }
  assert.ok(accepted > 0 && trapped > 0, 'must exercise both allowed loops and traps');
});
