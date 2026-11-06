/**
 * Synthetic, spoiler-free author preflight for route-dependent NPC continuity.
 * Calls the existing beat validator and NPC reference transition/projection.
 * This is NOT an import gate, model test, identity proof, or runtime authorization.
 * All diagnostics are fixed codes; no source values, dialogue, or IDs are echoed.
 */
import { validateDmBeatFlow } from './validate-dm-beat-flow.mjs';
import { initialState, applyCommitted, projectDialogue } from './npc-testimony-reference.mjs';
import {npcPublicCopySafe} from './npc-public-copy-safety.mjs';
import {npcDialogueComparisonKey} from './npc-dialogue-comparison.mjs';

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const exact = (x, fields) => obj(x) && Object.keys(x).length === fields.length && fields.every(k => own(x, k));
const finish = errors => ({ ok: errors.size === 0, codes: [...errors].sort(), errorCount: errors.size });
const ROOT = ['schemaVersion','synthetic','worldId','manifestRevision','choiceBeatId','convergenceBeatId','routeBindings'];
const BINDING = ['routeBeatId','npcRouteKey','traceRef','callbackCopySlot','dialogueCopyId'];

export function validateDmNpcRouteBridge(flow, npcPolicy, bridge) {
  const errors = new Set();
  const fail = code => errors.add(code);
  try {
    if (!validateDmBeatFlow(flow).ok) fail('invalid_beat_contract');
  } catch { fail('invalid_beat_contract'); }
  if (!exact(bridge, ROOT) || bridge.schemaVersion !== 'dm-npc-route-bridge-v1' || bridge.synthetic !== true ||
      ![bridge.worldId,bridge.manifestRevision,bridge.choiceBeatId,bridge.convergenceBeatId].every(id) ||
      !Array.isArray(bridge.routeBindings) || bridge.routeBindings.length !== 2 ||
      bridge.routeBindings.some(b => !exact(b,BINDING) || !BINDING.every(k => id(b[k])))) fail('invalid_bridge');
  if (!obj(npcPolicy) || !obj(npcPolicy.scope) || !obj(npcPolicy.routes) ||
      !obj(npcPolicy.convergence) || !obj(npcPolicy.publicCopies) || !id(npcPolicy.scope.sessionId)) fail('invalid_npc_policy');
  if (errors.size) return finish(errors);
  if (flow.worldId !== bridge.worldId || flow.manifestRevision !== bridge.manifestRevision ||
      npcPolicy.scope.worldId !== bridge.worldId || npcPolicy.scope.revision !== bridge.manifestRevision) fail('scope_mismatch');
  const beats = new Map(flow.beats.map(b => [b.id,b]));
  const choice = beats.get(bridge.choiceBeatId);
  const merge = beats.get(bridge.convergenceBeatId);
  let initialScene;
  try { initialScene = initialState(npcPolicy).scene; }
  catch { fail('invalid_npc_policy'); fail('route_mismatch'); return finish(errors); }
  if (choice?.type !== 'choice' || merge?.type !== 'convergence' ||
      choice.id !== initialScene || npcPolicy.convergence.to !== merge?.id) fail('scene_mismatch');
  if (errors.size) return finish(errors);

  const routeIds = new Set(), npcKeys = new Set(), traces = new Set(), callbacks = new Set(), copies = new Set();
  const relations = new Set(), texts = new Set();
  for (const b of bridge.routeBindings) {
    if (routeIds.has(b.routeBeatId) || npcKeys.has(b.npcRouteKey) || traces.has(b.traceRef) ||
        callbacks.has(b.callbackCopySlot) || copies.has(b.dialogueCopyId)) fail('binding_alias');
    routeIds.add(b.routeBeatId); npcKeys.add(b.npcRouteKey); traces.add(b.traceRef);
    callbacks.add(b.callbackCopySlot); copies.add(b.dialogueCopyId);
    const beat = beats.get(b.routeBeatId);
    const route = own(npcPolicy.routes,b.npcRouteKey) ? npcPolicy.routes[b.npcRouteKey] : null;
    if (beat?.type !== 'route' || !choice.next.includes(b.routeBeatId) ||
        beat.next[0] !== merge.id || beat.traceRef !== b.traceRef ||
        !obj(route) || route.from !== choice.id || route.to !== b.routeBeatId || route.trace !== b.traceRef ||
        !id(route.relation)) { fail('route_mismatch'); continue; }
    const callback = merge.callbacks.find(c => c.traceRef === b.traceRef);
    if (!callback || callback.copySlot !== b.callbackCopySlot || callback.requiresCommittedTrace !== true) fail('callback_mismatch');
    const copy = own(npcPolicy.publicCopies,b.dialogueCopyId) ? npcPolicy.publicCopies[b.dialogueCopyId] : null;
    if (!npcPublicCopySafe(copy) || copy.relation !== route.relation) fail('dialogue_unapproved');
    else { relations.add(route.relation); texts.add(npcDialogueComparisonKey(copy.text)); }
  }
  if (choice.next.some(r => !routeIds.has(r)) || merge.callbacks.some(c => !traces.has(c.traceRef)) ||
      !Array.isArray(npcPolicy.convergence.from) || npcPolicy.convergence.from.length !== 2 ||
      npcPolicy.convergence.from.some(r => !routeIds.has(r)) ||
      new Set(npcPolicy.convergence.from).size !== 2) fail('incomplete_mapping');
  if (relations.size !== 2 || texts.size !== 2) fail('route_consequence_erased');
  if (errors.size) return finish(errors);

  // Reference transitions are replayed only in isolated synthetic state.
  for (let i=0; i<bridge.routeBindings.length; i++) {
    const b=bridge.routeBindings[i];
    const initial=initialState(npcPolicy);
    const snapshot=JSON.stringify(initial);
    const event={ id:'demo-route-event-'+i, source:'server', status:'committed',
      scope:npcPolicy.scope, expectedVersion:initial.version, type:'route_committed',
      route:b.npcRouteKey, next:b.routeBeatId };
    const preview=applyCommitted(initial,{...event,mode:'ask'},npcPolicy);
    if (!preview.ok || preview.committed !== false || JSON.stringify(initial)!==snapshot || preview.state!==initial) fail('preview_mutates');
    const first=applyCommitted(initial,event,npcPolicy);
    if (!first.ok || !first.committed || first.state.scene!==b.routeBeatId ||
        first.state.routeTrace!==b.traceRef || first.state.npc.relation!==npcPolicy.routes[b.npcRouteKey].relation) {
      fail('route_replay_failed'); continue;
    }
    const early=projectDialogue(first.state,b.dialogueCopyId,npcPolicy);
    if (early.available || early.text!==null) fail('premature_dialogue');
    const replay=applyCommitted(first.state,event,npcPolicy);
    if (!replay.ok || replay.committed!==false || replay.replay!==true || replay.state!==first.state) fail('replay_not_idempotent');
    const entered=applyCommitted(first.state,{id:'demo-join-event-'+i,source:'server',status:'committed',
      scope:npcPolicy.scope,expectedVersion:first.state.version,type:'scene_entered',next:merge.id},npcPolicy);
    if (!entered.ok || !entered.committed || entered.state.npc.relation!==npcPolicy.routes[b.npcRouteKey].relation ||
        entered.state.routeTrace!==b.traceRef) { fail('convergence_erases_history'); continue; }
    const dialogue=projectDialogue(entered.state,b.dialogueCopyId,npcPolicy);
    if (!dialogue.available || dialogue.text!==npcPolicy.publicCopies[b.dialogueCopyId].text) fail('dialogue_not_projected');
    const other=bridge.routeBindings[1-i];
    if (projectDialogue(entered.state,other.dialogueCopyId,npcPolicy).text!==null) fail('cross_route_dialogue');
    if (JSON.stringify(initial)!==snapshot) fail('state_mutated');
  }
  return finish(errors);
}
