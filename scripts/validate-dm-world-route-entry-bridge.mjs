/**
 * Synthetic author-side bridge between committed world routes and a DM payoff
 * proof. Prevents invented route entries or world graph edges from satisfying
 * a static reachability claim. Does not authenticate actual Worker routing.
 */
import {validateWorld01RouteAgency} from './validate-world01-route-agency.mjs';
import {validateDmPayoffRouteReachability} from './validate-dm-payoff-route-reachability.mjs';

const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const exact = (x, fields) => obj(x) && Object.keys(x).length === fields.length &&
  fields.every(k => Object.hasOwn(x, k));
const fail = code => ({ok:false,code});
const ROOT = ['schemaVersion','synthetic','worldId','dmRevision','routeBindings'];
const BINDING = ['routeBeatId','routeCommitId','traceRef'];

export function validateDmWorldRouteEntryBridge(world, causal, flow, actions, graph, proof, bridge) {
  try {
    if (!exact(bridge, ROOT) || bridge.schemaVersion !== 'dm-world-route-entry-bridge-v1' ||
        bridge.synthetic !== true || !id(bridge.worldId) || !id(bridge.dmRevision) ||
        !Array.isArray(bridge.routeBindings) || bridge.routeBindings.length !== 2 ||
        bridge.routeBindings.some(b => !exact(b, BINDING) || !BINDING.every(k => id(b[k]))) ||
        BINDING.some(k => new Set(bridge.routeBindings.map(b => b[k])).size !== 2))
      return fail('bridge_invalid');

    if (validateWorld01RouteAgency(world, causal).ok !== true)
      return fail('world_contract_invalid');
    if (validateDmPayoffRouteReachability(flow, actions, graph, proof).ok !== true)
      return fail('payoff_contract_invalid');
    if (world.packageId !== bridge.worldId || causal.worldId !== bridge.worldId ||
        flow.worldId !== bridge.worldId || proof.worldId !== bridge.worldId ||
        flow.manifestRevision !== bridge.dmRevision || proof.dmRevision !== bridge.dmRevision)
      return fail('scope_mismatch');

    // A separately supplied worldGraph cannot add, remove, or redirect exits.
    const projected = new Map(graph.nodes.map(n => [n.id,n.next]));
    if (projected.size !== world.nodes.length || world.nodes.some(n => {
      const exits = projected.get(n.id);
      return !exits || exits.length !== n.next.length ||
        n.next.some(to => !exits.includes(to));
    })) return fail('projection_mismatch');

    const commits = new Map(causal.routeCommits.map(c => [c.id,c]));
    const routes = new Map(proof.routes.map(r => [r.routeBeatId,r]));
    if (commits.size !== 2 || routes.size !== 2) return fail('route_binding_mismatch');
    for (const binding of bridge.routeBindings) {
      const commit = commits.get(binding.routeCommitId);
      const route = routes.get(binding.routeBeatId);
      if (!commit || !route || route.traceRef !== binding.traceRef ||
          route.entrySceneId !== commit.to)
        return fail('route_binding_mismatch');
    }
    if (bridge.routeBindings.some(b => !commits.has(b.routeCommitId) || !routes.has(b.routeBeatId)))
      return fail('route_binding_mismatch');
    return {ok:true,validatedRoutes:2};
  } catch { return fail('invalid_input'); }
}
