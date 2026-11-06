/**
 * Spoiler-free author-only cross-contract identity check. The DM beat sheet and
 * event guard plan MUST separately pass their own validators first. This does
 * not execute guards, approve copy, authenticate commits, or authorize import.
 */
const ID = /^[a-z][a-z0-9._-]{0,79}$/;
const id = x => typeof x === 'string' && ID.test(x);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, fields) => obj(x) && Object.keys(x).length === fields.length &&
  fields.every(k => Object.hasOwn(x,k));
const fail = code => ({ok:false,code});
const ROOT = ['schemaVersion','synthetic','worldId','manifestRevision','routes'];
const ROUTE = ['routeBeatId','traceRef','choiceTransitionId','choiceEventRef',
  'choiceCopySlot','callbackTransitionId','callbackEventRef','callbackCopySlot'];

export function validateDmEventGuardBridge(flow, guards, bridge) {
  try {
    if (!exact(bridge,ROOT) || bridge.schemaVersion !== 'dm-event-guard-bridge-v1' ||
        bridge.synthetic !== true || !id(bridge.worldId) || !id(bridge.manifestRevision) ||
        !Array.isArray(bridge.routes) || bridge.routes.length !== 2 ||
        bridge.routes.some(r => !exact(r,ROUTE) || !ROUTE.every(k => id(r[k]))))
      return fail('bridge_invalid');
    if (!obj(flow) || !Array.isArray(flow.beats) || !obj(guards) ||
        !Array.isArray(guards.transitions) || !Array.isArray(guards.routes) ||
        !Array.isArray(guards.publicCopySlots)) return fail('contracts_invalid');
    if (flow.worldId !== bridge.worldId || flow.manifestRevision !== bridge.manifestRevision ||
        guards.worldId !== bridge.worldId || guards.manifestRevision !== bridge.manifestRevision)
      return fail('scope_mismatch');
    const beats = new Map(flow.beats.map(b => [b?.id,b]));
    const transitions = new Map(guards.transitions.map(t => [t?.id,t]));
    if (beats.size !== flow.beats.length || transitions.size !== guards.transitions.length)
      return fail('contracts_invalid');
    const choice = flow.beats.filter(b => b?.type === 'choice');
    const merge = flow.beats.filter(b => b?.type === 'convergence');
    if (choice.length !== 1 || merge.length !== 1 || !Array.isArray(choice[0].next) ||
        !Array.isArray(merge[0].callbacks) || choice[0].next.length !== 2 ||
        merge[0].callbacks.length !== 2 || guards.routes.length !== 2)
      return fail('contracts_invalid');
    const unique = (values) => new Set(values).size === 2;
    for (const k of ROUTE) if (!unique(bridge.routes.map(r => r[k])))
      return fail('route_alias');
    const allDmSlots = new Set(flow.beats.flatMap(b =>
      [b?.copySlot,...(Array.isArray(b?.callbacks) ? b.callbacks.map(c => c?.copySlot) : [])]));
    const allowedShared = new Set(bridge.routes.map(r => r.callbackCopySlot));
    for (const t of guards.transitions) {
      if (t?.mode !== 'commit') continue;
      if (allDmSlots.has(t.copySlot) && !allowedShared.has(t.copySlot))
        return fail('stage_copy_collision');
    }
    for (const r of bridge.routes) {
      const beat = beats.get(r.routeBeatId);
      const callback = merge[0].callbacks.find(c => c?.traceRef === r.traceRef);
      const choiceTransition = transitions.get(r.choiceTransitionId);
      const callbackTransition = transitions.get(r.callbackTransitionId);
      const guardRoute = guards.routes.find(g => g?.choiceTransitionId === r.choiceTransitionId);
      if (beat?.type !== 'route' || beat.traceRef !== r.traceRef ||
          !choice[0].next.includes(r.routeBeatId) || !callback ||
          callback.copySlot !== r.callbackCopySlot ||
          callback.requiresCommittedTrace !== true) return fail('dm_route_mismatch');
      if (!guardRoute || guardRoute.callbackTransitionId !== r.callbackTransitionId ||
          !choiceTransition || choiceTransition.mode !== 'commit' ||
          choiceTransition.from !== guards.forkScene ||
          choiceTransition.to !== guards.mergeScene ||
          choiceTransition.eventRef !== r.choiceEventRef ||
          choiceTransition.copySlot !== r.choiceCopySlot ||
          !callbackTransition || callbackTransition.mode !== 'commit' ||
          callbackTransition.from !== guards.mergeScene ||
          callbackTransition.to !== guards.endScene ||
          callbackTransition.eventRef !== r.callbackEventRef ||
          callbackTransition.copySlot !== r.callbackCopySlot ||
          !Array.isArray(choiceTransition.effects?.set) ||
          !choiceTransition.effects.set.includes(guardRoute.routeFlag) ||
          !Array.isArray(callbackTransition.guard?.all) ||
          !callbackTransition.guard.all.includes(guardRoute.routeFlag) ||
          !Array.isArray(callbackTransition.effects?.set) ||
          !callbackTransition.effects.set.includes(guardRoute.callbackFlag) ||
          !guards.publicCopySlots.includes(r.choiceCopySlot) ||
          !guards.publicCopySlots.includes(r.callbackCopySlot))
        return fail('guard_route_mismatch');
      if (allDmSlots.has(r.choiceCopySlot)) return fail('stage_copy_collision');
    }
    if (choice[0].next.some(k => !bridge.routes.some(r => r.routeBeatId === k)) ||
        merge[0].callbacks.some(c => !bridge.routes.some(r => r.traceRef === c?.traceRef)) ||
        guards.routes.some(g => !bridge.routes.some(r =>
          r.choiceTransitionId === g?.choiceTransitionId &&
          r.callbackTransitionId === g?.callbackTransitionId)))
      return fail('route_coverage_invalid');
    return {ok:true,matchedRoutes:2};
  } catch { return fail('invalid_input'); }
}
