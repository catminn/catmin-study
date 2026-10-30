// Spoiler-free author-side branch consequence coverage. No story content or runtime state.
// A callback key denotes a *conditional* later acknowledgement of a chosen route.
const idOK = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x, k));
const ids = (xs, max = 200) => Array.isArray(xs) && xs.length <= max &&
  xs.every(idOK) && new Set(xs).size === xs.length;
const fail = code => ({ok:false,code}); // Never echo author-supplied IDs.

export function validateRouteConsequenceOutline(m) {
  if (!exact(m, ['start','nodes']) || !idOK(m.start) || !Array.isArray(m.nodes) ||
      m.nodes.length < 2 || m.nodes.length > 200) return fail('shape_invalid');
  const nodes = new Map();
  const impacts = new Map();
  for (const n of m.nodes) {
    if (!exact(n, ['id','end','exits','acknowledges']) || !idOK(n.id) ||
        typeof n.end !== 'boolean' || !Array.isArray(n.exits) || n.exits.length > 200 ||
        !ids(n.acknowledges) || nodes.has(n.id)) return fail('node_invalid');
    if ((n.end && (n.exits.length !== 0 || n.acknowledges.length !== 0)) ||
        (!n.end && n.exits.length === 0)) return fail('exit_invalid');
    const targets = new Set();
    for (const edge of n.exits) {
      if (!exact(edge, ['to','impactKey']) || !idOK(edge.to) ||
          !(edge.impactKey === null || idOK(edge.impactKey)) || targets.has(edge.to))
        return fail('edge_invalid');
      targets.add(edge.to);
      if (n.exits.length > 1) {
        if (edge.impactKey === null || impacts.has(edge.impactKey)) return fail('impact_invalid');
        impacts.set(edge.impactKey, edge.to);
      } else if (edge.impactKey !== null) return fail('impact_invalid');
    }
    nodes.set(n.id,n);
  }
  if (!nodes.has(m.start) || ![...nodes.values()].some(n => n.end)) return fail('endpoint_invalid');
  for (const n of nodes.values()) {
    for (const e of n.exits) if (!nodes.has(e.to)) return fail('edge_invalid');
    for (const k of n.acknowledges) if (!impacts.has(k)) return fail('reference_invalid');
  }
  // Reject cycles and disconnected beats before evaluating any branch consequence.
  const indegree = new Map([...nodes.keys()].map(k => [k,0]));
  for (const n of nodes.values()) for (const e of n.exits)
    indegree.set(e.to, indegree.get(e.to)+1);
  const ready = [...nodes.keys()].filter(k => indegree.get(k) === 0);
  const order = [];
  for (let i=0;i<ready.length;i++) {
    const id=ready[i]; order.push(id);
    for (const e of nodes.get(id).exits) {
      indegree.set(e.to,indegree.get(e.to)-1);
      if (indegree.get(e.to)===0) ready.push(e.to);
    }
  }
  if (order.length !== nodes.size) return fail('cycle_invalid');
  const reached = new Set([m.start]);
  for (const id of order) if (reached.has(id))
    for (const e of nodes.get(id).exits) reached.add(e.to);
  if (reached.size !== nodes.size) return fail('unreachable_node');
  // For each chosen edge, every possible suffix must encounter a nonterminal,
  // conditionally rendered callback for that edge's impact key before ending.
  // This reverse DAG proof avoids enumerating exponentially many story routes.
  for (const [key, destination] of impacts) {
    const guaranteed = new Map();
    for (const id of [...order].reverse()) {
      const n = nodes.get(id);
      guaranteed.set(id, !n.end &&
        (n.acknowledges.includes(key) || n.exits.every(e => guaranteed.get(e.to))));
    }
    if (!guaranteed.get(destination)) return fail('callback_missing');
  }
  return {ok:true,nodeCount:nodes.size,branchOutcomeCount:impacts.size};
}
