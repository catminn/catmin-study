import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, projectDialogue, policy} from '../scripts/npc-testimony-reference.mjs';

// Synthetic author-only scope envelopes. These tests do not exercise Worker/D1.
const event = (s, id = 'demo-scope-1') => ({
  id, type: 'fact_verified', subject: 'npc', factId: 'demo-public-fact',
  scope: structuredClone(s.scope), source: 'server', status: 'committed',
  mode: 'commit', expectedVersion: s.version
});
const snapshot = s => JSON.stringify(s);
const denied = (s, e, code) => {
  const before = snapshot(s);
  const r = applyCommitted(s, e);
  assert.equal(r.ok, false);
  assert.equal(r.code, code);
  assert.strictEqual(r.state, s);
  assert.equal(snapshot(s), before);
  assert.doesNotMatch(JSON.stringify({code: r.code}), /demo-only-payload/i);
};

test('canonical three-field scope survives JSON persistence, replay, and approved projection', () => {
  const fresh = initialState();
  const e = event(fresh);
  const committed = applyCommitted(fresh, e);
  assert.equal(committed.ok, true);
  assert.equal(committed.committed, true);
  const persisted = JSON.parse(JSON.stringify(committed.state));
  assert.deepEqual(Object.keys(persisted.scope).sort(), ['revision', 'sessionId', 'worldId']);
  assert.deepEqual(Object.keys(JSON.parse(persisted.commits[e.id]).scope).sort(),
    ['revision', 'sessionId', 'worldId']);
  const before = snapshot(persisted);
  const replay = applyCommitted(persisted, e);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.strictEqual(replay.state, persisted);
  assert.equal(snapshot(persisted), before);
  assert.equal(projectDialogue(persisted, 'demo-confirmed').text,
    policy.publicCopies['demo-confirmed'].text);
});

test('extra scope data in a persisted commit fingerprint fails closed', () => {
  const fresh = initialState();
  const e = event(fresh);
  const saved = applyCommitted(fresh, e).state;
  const corrupt = JSON.parse(JSON.stringify(saved));
  const fingerprint = JSON.parse(corrupt.commits[e.id]);
  fingerprint.scope.unreviewedPayload = 'demo-only-payload';
  corrupt.commits[e.id] = JSON.stringify(fingerprint);
  denied(corrupt, event(corrupt, 'demo-scope-2'), 'state_invalid');
  assert.deepEqual(projectDialogue(corrupt, 'demo-confirmed'), {available: false, text: null});
});

test('extra or malformed persisted top-level scope fails closed without approved dialogue', () => {
  const base = applyCommitted(initialState(), event(initialState())).state;
  const malformed = [
    {...base.scope, unreviewedPayload: 'demo-only-payload'},
    {...base.scope, sessionId: null},
    {worldId: base.scope.worldId, revision: base.scope.revision},
    [base.scope.worldId, base.scope.revision, base.scope.sessionId],
    null
  ];
  for (const scope of malformed) {
    const corrupt = JSON.parse(JSON.stringify(base));
    corrupt.scope = scope;
    denied(corrupt, event(base, 'demo-scope-2'), 'scope_invalid');
    assert.deepEqual(projectDialogue(corrupt, 'demo-confirmed'), {available: false, text: null});
  }
});

test('incoming event scope cannot smuggle extra fields even when its identifiers match', () => {
  const s = initialState();
  for (const scope of [
    {...s.scope, unreviewedPayload: 'demo-only-payload'},
    {...s.scope, revision: ''},
    {worldId: s.scope.worldId, revision: s.scope.revision},
    null
  ]) {
    const e = event(s);
    e.scope = scope;
    denied(s, e, 'scope_invalid');
    assert.equal(s.version, 0);
    assert.deepEqual(Object.keys(s.commits), []);
  }
});
