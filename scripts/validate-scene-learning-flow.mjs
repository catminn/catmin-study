// Spoiler-free authoring reference. Not a live DM, API, or private-world importer.
// Validate an acyclic chapter-beat graph, not a free-roaming world map.
const idOK = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
// This narrow author contract must never silently ignore hidden gating fields.
const exactKeys = (x, keys) => record(x) && Object.keys(x).length === keys.length &&
  keys.every(key => Object.hasOwn(x, key));
const unique = xs => new Set(xs).size === xs.length;
const listOfIds = (xs, limit = 200) => Array.isArray(xs) && xs.length <= limit && xs.every(idOK) && unique(xs);
const fail = code => ({ ok: false, code }); // No user-supplied names or text in errors.

export function validateSceneLearningFlow(m) {
  if (!exactKeys(m, ['start', 'skills', 'practices', 'nodes']) || !idOK(m.start) || !listOfIds(m.skills) || !Array.isArray(m.practices) ||
      !Array.isArray(m.nodes) || m.nodes.length < 2 || m.nodes.length > 200 ||
      m.practices.length > 200 || m.skills.length === 0) return fail('shape_invalid');
  const skills = new Set(m.skills);
  const practiceMap = new Map();
  for (const p of m.practices) {
    if (!exactKeys(p, ['id', 'skillId']) || !idOK(p.id) || !idOK(p.skillId) ||
        !skills.has(p.skillId) || practiceMap.has(p.id)) return fail('catalog_invalid');
    practiceMap.set(p.id, p.skillId);
  }
  const nodes = new Map();
  for (const n of m.nodes) {
    if (!exactKeys(n, ['id', 'objectiveKey', 'end', 'teaches', 'offers', 'exits']) || !idOK(n.id) || !idOK(n.objectiveKey) ||
        typeof n.end !== 'boolean' || !listOfIds(n.teaches) ||
        !listOfIds(n.offers) || !listOfIds(n.exits) || nodes.has(n.id)) return fail('node_invalid');
    if (n.teaches.some(x => !skills.has(x)) || n.offers.some(x => !practiceMap.has(x))) return fail('reference_invalid');
    if ((n.end && n.exits.length !== 0) || (!n.end && n.exits.length === 0)) return fail('exit_invalid');
    nodes.set(n.id, n);
  }
  if (!nodes.has(m.start) || ![...nodes.values()].some(n => n.end)) return fail('endpoint_invalid');
  if (![...nodes.values()].some(n => n.offers.length > 0)) return fail('learning_missing');
  const indegree = new Map([...nodes.keys()].map(k => [k, 0]));
  const predecessors = new Map([...nodes.keys()].map(k => [k, []]));
  for (const n of nodes.values()) for (const to of n.exits) {
    if (!nodes.has(to)) return fail('exit_invalid');
    indegree.set(to, indegree.get(to) + 1);
    predecessors.get(to).push(n.id);
  }
  // Topological order makes the all-path knowledge proof finite and deterministic.
  const ready = [...nodes.keys()].filter(k => indegree.get(k) === 0);
  const order = [];
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]; order.push(id);
    for (const to of nodes.get(id).exits) {
      indegree.set(to, indegree.get(to) - 1);
      if (indegree.get(to) === 0) ready.push(to);
    }
  }
  if (order.length !== nodes.size) return fail('cycle_invalid');
  const reachable = new Set([m.start]);
  for (const id of order) if (reachable.has(id)) for (const to of nodes.get(id).exits) reachable.add(to);
  if (reachable.size !== nodes.size) return fail('unreachable_node');
  const canFinish = new Set();
  for (const id of [...order].reverse()) {
    const n = nodes.get(id);
    if (n.end || n.exits.some(to => canFinish.has(to))) canFinish.add(id);
  }
  if (canFinish.size !== nodes.size) return fail('dead_end');
  // Every offered exercise must be supported by teaching on EVERY story-only path.
  // At joins, intersect guaranteed skills from incoming branches (not union).
  const guaranteed = new Map();
  // A learning-first chapter must *offer* practice before its ending on every
  // story-only route. This never requires the player to complete that practice.
  const practiceSeenOnAllPaths = new Map();
  // A chapter-local practice catalog must not advertise cards that the story
  // never offers before its ending (even if another card covers every route).
  const offeredBeforeEnd = new Set();
  for (const id of order) {
    const n = nodes.get(id);
    const parents = predecessors.get(id);
    const prior = parents.length === 0 ? new Set() :
      new Set([...guaranteed.get(parents[0])].filter(skill =>
        parents.every(parent => guaranteed.get(parent).has(skill))));
    // A beat is atomic in this projection: it cannot prove whether its own
    // teaching appears before its offer. Require teaching in a preceding beat.
    for (const practiceId of n.offers) {
      if (!prior.has(practiceMap.get(practiceId))) return fail('practice_before_teaching');
      if (!n.end) offeredBeforeEnd.add(practiceId);
    }
    for (const skill of n.teaches) prior.add(skill);
    guaranteed.set(id, prior);
    const hadOpportunity = parents.length > 0 && parents.every(parent => practiceSeenOnAllPaths.get(parent));
    // A practice offered only at the terminal beat is an epilogue, not an
    // opportunity encountered before reaching the chapter's ending.
    const opportunity = hadOpportunity || (!n.end && n.offers.length > 0);
    practiceSeenOnAllPaths.set(id, opportunity);
    if (n.end && !opportunity) return fail('learning_path_missing');
  }
  if ([...practiceMap.keys()].some(id => !offeredBeforeEnd.has(id))) return fail('practice_unoffered');
  return { ok: true, nodeCount: nodes.size, practiceCount: practiceMap.size };
}
