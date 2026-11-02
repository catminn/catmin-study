import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, projectDialogue} from '../scripts/npc-testimony-reference.mjs';

// All identifiers and facts are synthetic. These are author-reference tests,
// not Worker/D1 request validation or private story-content approval.
const event = (state, type, payload = {}) => ({
  id: 'demo-incoming-' + (state.version + 1),
  type, scope: structuredClone(state.scope), source: 'server',
  status: 'committed', mode: 'commit', expectedVersion: state.version,
  ...payload
});
const committed = (state, type, payload) => {
  const result = applyCommitted(state, event(state, type, payload));
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  return result.state;
};
const learned = subject => committed(initialState(), 'fact_verified',
  {factId: 'demo-public-fact', subject});
const onRoute = () => committed(initialState(), 'route_committed',
  {route: 'demo-a', next: 'demo-route-a'});

const cases = [
  () => [initialState(), 'route_committed', {route: 'demo-a', next: 'demo-route-a'}],
  () => [onRoute(), 'scene_entered', {next: 'demo-join'}],
  () => [initialState(), 'availability_changed', {next: 'unavailable'}],
  () => [learned('player'), 'player_told_npc', {factId: 'demo-public-fact'}],
  () => [learned('npc'), 'npc_told_player', {factId: 'demo-public-fact'}],
  () => [initialState(), 'fact_verified', {factId: 'demo-public-fact', subject: 'npc'}]
];
const rejectWithoutMutation = (state, incoming) => {
  const before = JSON.stringify(state);
  const result = applyCommitted(state, incoming);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'event_fields_invalid');
  assert.strictEqual(result.state, state);
  assert.equal(JSON.stringify(state), before);
  assert.doesNotMatch(JSON.stringify({code: result.code}), /SYNTHETIC_SENTINEL/);
};

test('six reviewed NPC event shapes commit, but extra fields cannot cross the incoming boundary', () => {
  for (const build of cases) {
    const [state, type, payload] = build();
    const clean = event(state, type, payload);
    assert.equal(applyCommitted(state, clean).committed, true, type);
    for (const extra of [
      {unreviewedPayload: 'SYNTHETIC_SENTINEL'},
      {publicOutcome: 'SYNTHETIC_SENTINEL'},
      {route: 'demo-b', factId: 'demo-public-fact', next: 'demo-route-b'}
    ]) {
      const additions = Object.fromEntries(Object.entries(extra)
        .filter(([key]) => !Object.hasOwn(clean, key)));
      if (Object.keys(additions).length)
        rejectWithoutMutation(state, {...clean, ...additions});
    }
  }
});

test('missing required event envelope or per-action payload fails closed', () => {
  for (const build of cases) {
    const [state, type, payload] = build();
    const clean = event(state, type, payload);
    for (const key of ['expectedVersion', ...Object.keys(payload)]) {
      const malformed = {...clean};
      delete malformed[key];
      rejectWithoutMutation(state, malformed);
    }
  }
});

test('idempotent replay cannot smuggle unreviewed fields through an existing commit ID', () => {
  for (const build of cases) {
    const [state, type, payload] = build();
    const clean = event(state, type, payload);
    const saved = JSON.parse(JSON.stringify(applyCommitted(state, clean).state));
    const replay = applyCommitted(saved, clean);
    assert.equal(replay.ok, true);
    assert.equal(replay.replay, true);
    assert.strictEqual(replay.state, saved);
    rejectWithoutMutation(saved, {...clean, unreviewedPayload: 'SYNTHETIC_SENTINEL'});
  }
});

test('ASK and preview remain read-only even when carrying unreviewed synthetic fields', () => {
  const state = initialState();
  const clean = event(state, 'route_committed', {route: 'demo-a', next: 'demo-route-a'});
  const before = JSON.stringify(state);
  for (const mode of ['ask', 'preview']) {
    const outcome = applyCommitted(state, {...clean, mode, unreviewedPayload: 'SYNTHETIC_SENTINEL'});
    assert.equal(outcome.ok, true);
    assert.equal(outcome.committed, false);
    assert.strictEqual(outcome.state, state);
    assert.equal(JSON.stringify(state), before);
  }
  assert.equal(projectDialogue(state, 'demo-neutral').available, true);
});
