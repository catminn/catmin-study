import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/world01-causal-authoring-v1.json', import.meta.url), 'utf8'));
const graph = JSON.parse(readFileSync(new URL('../content/contracts/world01-opening-skeleton.json', import.meta.url), 'utf8'));
const clone = value => structuredClone(value);

// Public, synthetic authoring lint. This does NOT simulate or verify the real engine.
function lint(c, world = graph) {
  const errors = new Set();
  const nodes = new Map(world.nodes.map(n => [n.id, n]));
  const events = new Map();
  if (c.schema !== 'world01-causal-authoring-v1' || c.scope !== 'synthetic-mechanics-only') errors.add('contract_shape');
  if (c.worldId !== world.packageId) errors.add('world_mismatch');
  if (new Set(world.nodes.map(n => n.id)).size !== world.nodes.length) errors.add('duplicate_scene');
  for (const n of world.nodes) for (const to of n.next) if (!nodes.has(to)) errors.add('dangling_scene');
  const reachable = new Set();
  function visit(id) {
    if (reachable.has(id) || !nodes.has(id)) return;
    reachable.add(id);
    for (const to of nodes.get(id).next) visit(to);
  }
  visit('w01.entry');
  if (reachable.size !== nodes.size) errors.add('unreachable_scene');

  for (const event of c.routeCommits) {
    if (events.has(event.id)) errors.add('duplicate_event');
    events.set(event.id, event);
    if (!nodes.has(event.from) || !nodes.get(event.from).next.includes(event.to)) errors.add('route_not_in_graph');
    if (event.cause?.type !== 'scene_entered' || event.cause.sceneId !== event.to || event.cause.requiresCommittedTransition !== true) errors.add('uncommitted_cause');
    if (event.effect?.type !== 'set_flag' || event.effect.target !== 'route_trace' || !['a', 'b'].includes(event.effect.value)) errors.add('unsupported_route_effect');
    if (event.repeatPolicy !== 'once_per_world') errors.add('non_idempotent_event');
  }
  const traces = c.routeCommits.map(e => e.effect?.value);
  if (traces.length !== 2 || new Set(traces).size !== 2 || !['a', 'b'].every(t => traces.includes(t))) errors.add('route_diversity');

  const npc = c.npcContinuity;
  if (!nodes.has(npc.initial.location) || !['available', 'unavailable'].includes(npc.initial.availability)) errors.add('npc_initial_invalid');
  if (npc.initial.claimTier !== 'unverified' || npc.claimPromotion !== 'only_authorized_fact_discovery') errors.add('claim_promotion_unsafe');
  const byEvent = new Map();
  for (const transition of npc.transitions) {
    if (!events.has(transition.onCommitted)) errors.add('npc_transition_without_event');
    if (byEvent.has(transition.onCommitted)) errors.add('npc_duplicate_transition');
    byEvent.set(transition.onCommitted, transition.set);
    if (transition.set.location && !nodes.has(transition.set.location)) errors.add('npc_teleport');
    if (transition.set.claimTier === 'confirmed') errors.add('claim_promotion_unsafe');
    if (!['neutral', 'guarded', 'open'].includes(transition.set.relation)) errors.add('npc_relation_invalid');
  }
  if (byEvent.size !== events.size) errors.add('npc_missing_branch');

  if (!nodes.has(c.convergence.scene) || c.convergence.scene !== 'w01.discover') errors.add('convergence_invalid');
  const required = ['route_trace', 'npc_relation', 'committed_event_ids'];
  if (!required.every(k => c.convergence.preserve.includes(k))) errors.add('branch_memory_lost');
  const outcomes = c.convergence.routeOutcomes;
  for (const event of c.routeCommits) {
    const state = byEvent.get(event.id);
    if (!state || !outcomes.some(o => o.routeTrace === event.effect.value && o.npcRelation === state.relation)) errors.add('outcome_not_caused');
    if (!nodes.get(event.to)?.next.includes(c.convergence.scene)) errors.add('route_not_convergent');
  }
  if (outcomes.length !== 2 || new Set(outcomes.map(o => o.routeTrace)).size !== 2) errors.add('outcome_ambiguous');

  const learning = c.learning;
  if (!learning.requiresPlayerConsent || !learning.allowsNonAcademicProgress || learning.fabricateMeasurements || learning.narrationMayCommitEffects) errors.add('forced_or_fabricated_learning');
  for (const id of learning.scenes) if (!nodes.has(id) || !nodes.get(id).next.length) errors.add('learning_blocks_progress');
  const projection = c.publicProjection;
  if (projection.source !== 'committed_state_only' || projection.claimTierWithoutDiscovery !== 'unverified' || projection.exposeInternalIds || projection.exposeUncommittedConsequences) errors.add('premature_public_reveal');
  return [...errors].sort(); // diagnostic codes only: no story text or IDs
}

test('synthetic first-world causal authoring contract is valid', () => assert.deepEqual(lint(fixture), []));
test('all graph nodes must be reachable from the opening', () => {
  const world = clone(graph); world.nodes.push({id:'w01.orphan',next:[]});
  assert.ok(lint(fixture, world).includes('unreachable_scene'));
});
test('dangling scene edges are rejected', () => {
  const world = clone(graph); world.nodes[0].next.push('w01.missing');
  assert.ok(lint(fixture, world).includes('dangling_scene'));
});
test('a preview or narrator claim cannot be a commit cause', () => {
  const c = clone(fixture); c.routeCommits[0].cause.type = 'narration_suggested';
  assert.ok(lint(c).includes('uncommitted_cause'));
});
test('route effects must be allowlisted and idempotent', () => {
  const c = clone(fixture); c.routeCommits[0].effect.type = 'grant_secret'; c.routeCommits[0].repeatPolicy = 'every_time';
  assert.ok(lint(c).includes('unsupported_route_effect'));
  assert.ok(lint(c).includes('non_idempotent_event'));
});
test('NPC changes must have a committed cause and valid location', () => {
  const c = clone(fixture); c.npcContinuity.transitions[0].onCommitted = 'uncommitted-event';
  c.npcContinuity.transitions[0].set.location = 'w01.unknown';
  assert.ok(lint(c).includes('npc_transition_without_event'));
  assert.ok(lint(c).includes('npc_teleport'));
});
test('unverified testimony cannot be promoted by narration or route choice', () => {
  const c = clone(fixture); c.npcContinuity.transitions[0].set.claimTier = 'confirmed';
  assert.ok(lint(c).includes('claim_promotion_unsafe'));
});
test('route convergence preserves committed branch consequences', () => {
  const c = clone(fixture); c.convergence.preserve = ['committed_event_ids'];
  assert.ok(lint(c).includes('branch_memory_lost'));
});
test('branch outcome must agree with its own committed NPC transition', () => {
  const c = clone(fixture); c.convergence.routeOutcomes[0].npcRelation = 'open';
  assert.ok(lint(c).includes('outcome_not_caused'));
});
test('optional learning cannot block ordinary exploration or fabricate data', () => {
  const c = clone(fixture); c.learning.allowsNonAcademicProgress = false; c.learning.fabricateMeasurements = true;
  assert.ok(lint(c).includes('forced_or_fabricated_learning'));
});
test('private or uncommitted outcomes cannot appear in public projection', () => {
  const c = clone(fixture); c.publicProjection.exposeUncommittedConsequences = true;
  assert.ok(lint(c).includes('premature_public_reveal'));
});
test('cross-world reference and duplicate event are rejected', () => {
  const c = clone(fixture); c.worldId = 'world02'; c.routeCommits[1].id = c.routeCommits[0].id;
  assert.ok(lint(c).includes('world_mismatch'));
  assert.ok(lint(c).includes('duplicate_event'));
});
