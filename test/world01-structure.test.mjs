import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const world = JSON.parse(readFileSync(new URL('../content/contracts/world01-opening-skeleton.json', import.meta.url), 'utf8'));
const byId = new Map(world.nodes.map((n) => [n.id, n]));
function follow(route) {
  for (let i = 1; i < route.length; i++) assert.ok(byId.get(route[i-1])?.next.includes(route[i]), 'invalid transition ' + route[i-1] + ' -> ' + route[i]);
}
test('world scene graph has unique and resolved node ids', () => {
  assert.equal(byId.size, world.nodes.length);
  for (const n of world.nodes) {
    assert.match(n.id, /^w01\.[a-z_]+$/);
    for (const target of n.next) assert.ok(byId.has(target), 'missing node ' + target);
    assert.ok(['none', 'on_commit_only'].includes(n.worldMutation));
  }
});
test('opening has two distinct routes that converge and complete', () => {
  const a = world.acceptance.find((x) => x.id === 'branch-a').route;
  const b = world.acceptance.find((x) => x.id === 'branch-b').route;
  follow(a); follow(b);
  assert.equal(a[0], 'w01.entry');
  assert.equal(b[0], 'w01.entry');
  assert.equal(a.at(-1), 'w01.aftermath');
  assert.equal(b.at(-1), 'w01.aftermath');
  assert.notEqual(a[2], b[2]);
  assert.equal(a[3], b[3]);
});
test('learning scenes do not require academic work to make world progress', () => {
  for (const node of world.nodes) {
    assert.ok(Array.isArray(node.next));
    assert.ok(!node.requiredQuiz && !node.requiredExam, 'unexpected forced quiz');
  }
  assert.ok(world.acceptance.some((a) => a.id === 'refuse-lesson'));
  assert.ok(world.acceptance.some((a) => a.id === 'pause-resume'));
});
test('public content contract carries neither narrative nor hidden entities', () => {
  assert.equal(world.visibility, 'mechanics_only');
  for (const node of world.nodes) {
    for (const forbidden of ['npc', 'secret', 'plot', 'dialogue', 'hiddenFacts', 'narration', 'privateContent']) {
      assert.ok(!(forbidden in node), 'spoiler field ' + forbidden + ' in ' + node.id);
    }
  }
  assert.ok(world.authoringConstraints.some((s) => s.includes('server') || s.includes('committed')));
});
