import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateWorld01RouteAgency} from '../scripts/validate-world01-route-agency.mjs';

// Public mechanical skeleton plus invented detours. No private scenes, NPC
// identities, dialogue, puzzle answers, or deployable story content.
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const causal = read('./fixtures/world01-causal-authoring-v1.json');
const A = 'w01.synthetic_a';
const AT = 'w01.synthetic_a_tail';
const B = 'w01.synthetic_b';
const BT = 'w01.synthetic_b_tail';
const JOIN = 'w01.discover';

function build(mask) {
  const world = read('../content/contracts/world01-opening-skeleton.json');
  const left = world.nodes.find(n => n.id === 'w01.route_a');
  const right = world.nodes.find(n => n.id === 'w01.route_b');
  // Keep published acceptance routes intact while making each optional
  // detour reachable. Every detour has an ordinary route back to reunion.
  left.next.push(A);
  right.next.push(B);
  const edges = (self, tail, other, offset) => [
    tail,
    ...(mask & (1 << offset) ? [JOIN] : []),
    ...(mask & (1 << (offset + 1)) ? [self] : []),
    ...(mask & (1 << (offset + 2)) ? [other] : [])
  ];
  world.nodes.push(
    {id:A,role:'optional_detour',next:edges(A,AT,B,0)},
    {id:AT,role:'optional_detour',next:[JOIN]},
    {id:B,role:'optional_detour',next:edges(B,BT,A,3)},
    {id:BT,role:'optional_detour',next:[JOIN]}
  );
  return world;
}

// Independent DFS oracle, deliberately separate from the validator's
// reverse-reachability and cycle implementations. All pre-reunion routes must
// terminate at reunion without cycles, dead ends, or shared branch interiors.
function branchOracle(world) {
  const next = new Map(world.nodes.map(n => [n.id,n.next]));
  function walk(start) {
    const visited = new Set();
    const active = new Set();
    let bad = false;
    let reunited = false;
    function visit(at) {
      if (at === JOIN) { reunited = true; return; }
      if (active.has(at)) { bad = true; return; }
      if (visited.has(at)) return;
      visited.add(at);
      active.add(at);
      const exits = next.get(at);
      if (!exits || exits.length === 0) bad = true;
      else for (const to of exits) visit(to);
      active.delete(at);
    }
    visit(start);
    return {visited,bad:bad || !reunited};
  }
  const left = walk('w01.route_a');
  const right = walk('w01.route_b');
  return !left.bad && !right.bad &&
    [...left.visited].every(id => !right.visited.has(id));
}

test('64 synthetic pre-reunion detour graphs preserve route agency and reunion', () => {
  let accepted = 0, rejected = 0;
  for (let mask = 0; mask < 64; mask++) {
    const world = build(mask);
    const before = JSON.stringify(world);
    const expected = branchOracle(world);
    const result = validateWorld01RouteAgency(world, causal);
    assert.equal(result.ok, expected, 'detour graph ' + mask);
    if (expected) {
      assert.deepEqual(result, {ok:true,validatedRoutes:2});
      accepted++;
    } else {
      assert.equal(typeof result.code, 'string');
      assert.doesNotMatch(JSON.stringify(result), /synthetic_[ab]|private|secret/i);
      rejected++;
    }
    assert.equal(JSON.stringify(world), before, 'validator mutated graph ' + mask);
  }
  assert.ok(accepted > 0 && rejected > 0);
});
