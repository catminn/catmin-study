import test from 'node:test';
import assert from 'node:assert/strict';
import { policy, initialState, applyCommitted, projectDialogue } from '../scripts/npc-testimony-reference.mjs';

const fresh = () => initialState();
const event = (state, type, extra = {}) => ({ id: 'demo-' + (state.version + 1), type, scope: structuredClone(state.scope), source: 'server', status: 'committed', expectedVersion: state.version, ...extra });
const apply = (s, type, extra) => applyCommitted(s, event(s, type, extra));
const route = (r = 'demo-a') => {
  const s = fresh();
  const e = event(s, 'route_committed', { route: r, next: policy.routes[r].to });
  return applyCommitted(s, e).state;
};
const join = (r = 'demo-a') => apply(route(r), 'scene_entered', { next: 'demo-join' }).state;

// Synthetic checks of narrative causality only; no production Worker/D1 tested.
test('initial NPC is available and neutral', () => assert.deepEqual(projectDialogue(fresh(), 'demo-neutral'), { available: true, text: policy.publicCopies['demo-neutral'].text }));
test('both branches are valid committed transitions', () => {
  for (const r of ['demo-a', 'demo-b']) assert.equal(route(r).routeTrace, policy.routes[r].trace);
});
test('branch relation survives convergence without rewriting history', () => {
  assert.equal(join('demo-a').npc.relation, 'guarded');
  assert.equal(join('demo-b').npc.relation, 'open');
  assert.equal(join('demo-a').routeTrace, 'a');
});
test('NPC cannot speak at a remote scene', () => {
  const s = route();
  assert.deepEqual(projectDialogue(s, 'demo-guarded'), { available: false, text: null });
  assert.equal(apply(s, 'player_told_npc', { factId: 'demo-public-fact' }).code, 'encounter_invalid');
});
test('unavailable NPC cannot be questioned', () => {
  const s = apply(fresh(), 'availability_changed', { next: 'unavailable' }).state;
  assert.deepEqual(projectDialogue(s, 'demo-neutral'), { available: false, text: null });
  assert.equal(apply(s, 'npc_told_player', { factId: 'demo-public-fact' }).code, 'encounter_invalid');
});
test('ASK and preview never commit or mutate state', () => {
  const s = fresh();
  for (const mode of ['ask', 'preview']) {
    const e = { ...event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a' }), mode };
    const out = applyCommitted(s, e);
    assert.equal(out.committed, false);
    assert.strictEqual(out.state, s);
  }
});
test('model-suggested or uncommitted events have no authority', () => {
  const s = fresh();
  assert.equal(applyCommitted(s, { ...event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a' }), source: 'model' }).code, 'not_committed');
  assert.equal(applyCommitted(s, { ...event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a' }), status: 'suggested' }).code, 'not_committed');
});
test('cross-session, cross-revision and cross-world events fail closed', () => {
  const s = fresh();
  for (const key of ['sessionId', 'revision', 'worldId']) {
    const e = event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a' });
    e.scope[key] = 'different';
    assert.equal(applyCommitted(s, e).code, 'scope_invalid');
  }
});
test('stale version rejects transition without partial mutation', () => {
  const s = fresh();
  const e = event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a', expectedVersion: -1 });
  assert.strictEqual(applyCommitted(s, e).state, s);
});
test('duplicate delivery is idempotent', () => {
  const s = fresh();
  const e = event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a' });
  const committed = applyCommitted(s, e).state;
  const replay = applyCommitted(committed, e);
  assert.equal(replay.replay, true);
  assert.strictEqual(replay.state, committed);
});
test('reusing a commit ID for a different route is rejected', () => {
  const s = fresh();
  const e = event(s, 'route_committed', { route: 'demo-a', next: 'demo-route-a' });
  const committed = applyCommitted(s, e).state;
  assert.equal(applyCommitted(committed, { ...e, route: 'demo-b', next: 'demo-route-b' }).code, 'event_id_reused');
});
test('unlisted destination and arbitrary event types are rejected', () => {
  const s = fresh();
  assert.equal(apply(s, 'route_committed', { route: 'demo-a', next: 'demo-join' }).code, 'route_invalid');
  assert.equal(apply(s, 'grant_secret', {}).code, 'event_unsupported');
});
test('a player claim heard by NPC does not become confirmed NPC knowledge', () => {
  const learned = apply(fresh(), 'fact_verified', { factId: 'demo-public-fact', subject: 'player' }).state;
  const s = apply(learned, 'player_told_npc', { factId: 'demo-public-fact' }).state;
  assert.deepEqual(s.npc.heardClaims, ['demo-public-fact']);
  assert.deepEqual(s.npc.confirmedFacts, []);
  assert.deepEqual(s.player.confirmedFacts, ['demo-public-fact']);
});
test('an NPC repeats a claim without turning it into verified player fact', () => {
  const s = apply(fresh(), 'fact_verified', { factId: 'demo-public-fact', subject: 'npc' }).state;
  const after = apply(s, 'npc_told_player', { factId: 'demo-public-fact' }).state;
  assert.deepEqual(after.player.heardClaims, ['demo-public-fact']);
  assert.deepEqual(after.player.confirmedFacts, []);
});
test('NPC cannot assert a fact absent from own knowledge and heard claims', () => {
  assert.equal(apply(fresh(), 'npc_told_player', { factId: 'demo-public-fact' }).code, 'npc_cannot_testify');
});
test('verification is explicit and subject-specific', () => {
  const s = apply(fresh(), 'fact_verified', { factId: 'demo-public-fact', subject: 'npc' }).state;
  assert.deepEqual(s.npc.confirmedFacts, ['demo-public-fact']);
  assert.deepEqual(s.player.confirmedFacts, []);
  const p = apply(s, 'fact_verified', { factId: 'demo-public-fact', subject: 'player' }).state;
  assert.deepEqual(p.player.confirmedFacts, ['demo-public-fact']);
});
test('server-private knowledge cannot be disclosed or player-verified', () => {
  const s = apply(fresh(), 'fact_verified', { factId: 'demo-private-fact', subject: 'npc' }).state;
  assert.equal(apply(s, 'npc_told_player', { factId: 'demo-private-fact' }).code, 'audience_denied');
  assert.equal(apply(s, 'fact_verified', { factId: 'demo-private-fact', subject: 'player' }).code, 'audience_denied');
});
test('unknown fact and unsupported subject fail closed', () => {
  assert.equal(apply(fresh(), 'player_told_npc', { factId: 'unknown' }).code, 'fact_unknown');
  assert.equal(apply(fresh(), 'fact_verified', { factId: 'demo-public-fact', subject: 'narrator' }).code, 'verification_invalid');
});
test('wrong relation copy and unapproved copy never appear', () => {
  const s = join('demo-b');
  assert.equal(projectDialogue(s, 'demo-guarded').text, null);
  assert.equal(projectDialogue(s, 'demo-unreviewed').text, null);
  assert.equal(projectDialogue(s, 'unknown').text, null);
  assert.equal(projectDialogue(s, 'demo-open').text, policy.publicCopies['demo-open'].text);
});
test('public projection never serializes identifiers, route traces or knowledge arrays', () => {
  const s = apply(join('demo-b'), 'fact_verified', { factId: 'demo-private-fact', subject: 'npc' }).state;
  const json = JSON.stringify(projectDialogue(s, 'demo-open'));
  for (const token of ['demo-private-fact', 'demo-actor', 'demo-world', 'routeTrace', 'confirmedFacts', 'heardClaims', 'commits', 'demo-open']) assert.equal(json.includes(token), false);
});
test('a player learning a fact does not teleport it to the NPC', () => {
  const s = apply(fresh(), 'fact_verified', { factId: 'demo-public-fact', subject: 'player' }).state;
  assert.deepEqual(s.npc.confirmedFacts, []);
  assert.deepEqual(s.npc.heardClaims, []);
});
test('rejected operations preserve original object identity and version', () => {
  const s = fresh();
  const out = apply(s, 'npc_told_player', { factId: 'demo-public-fact' });
  assert.strictEqual(out.state, s);
  assert.equal(s.version, 0);
  assert.deepEqual(s.commits, {});
});
