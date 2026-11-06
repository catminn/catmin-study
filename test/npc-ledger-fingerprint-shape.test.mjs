import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, projectDialogue, policy} from '../scripts/npc-testimony-reference.mjs';

// All events and dialogue are synthetic. This checks only an author-side
// persisted evidence ledger, not production Worker/D1 authorization.
const expectedFields = {
  fact_verified: ['type', 'scope', 'factId', 'subject'],
  npc_told_player: ['type', 'scope', 'factId'],
  player_told_npc: ['type', 'scope', 'factId'],
  route_committed: ['type', 'scope', 'route', 'next'],
  scene_entered: ['type', 'scope', 'next'],
  availability_changed: ['type', 'scope', 'next']
};
function build() {
  let state = initialState();
  const events = [];
  const commit = (type, extra = {}) => {
    const event = {
      id: 'demo-ledger-shape-' + (state.version + 1),
      type, scope: structuredClone(state.scope),
      source: 'server', status: 'committed', mode: 'commit',
      expectedVersion: state.version, ...extra
    };
    const result = applyCommitted(state, event);
    assert.equal(result.ok, true, type + ':' + JSON.stringify(result.code));
    assert.equal(result.committed, true);
    state = result.state;
    events.push(event);
  };
  commit('fact_verified', {subject: 'npc', factId: 'demo-public-fact'});
  commit('npc_told_player', {factId: 'demo-public-fact'});
  commit('player_told_npc', {factId: 'demo-public-fact'});
  commit('route_committed', {route: 'demo-a', next: 'demo-route-a'});
  commit('scene_entered', {next: 'demo-join'});
  commit('availability_changed', {next: 'unavailable'});
  return {state, events};
}

test('six legitimate NPC evidence kinds survive JSON persistence and idempotent replay', () => {
  const {state, events} = build();
  const persisted = JSON.parse(JSON.stringify(state));
  assert.equal(persisted.version, 6);
  for (const [index, event] of events.entries()) {
    const entry = JSON.parse(persisted.commits[event.id]);
    assert.deepEqual(Object.keys(entry).sort(), [...expectedFields[event.type]].sort());
    const before = JSON.stringify(persisted);
    const replay = applyCommitted(persisted, event);
    assert.equal(replay.ok, true, 'replay ' + index);
    assert.equal(replay.replay, true);
    assert.equal(replay.committed, false);
    assert.strictEqual(replay.state, persisted);
    assert.equal(JSON.stringify(persisted), before);
  }
  const resume = applyCommitted(persisted, {
    id: 'demo-ledger-shape-7', type: 'availability_changed',
    scope: structuredClone(persisted.scope), source: 'server',
    status: 'committed', mode: 'commit', expectedVersion: 6, next: 'available'
  });
  assert.equal(resume.ok, true);
  assert.equal(projectDialogue(resume.state, 'demo-guarded').text,
    policy.publicCopies['demo-guarded'].text);
});

test('unreviewed fields in any persisted NPC evidence kind fail closed', () => {
  const {state} = build();
  for (const id of Object.keys(state.commits)) {
    const tampered = structuredClone(state);
    const entry = JSON.parse(tampered.commits[id]);
    entry.unreviewedPayload = 'demo-private-placeholder';
    tampered.commits[id] = JSON.stringify(entry);
    const before = JSON.stringify(tampered);
    const rejected = applyCommitted(tampered, {
      id: 'demo-ledger-shape-7', type: 'availability_changed',
      scope: structuredClone(tampered.scope), source: 'server',
      status: 'committed', mode: 'commit', expectedVersion: 6, next: 'available'
    });
    assert.equal(rejected.ok, false, id);
    assert.equal(rejected.code, 'state_invalid', id);
    assert.strictEqual(rejected.state, tampered);
    assert.equal(JSON.stringify(tampered), before);
    assert.deepEqual(projectDialogue(tampered, 'demo-guarded'),
      {available: false, text: null});
    assert.doesNotMatch(rejected.code, /private|placeholder|demo/i);
  }
});

test('missing required evidence fields fail closed without changing the snapshot', () => {
  const {state, events} = build();
  for (const event of events) {
    const tampered = structuredClone(state);
    const entry = JSON.parse(tampered.commits[event.id]);
    const required = expectedFields[event.type].find(field => field !== 'type' && field !== 'scope');
    delete entry[required];
    tampered.commits[event.id] = JSON.stringify(entry);
    const before = JSON.stringify(tampered);
    const rejected = applyCommitted(tampered, {
      id: 'demo-ledger-shape-7', type: 'availability_changed',
      scope: structuredClone(tampered.scope), source: 'server',
      status: 'committed', mode: 'commit', expectedVersion: 6, next: 'available'
    });
    assert.equal(rejected.code, 'state_invalid', event.type);
    assert.strictEqual(rejected.state, tampered);
    assert.equal(JSON.stringify(tampered), before);
    assert.deepEqual(projectDialogue(tampered, 'demo-guarded'),
      {available: false, text: null});
  }
});
