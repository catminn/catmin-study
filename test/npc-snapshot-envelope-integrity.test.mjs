import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, projectDialogue, policy} from '../scripts/npc-testimony-reference.mjs';

// Entirely invented evidence and copy. This is an author-only reference test,
// not a Worker/D1 authorization or real-story persistence test.
const event = (state, id) => ({
  id, type: 'fact_verified', factId: 'demo-public-fact', subject: 'npc',
  scope: structuredClone(state.scope), source: 'server', status: 'committed',
  mode: 'commit', expectedVersion: state.version
});
function savedWithEvidence() {
  const fresh = initialState();
  const first = event(fresh, 'demo-envelope-1');
  const result = applyCommitted(fresh, first);
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  return {saved: JSON.parse(JSON.stringify(result.state)), first};
}
function expectRejected(saved, incoming) {
  const before = JSON.stringify(saved);
  const outcome = applyCommitted(saved, incoming);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'state_invalid');
  assert.strictEqual(outcome.state, saved);
  assert.equal(JSON.stringify(saved), before);
  assert.deepEqual(projectDialogue(saved, 'demo-confirmed'), {available: false, text: null});
  assert.doesNotMatch(JSON.stringify({code: outcome.code}), /demo-unreviewed-payload/);
}

test('reviewed snapshot envelope survives persistence, replay and a new commit', () => {
  const {saved, first} = savedWithEvidence();
  assert.deepEqual(Object.keys(saved).sort(),
    ['scope', 'version', 'scene', 'routeTrace', 'npc', 'player', 'commits'].sort());
  assert.deepEqual(Object.keys(saved.npc).sort(),
    ['location', 'availability', 'relation', 'heardClaims', 'confirmedFacts'].sort());
  assert.deepEqual(Object.keys(saved.player).sort(), ['heardClaims', 'confirmedFacts'].sort());
  const replay = applyCommitted(saved, first);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.strictEqual(replay.state, saved);
  const next = applyCommitted(saved, event(saved, 'demo-envelope-2'));
  assert.equal(next.ok, true);
  assert.equal(next.committed, true);
  assert.equal(next.state.version, 2);
  assert.equal(projectDialogue(next.state, 'demo-confirmed').text,
    policy.publicCopies['demo-confirmed'].text);
});

test('unreviewed top-level, NPC and player fields cannot ride through a commit or projection', () => {
  for (const mutate of [
    s => { s.unreviewedPayload = 'demo-unreviewed-payload'; },
    s => { s.npc.unreviewedPayload = 'demo-unreviewed-payload'; },
    s => { s.player.unreviewedPayload = 'demo-unreviewed-payload'; }
  ]) {
    const {saved, first} = savedWithEvidence();
    mutate(saved);
    expectRejected(saved, event(saved, 'demo-envelope-2'));
    expectRejected(saved, first);
  }
});

test('missing snapshot envelope fields fail closed without mutating saved evidence', () => {
  for (const mutate of [
    s => { delete s.routeTrace; },
    s => { delete s.npc.relation; },
    s => { delete s.player.confirmedFacts; }
  ]) {
    const {saved} = savedWithEvidence();
    mutate(saved);
    expectRejected(saved, event(saved, 'demo-envelope-2'));
  }
});
