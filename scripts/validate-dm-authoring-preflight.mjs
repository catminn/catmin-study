/**
 * Synthetic-only, spoiler-free author preflight. One DM beat sheet is shared
 * by event/route guards and both optional-learning route checks.
 * Never authorizes import, public copy, real events or a deployed world.
 */
import {validateDmEventGuardPreflight} from './validate-dm-event-guard-preflight.mjs';
import {validateDmPayoffFullPreflight} from './validate-dm-payoff-full-preflight.mjs';

const FIELDS=['flow','guards','bridge','chapter','alignment','actions','worldGraph','links','proof'];
const fail=code=>({ok:false,code});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

export function validateDmAuthoringPreflight(input) {
  try {
    if (!object(input)||Object.keys(input).length!==FIELDS.length||
        FIELDS.some(k=>!Object.hasOwn(input,k))) return fail('input_invalid');
    const guards=validateDmEventGuardPreflight(input.flow,input.guards,input.bridge);
    if (guards?.ok!==true||guards.matchedRoutes!==2)
      return fail('event_guard_invalid');
    const payoff=validateDmPayoffFullPreflight({
      flow:input.flow,chapter:input.chapter,alignment:input.alignment,
      actions:input.actions,worldGraph:input.worldGraph,
      links:input.links,proof:input.proof
    });
    if (payoff?.ok!==true||payoff.validatedLinks!==2||
        payoff.validatedRoutes!==2) return fail('learning_payoff_invalid');
    // Independent checks must agree on the two committed route identities.
    if (!Array.isArray(input.bridge?.routes)||input.bridge.routes.length!==2||
        !Array.isArray(input.proof?.routes)||input.proof.routes.length!==2)
      return fail('route_crosswalk_invalid');
    const fromBridge=new Map(input.bridge.routes.map(r=>[r.routeBeatId,r.traceRef]));
    const fromProof=new Map(input.proof.routes.map(r=>[r.routeBeatId,r.traceRef]));
    if (fromBridge.size!==2||fromProof.size!==2||
        [...fromBridge].some(([id,trace])=>fromProof.get(id)!==trace))
      return fail('route_crosswalk_invalid');
    return {ok:true,validatedRoutes:2,validatedLinks:2};
  } catch {
    return fail('invalid_input');
  }
}
