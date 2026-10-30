// Synthetic, spoiler-free narrative-author reference. Not a production engine.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = x => structuredClone(x);
// Keep commit keys within the same safe author-ID grammar as scene/event refs.
// In particular, '__proto__' cannot be a commit key in a plain-object ledger.
const validEventId = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const equalScope = (a, b) => !!a && !!b && ['worldId', 'revision', 'sessionId'].every(k => a[k] === b[k] && typeof a[k] === 'string' && a[k].length > 0);

export const policy = Object.freeze({
  scope: { worldId: 'demo-world', revision: 'demo-r1', sessionId: 'demo-session' },
  npcId: 'demo-actor',
  routes: {
    'demo-a': { from: 'demo-fork', to: 'demo-route-a', relation: 'guarded', trace: 'a' },
    'demo-b': { from: 'demo-fork', to: 'demo-route-b', relation: 'open', trace: 'b' }
  },
  convergence: { from: ['demo-route-a', 'demo-route-b'], to: 'demo-join' },
  facts: {
    'demo-public-fact': { audience: 'player' },
    'demo-private-fact': { audience: 'server_only' }
  },
  publicCopies: {
    'demo-neutral': { text: 'The person waits for your question.', relation: 'neutral', approved: true },
    'demo-heard': { text: 'I have heard that account.', relation: 'neutral', approved: true, requiresNpcKnowledge: { factId: 'demo-public-fact', tier: 'heard' } },
    'demo-confirmed': { text: 'I checked the account.', relation: 'neutral', approved: true, requiresNpcKnowledge: { factId: 'demo-public-fact', tier: 'confirmed' } },
    'demo-private-gated': { text: 'The person looks away.', relation: 'neutral', approved: true, requiresNpcKnowledge: { factId: 'demo-private-fact', tier: 'confirmed' } },
    'demo-guarded': { text: 'The reply is careful.', relation: 'guarded', approved: true },
    'demo-open': { text: 'The reply is more forthcoming.', relation: 'open', approved: true },
    'demo-unreviewed': { text: 'Unreviewed placeholder.', relation: 'open', approved: false }
  }
});

// The synthetic route ledger must agree with the persisted scene, relationship,
// and NPC position. Otherwise a corrupt save could erase a chosen route while
// still qualifying for a different approved line after convergence.
const causalStageValid = (s, p) => Object.values(p.routes).some(r =>
  (s.scene === r.from && s.routeTrace === null &&
    s.npc.relation === 'neutral' && s.npc.location === r.from) ||
  (s.scene === r.to && s.routeTrace === r.trace &&
    s.npc.relation === r.relation && s.npc.location === r.from) ||
  (s.scene === p.convergence.to && p.convergence.from.includes(r.to) &&
    s.routeTrace === r.trace && s.npc.relation === r.relation &&
    s.npc.location === p.convergence.to)
);

// Corrupt persisted state cannot grant approved dialogue or partially commit.
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const validState = (s, p) => {
  if (!record(s) || !record(s.npc) || !record(s.player) || !record(s.commits) ||
      !Number.isSafeInteger(s.version) || s.version < 0 ||
      typeof s.scene !== 'string' || !s.scene ||
      !(s.routeTrace === null || typeof s.routeTrace === 'string') ||
      typeof s.npc.location !== 'string' || !s.npc.location ||
      !['available', 'unavailable'].includes(s.npc.availability) ||
      !['neutral', ...Object.values(p.routes).map(r => r.relation)].includes(s.npc.relation)) return false;
  const claims = (list, player) => Array.isArray(list) &&
    list.every(id => typeof id === 'string' && own(p.facts, id) &&
      (!player || p.facts[id].audience === 'player')) &&
    new Set(list).size === list.length;
  if (!claims(s.npc.heardClaims, false) || !claims(s.npc.confirmedFacts, false) ||
      !claims(s.player.heardClaims, true) || !claims(s.player.confirmedFacts, true)) return false;
  const proto = Object.getPrototypeOf(s.commits);
  const ids = Object.keys(s.commits);
  return causalStageValid(s, p) && ids.length === s.version &&
    (proto === Object.prototype || proto === null) &&
    ids.every(id => validEventId(id) && typeof s.commits[id] === 'string');
};

export function initialState(p = policy) {
  // Reference routes share one starting scene; never hard-code the demo fixture.
  // An inconsistent policy cannot silently invent an NPC starting location.
  if (!record(p?.routes)) throw new TypeError('invalid_route_policy');
  const starts = Object.values(p.routes).map(r => r?.from);
  if (starts.length !== 2 || new Set(starts).size !== 1 ||
      typeof starts[0] !== 'string' || !starts[0]) throw new TypeError('invalid_route_policy');
  const start = starts[0];
  return {
    scope: clone(p.scope), version: 0, scene: start, routeTrace: null,
    npc: { location: start, availability: 'available', relation: 'neutral', heardClaims: [], confirmedFacts: [] },
    player: { heardClaims: [], confirmedFacts: [] },
    commits: {}
  };
}

// Only a server-committed event is eligible. Event names and effect values are
// resolved against author policy; a model's proposed effects have no authority.
export function applyCommitted(state, event, p = policy) {
  if (!state || !event || !equalScope(state.scope, p.scope) || !equalScope(event.scope, state.scope)) return { ok: false, code: 'scope_invalid', state };
  if (!validState(state, p)) return { ok: false, code: 'state_invalid', state };
  if (event.mode === 'ask' || event.mode === 'preview') return { ok: true, committed: false, state };
  if (event.source !== 'server' || event.status !== 'committed' || !validEventId(event.id)) return { ok: false, code: 'not_committed', state };
  const fingerprint = JSON.stringify({ type: event.type, scope: event.scope, route: event.route, factId: event.factId, next: event.next, subject: event.subject });
  if (own(state.commits, event.id)) {
    return state.commits[event.id] === fingerprint
      ? { ok: true, committed: false, replay: true, state }
      : { ok: false, code: 'event_id_reused', state };
  }
  if (event.expectedVersion !== state.version) return { ok: false, code: 'stale_state', state };
  const next = clone(state);
  const coLocated = state.scene === state.npc.location && state.npc.availability === 'available';
  switch (event.type) {
    case 'route_committed': {
      const rule = p.routes[event.route];
      if (!rule || state.scene !== rule.from || event.next !== rule.to) return { ok: false, code: 'route_invalid', state };
      next.scene = rule.to;
      next.routeTrace = rule.trace;
      next.npc.relation = rule.relation;
      break;
    }
    case 'scene_entered': {
      if (!p.convergence.from.includes(state.scene) || event.next !== p.convergence.to) return { ok: false, code: 'scene_invalid', state };
      next.scene = p.convergence.to;
      next.npc.location = p.convergence.to;
      break;
    }
    case 'availability_changed': {
      if (!['available', 'unavailable'].includes(event.next)) return { ok: false, code: 'availability_invalid', state };
      next.npc.availability = event.next;
      break;
    }
    case 'player_told_npc': {
      if (!coLocated) return { ok: false, code: 'encounter_invalid', state };
      if (!own(p.facts, event.factId)) return { ok: false, code: 'fact_unknown', state };
      // Player testimony requires an accessible fact already acquired by that player.
      if (p.facts[event.factId].audience !== 'player') return { ok: false, code: 'audience_denied', state };
      if (!Array.isArray(state.player.heardClaims) || !Array.isArray(state.player.confirmedFacts) ||
          (!state.player.heardClaims.includes(event.factId) && !state.player.confirmedFacts.includes(event.factId))) {
        return { ok: false, code: 'player_cannot_testify', state };
      }
      if (!next.npc.heardClaims.includes(event.factId)) next.npc.heardClaims.push(event.factId);
      break;
    }
    case 'npc_told_player': {
      if (!coLocated) return { ok: false, code: 'encounter_invalid', state };
      if (!next.npc.heardClaims.includes(event.factId) && !next.npc.confirmedFacts.includes(event.factId)) return { ok: false, code: 'npc_cannot_testify', state };
      if (p.facts[event.factId]?.audience !== 'player') return { ok: false, code: 'audience_denied', state };
      if (!next.player.heardClaims.includes(event.factId)) next.player.heardClaims.push(event.factId);
      break;
    }
    case 'fact_verified': {
      if (!own(p.facts, event.factId) || !['npc', 'player'].includes(event.subject)) return { ok: false, code: 'verification_invalid', state };
      if (event.subject === 'player' && p.facts[event.factId].audience !== 'player') return { ok: false, code: 'audience_denied', state };
      const target = event.subject === 'npc' ? next.npc.confirmedFacts : next.player.confirmedFacts;
      if (!target.includes(event.factId)) target.push(event.factId);
      break;
    }
    default: return { ok: false, code: 'event_unsupported', state };
  }
  next.version++;
  next.commits[event.id] = fingerprint;
  return { ok: true, committed: true, state: next };
}

// This is an author-approved-text projection example, not a player API.
// No NPC identifiers, fact identifiers, claim tiers, traces or internal state.
export function projectDialogue(state, copyId, p = policy) {
  if (!state || !equalScope(state.scope, p.scope) || !validState(state, p)) return { available: false, text: null };
  const available = state.scene === state.npc.location && state.npc.availability === 'available';
  if (!available) return { available: false, text: null };
  const copy = p.publicCopies[copyId];
  if (!copy || copy.approved !== true || copy.relation !== state.npc.relation) return { available: true, text: null };
  // An approved line may require an NPC knowledge tier; player knowledge is not NPC knowledge.
  // A malformed gate is never interpreted as an unrestricted line.
  if (Object.prototype.hasOwnProperty.call(copy, 'requiresNpcKnowledge')) {
    const gate = copy.requiresNpcKnowledge;
    if (!gate || typeof gate !== 'object' || Array.isArray(gate) ||
        Object.keys(gate).sort().join(',') !== 'factId,tier' ||
        typeof gate.factId !== 'string' || !own(p.facts, gate.factId) ||
        !['heard', 'confirmed'].includes(gate.tier) ||
        !Array.isArray(state.npc.heardClaims) || !Array.isArray(state.npc.confirmedFacts)) {
      return { available: true, text: null };
    }
    const confirmed = state.npc.confirmedFacts.includes(gate.factId);
    const heard = state.npc.heardClaims.includes(gate.factId);
    if (!(confirmed || (gate.tier === 'heard' && heard))) return { available: true, text: null };
  }
  return { available: true, text: copy.text };
}
