/**
 * Spoiler-free authoring preflight. Synthetic structures only.
 * Never authorizes import, runtime events, public copy, or a live world.
 */
import {validateDmBeatFlow} from './validate-dm-beat-flow.mjs';
import {validateDmEventGuards} from './validate-dm-event-guards.mjs';
import {validateDmEventGuardBridge} from './validate-dm-event-guard-bridge.mjs';

const fail = code => ({ok:false,code});

export function validateDmEventGuardPreflight(flow, guards, bridge) {
  try {
    if (validateDmBeatFlow(flow)?.ok !== true) return fail('dm_flow_invalid');
    if (validateDmEventGuards(guards)?.ok !== true) return fail('guard_plan_invalid');
    const result = validateDmEventGuardBridge(flow, guards, bridge);
    if (result?.ok !== true || result.matchedRoutes !== 2)
      return fail('bridge_invalid');
    return {ok:true,matchedRoutes:2};
  } catch {
    return fail('invalid_input');
  }
}
