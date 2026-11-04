// Diagnostic only: records a known author-reference integrity gap.
// All identifiers are synthetic. This test does NOT approve the behavior,
// certify production safety, or authorize any world import.
import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, policy, projectDialogue} from '../scripts/npc-testimony-reference.mjs';

test('DIAGNOSTIC: swapping two saved event fingerprints is not detected by current reference', () => {
  const scope = structuredClone(policy.scope);
  let state = initialState();
  const event = (id, factId, expectedVersion) => ({
    id, type: 'fact_verified', scope, source: 'server',
    status: 'committed', mode: 'commit', expectedVersion,
    factId, subject: 'npc'
  });
  const a = event('demo-event-a', 'demo-public-fact', 0);
  const b = event('demo-event-b', 'demo-private-fact', 1);
  const first = applyCommitted(state, a);
  assert.equal(first.ok, true);
  assert.equal(first.committed, true);
  state = first.state;
  const second = applyCommitted(state, b);
  assert.equal(second.ok, true);
  assert.equal(second.committed, true);
  state = second.state;

  const tampered = structuredClone(state);
  [tampered.commits[a.id], tampered.commits[b.id]] =
    [tampered.commits[b.id], tampered.commits[a.id]];
  assert.notDeepEqual(tampered.commits, state.commits);
  // The current reference's public projection performs validState checks.
  // This assertion documents the defect, rather than accepting it as a contract.
  assert.deepEqual(projectDialogue(tampered, 'demo-neutral'),
    projectDialogue(state, 'demo-neutral'));
  assert.deepEqual(projectDialogue(tampered, 'demo-neutral'),
    {available: true, text: 'The person waits for your question.'});

  // The original committed event can no longer be replayed idempotently.
  const replay = applyCommitted(tampered, a);
  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'event_id_reused');
});
