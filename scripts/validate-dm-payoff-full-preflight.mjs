/**
 * Synthetic, spoiler-free author preflight: run all three complementary
 * lesson-to-world-action checks together, for BOTH committed DM routes.
 * Not a runtime gate, content approval, or authorization to import.
 */
import {validateDmLearningPayoff} from './validate-dm-learning-payoff.mjs';
import {validateDmPayoffRouteReachability} from './validate-dm-payoff-route-reachability.mjs';
import {validateDmPayoffDualRouteLinks} from './validate-dm-payoff-dual-route-links.mjs';

const FIELDS = ['flow','chapter','alignment','actions','worldGraph','links','proof'];
const fail = code => ({ok:false, code});

export function validateDmPayoffFullPreflight(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).length !== FIELDS.length ||
        FIELDS.some(key => !Object.hasOwn(input, key)) ||
        !Array.isArray(input.links) || input.links.length !== 2)
      return fail('input_invalid');

    // Compare the two links before evaluating either one in isolation.
    if (validateDmPayoffDualRouteLinks(input.links, input.proof).ok !== true)
      return fail('cross_route_invalid');

    // The single-route check must run twice. Checking only one route would
    // leave the other route's chapter and optional action unreviewed.
    for (const link of input.links) {
      if (validateDmLearningPayoff(input.flow, input.chapter, input.alignment,
          input.actions, input.worldGraph, link).ok !== true)
        return fail('route_link_invalid');
    }

    if (validateDmPayoffRouteReachability(input.flow, input.actions,
        input.worldGraph, input.proof).ok !== true)
      return fail('route_reachability_invalid');

    return {ok:true, validatedLinks:2, validatedRoutes:2};
  } catch {
    return fail('invalid_input');
  }
}
