/** Spoiler-free synthetic authoring integration check. NOT a runtime, review gate, or import tool. */
import {validateDmBeatFlow} from './validate-dm-beat-flow.mjs';
import {validateDmFailureForward} from './validate-dm-failure-forward.mjs';
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const ID = /^[a-z][a-z0-9._-]{0,79}$/;
const isId = x => typeof x === 'string' && ID.test(x);
const finish = errors => ({ok:errors.size===0,codes:[...errors].sort(),errorCount:errors.size});

/** Bridge deliberately accepts no text, secrets, actor IDs, review assertions, or content hashes. */
export function validateDmContractBridge(flow, failure, binding) {
  const errors=new Set();
  const fail=code=>errors.add(code);
  if (!validateDmBeatFlow(flow).ok) fail('invalid_beat_contract');
  if (!validateDmFailureForward(failure).ok) fail('invalid_failure_contract');
  if (errors.size) return finish(errors);
  const expected=['schemaVersion','synthetic','routeBeatId','routeTraceRef','recoveryBeatId','aftermathBeatId'];
  if (!obj(binding) || Object.keys(binding).length!==expected.length ||
      !expected.every(k=>own(binding,k)) || binding.schemaVersion!=='dm-contract-bridge-v1' ||
      binding.synthetic!==true || ![binding.routeBeatId,binding.routeTraceRef,binding.recoveryBeatId,binding.aftermathBeatId].every(isId)) {
    fail('invalid_bridge'); return finish(errors);
  }
  if (flow.worldId!==failure.worldId || flow.manifestRevision!==failure.manifestRevision) fail('scope_mismatch');
  const beats=new Map(flow.beats.map(b=>[b.id,b]));
  const route=beats.get(binding.routeBeatId);
  const merge=beats.get(binding.recoveryBeatId);
  const end=beats.get(binding.aftermathBeatId);
  if (route?.type!=='route' || route.traceRef!==binding.routeTraceRef ||
      !flow.beats.some(b=>b.type==='choice' && b.next.includes(binding.routeBeatId))) fail('route_unbound');
  if (merge?.type!=='convergence' || !merge.callbacks.some(c=>c.traceRef===binding.routeTraceRef)) fail('recovery_unbound');
  if (end?.type!=='aftermath' || end.id!==flow.end) fail('aftermath_unbound');
  if (failure.attempt.sceneId!==binding.routeBeatId ||
      failure.attempt.recoverySceneId!==binding.recoveryBeatId ||
      failure.attempt.endSceneId!==binding.aftermathBeatId ||
      failure.callbacks.some(c=>c.at!==binding.aftermathBeatId)) fail('scene_mismatch');
  const reachable=(from,to)=>{
    const seen=new Set(),queue=[from];
    while(queue.length){const id=queue.shift();if(id===to)return true;if(seen.has(id))continue;seen.add(id);queue.push(...(beats.get(id)?.next||[]));}
    return false;
  };
  if (![route,merge,end].every(Boolean) || !reachable(binding.routeBeatId,binding.recoveryBeatId) ||
      !reachable(binding.recoveryBeatId,binding.aftermathBeatId)) fail('progression_unreachable');
  const flowSlots=flow.beats.flatMap(b=>[b.copySlot,...(b.type==='convergence'?b.callbacks.map(c=>c.copySlot):[])]);
  const failureSlots=[...failure.attempt.outcomes.map(o=>o.copySlot),
    ...failure.attempt.recovery.map(r=>r.copySlot),...failure.callbacks.map(c=>c.copySlot)];
  if (flowSlots.some(s=>failureSlots.includes(s))) fail('copy_slot_collision');
  const refs=[...failure.attempt.outcomes.map(o=>o.eventRef),...failure.attempt.recovery.map(r=>r.eventRef)];
  if (refs.includes(binding.routeTraceRef) || refs.some(r=>flow.beats.some(b=>b.type==='route' && b.traceRef===r))) fail('trace_event_alias');
  // The only authorized bridge is structural: an author still must separately approve every public field.
  return finish(errors);
}
