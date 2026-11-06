import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, projectDialogue, policy} from '../scripts/npc-testimony-reference.mjs';

// Invented actors, facts, routes, and copy only. This is an author-side
// reference-model test, not a real Worker/D1 or private-story simulation.
const actions = ['route', 'join', 'verify', 'tell', 'off', 'on'];
function* permutations(items, prefix = []) {
  if (!items.length) { yield prefix; return; }
  for (let i = 0; i < items.length; i++) {
    yield* permutations([...items.slice(0, i), ...items.slice(i + 1)], [...prefix, items[i]]);
  }
}

function runExhaustive(subject) {
  let sequences = 0, attempts = 0, accepted = 0, replays = 0;
  for (const routeKey of ['demo-a', 'demo-b']) {
    for (const order of permutations(actions)) {
      let state = initialState();
      const model = {stage: 'fork', known: false, told: false, available: true, version: 0};
      for (const action of order) {
        const type = action === 'route' ? 'route_committed'
          : action === 'join' ? 'scene_entered'
          : action === 'verify' ? 'fact_verified'
          : action === 'tell' ? (subject === 'npc' ? 'npc_told_player' : 'player_told_npc')
          : 'availability_changed';
        const extra = action === 'route' ? {route: routeKey, next: policy.routes[routeKey].to}
          : action === 'join' ? {next: policy.convergence.to}
          : action === 'verify' ? {subject, factId: 'demo-public-fact'}
          : action === 'tell' ? {factId: 'demo-public-fact'}
          : {next: action === 'off' ? 'unavailable' : 'available'};
        const event = {
          id: 'demo-sequence-' + (model.version + 1), type,
          scope: structuredClone(state.scope), source: 'server',
          status: 'committed', mode: 'commit', expectedVersion: model.version,
          ...extra
        };
        // This independent six-action model does not read the implementation's
        // event ledger or its validity predicate.
        const expected = action === 'route' ? model.stage === 'fork'
          : action === 'join' ? model.stage === 'route'
          : action === 'tell' ? model.known && model.available && model.stage !== 'route'
          : true;
        const before = structuredClone(state);
        const result = applyCommitted(state, event);
        attempts++;
        assert.equal(result.ok, expected, subject + ':' + routeKey + ':' + order.join(',') + ':' + action);
        if (!expected) {
          assert.strictEqual(result.state, state);
          assert.deepEqual(state, before);
          assert.equal(typeof result.code, 'string');
          continue;
        }
        accepted++;
        state = result.state;
        model.version++;
        if (action === 'route') model.stage = 'route';
        if (action === 'join') model.stage = 'join';
        if (action === 'verify') model.known = true;
        if (action === 'tell') model.told = true;
        if (action === 'off') model.available = false;
        if (action === 'on') model.available = true;

        const route = policy.routes[routeKey];
        const scene = model.stage === 'fork' ? 'demo-fork'
          : model.stage === 'route' ? route.to : 'demo-join';
        assert.equal(state.version, model.version);
        assert.equal(Object.keys(state.commits).length, model.version);
        assert.equal(state.scene, scene);
        assert.equal(state.routeTrace, model.stage === 'fork' ? null : route.trace);
        assert.equal(state.npc.location, model.stage === 'join' ? 'demo-join' : 'demo-fork');
        assert.equal(state.npc.relation, model.stage === 'fork' ? 'neutral' : route.relation);
        assert.equal(state.npc.availability, model.available ? 'available' : 'unavailable');
        assert.deepEqual(state.npc.confirmedFacts,
          subject === 'npc' && model.known ? ['demo-public-fact'] : []);
        assert.deepEqual(state.player.confirmedFacts,
          subject === 'player' && model.known ? ['demo-public-fact'] : []);
        assert.deepEqual(state.npc.heardClaims,
          subject === 'player' && model.told ? ['demo-public-fact'] : []);
        assert.deepEqual(state.player.heardClaims,
          subject === 'npc' && model.told ? ['demo-public-fact'] : []);

        const copyId = model.stage === 'fork' ? 'demo-neutral'
          : routeKey === 'demo-a' ? 'demo-guarded' : 'demo-open';
        const visible = model.available && model.stage !== 'route';
        const projection = projectDialogue(state, copyId);
        assert.equal(projection.available, visible);
        assert.equal(projection.text, visible ? policy.publicCopies[copyId].text : null);
        const replay = applyCommitted(state, event);
        assert.equal(replay.ok, true);
        assert.equal(replay.replay, true);
        assert.equal(replay.committed, false);
        assert.strictEqual(replay.state, state);
        replays++;
      }
      sequences++;
    }
  }
  assert.equal(sequences, 1440);
  assert.equal(attempts, 8640);
  assert.equal(accepted, 6732);
  assert.equal(replays, accepted);
}

test('NPC testimony remains causal across all route, reunion, availability and verification orders', () => {
  runExhaustive('npc');
});
test('player testimony remains causal across all route, reunion, availability and verification orders', () => {
  runExhaustive('player');
});
