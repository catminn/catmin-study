import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted} from '../scripts/npc-testimony-reference.mjs';

// All content is synthetic. These checks exercise only the author reference.
const event = (s, mode) => ({
  id: 'demo-mode-1', mode, type: 'route_committed',
  scope: structuredClone(s.scope), source: 'server',
  status: 'committed', expectedVersion: s.version,
  route: 'demo-a', next: 'demo-route-a'
});

test('unknown explicit event modes never become NPC route commits', () => {
  for (const mode of ['draft', 'proposed', 'committed', '', null, 0, {}, ['commit']]) {
    const s = initialState(), before = structuredClone(s);
    const r = applyCommitted(s, event(s, mode));
    assert.deepEqual({ok:r.ok, code:r.code}, {ok:false, code:'not_committed'});
    assert.strictEqual(r.state, s);
    assert.deepEqual(s, before);
    assert.equal(s.version, 0);
    assert.deepEqual(Object.keys(s.commits), []);
    assert.doesNotMatch(JSON.stringify(r), /INTERNAL_TEST_MARKER/);
  }
});

test('explicit commit mode still advances once and replays idempotently', () => {
  const s = initialState(), e = event(s, 'commit');
  const first = applyCommitted(s, e);
  assert.equal(first.ok, true);
  assert.equal(first.committed, true);
  assert.equal(first.state.scene, 'demo-route-a');
  assert.equal(first.state.version, 1);
  const replay = applyCommitted(first.state, e);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.strictEqual(replay.state, first.state);
  assert.equal(first.state.version, 1);
});
