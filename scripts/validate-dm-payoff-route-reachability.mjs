/**
 * Spoiler-free, synthetic author-side check: a lesson's registered optional
 * world action must be reachable after EITHER committed DM route.
 * This is not a runtime authorization or proof of narrative causality.
 */
const ID = /^[a-z][a-z0-9._-]{0,79}$/;
const id = x => typeof x === 'string' && ID.test(x);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, fields) => obj(x) && Object.keys(x).length === fields.length &&
  fields.every(k => Object.hasOwn(x, k));
const fail = code => ({ok:false, code});
const ROOT = ['schemaVersion','synthetic','worldId','dmRevision','dungeonId',
  'actionRevision','lessonBeatId','applicationRef','skillId','chapterIndex','routes'];
const ROUTE = ['routeBeatId','traceRef','entrySceneId','goalSceneId',
  'actionKey','baseActionKey','worldFrom','worldTo'];

function reachable(nodes, from, to, blocked = null) {
  const seen = new Set(), queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at === blocked) continue;
    if (at === to) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    queue.push(...nodes.get(at).next.filter(n => !seen.has(n)));
  }
  return false;
}

export function validateDmPayoffRouteReachability(flow, actions, graph, proof) {
  try {
    if (!exact(proof, ROOT) || proof.schemaVersion !== 'dm-payoff-route-reachability-v1' ||
        proof.synthetic !== true ||
        !['worldId','dmRevision','dungeonId','lessonBeatId','applicationRef','skillId']
          .every(k => id(proof[k])) ||
        !Number.isSafeInteger(proof.actionRevision) || proof.actionRevision < 1 ||
        !Number.isSafeInteger(proof.chapterIndex) || proof.chapterIndex < 0 ||
        proof.chapterIndex > 3 || !Array.isArray(proof.routes) ||
        proof.routes.length !== 2 || proof.routes.some(r => !exact(r, ROUTE) ||
          !ROUTE.every(k => id(r[k])))) return fail('proof_invalid');

    // The full DM and action contracts must also pass their existing preflights.
    // Here, check only the source identities and committed two-route reference.
    if (!obj(flow) || !Array.isArray(flow.beats) ||
        flow.beats.some(b => !obj(b) || !id(b.id)) ||
        new Set(flow.beats.map(b => b.id)).size !== flow.beats.length ||
        flow.worldId !== proof.worldId || flow.manifestRevision !== proof.dmRevision)
      return fail('flow_scope_invalid');
    const choices = flow.beats.filter(b => b?.type === 'choice');
    const lessons = flow.beats.filter(b => b?.type === 'lesson_offer');
    if (choices.length !== 1 || lessons.length !== 1 ||
        lessons[0].id !== proof.lessonBeatId ||
        lessons[0].applicationRef !== proof.applicationRef ||
        !Array.isArray(choices[0].next) || choices[0].next.length !== 2 ||
        new Set(choices[0].next).size !== 2) return fail('route_coverage_invalid');
    const committed = choices[0].next.map(routeId =>
      flow.beats.find(b => b?.id === routeId && b.type === 'route' &&
        b.requiresCommit === true && b.eventType === 'action_resolved'));
    if (committed.some(r => !r || !id(r.traceRef)) ||
        new Set(committed.map(r => r.traceRef)).size !== 2)
      return fail('route_coverage_invalid');
    const routes = new Map(proof.routes.map(r => [r.routeBeatId, r]));
    if (routes.size !== 2 || committed.some(r =>
      !routes.has(r.id) || routes.get(r.id).traceRef !== r.traceRef))
      return fail('route_coverage_invalid');

    if (!exact(actions, ['schema','scope','worldId','dungeonId',
          'manifestRevision','skills','bindings']) ||
        actions.schema !== 'dungeon-skill-action-binding-v1' ||
        actions.scope !== 'synthetic-mechanics-only' ||
        actions.worldId !== proof.worldId || actions.dungeonId !== proof.dungeonId ||
        actions.manifestRevision !== proof.actionRevision ||
        !Array.isArray(actions.skills) || !Array.isArray(actions.bindings))
      return fail('action_scope_invalid');
    // Ambiguous registries must not pass because Array.find() selects
    // one favorable duplicate. Full four-skill coverage is checked separately.
    if (actions.skills.length === 0 || actions.skills.length > 4 ||
        actions.skills.some(s => !exact(s, ['chapter','skillId']) ||
          !id(s.skillId) || !Number.isSafeInteger(s.chapter) ||
          s.chapter < 0 || s.chapter > 3) ||
        new Set(actions.skills.map(s => s.skillId)).size !== actions.skills.length ||
        new Set(actions.skills.map(s => s.chapter)).size !== actions.skills.length ||
        actions.bindings.length === 0 || actions.bindings.length > 4 ||
        actions.bindings.some(b =>
          !exact(b, ['actionKey','baseActionKey','skillId','from','to','advantage']) ||
          !['actionKey','baseActionKey','skillId','from','to'].every(k => id(b[k])) ||
          b.actionKey === b.baseActionKey ||
          !['evidence_option','risk_context'].includes(b.advantage) ||
          !actions.skills.some(s => s.skillId === b.skillId)))
      return fail('action_registry_invalid');
    const actionKeys = actions.bindings.map(b => b.actionKey);
    const baseKeys = actions.bindings.map(b => b.baseActionKey);
    if (new Set(actionKeys).size !== actionKeys.length ||
        new Set(baseKeys).size !== baseKeys.length ||
        actionKeys.some(k => baseKeys.includes(k)))
      return fail('action_registry_invalid');
    if (!actions.skills.some(s => s.skillId === proof.skillId &&
        s.chapter === proof.chapterIndex)) return fail('action_unbound');

    if (!exact(graph, ['nodes']) || !Array.isArray(graph.nodes) ||
        graph.nodes.length < 2 || graph.nodes.length > 200 ||
        graph.nodes.some(n => !exact(n, ['id','next']) || !id(n.id) || !Array.isArray(n.next) ||
          n.next.length > 200 || n.next.some(v => !id(v)) ||
          new Set(n.next).size !== n.next.length)) return fail('graph_invalid');
    const nodes = new Map(graph.nodes.map(n => [n.id, n]));
    if (nodes.size !== graph.nodes.length || graph.nodes.some(n =>
      n.next.some(to => !nodes.has(to)))) return fail('graph_invalid');

    for (const route of proof.routes) {
      const action = actions.bindings.find(b => b?.actionKey === route.actionKey);
      if (!action || action.skillId !== proof.skillId ||
          action.baseActionKey !== route.baseActionKey ||
          action.from !== route.worldFrom || action.to !== route.worldTo ||
          !nodes.get(route.worldFrom)?.next.includes(route.worldTo))
        return fail('action_unbound');
      if (!nodes.has(route.entrySceneId) || !nodes.has(route.goalSceneId) ||
          !reachable(nodes, route.entrySceneId, route.worldFrom, route.goalSceneId))
        return fail('action_unreachable');
      if (!reachable(nodes, route.worldTo, route.goalSceneId))
        return fail('goal_unreachable');
    }
    return {ok:true, coveredRoutes:2};
  } catch { return fail('invalid_input'); }
}
