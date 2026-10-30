// Spoiler-free author QA. Private copy text is inspected only in memory.
// This is not a renderer, runtime authorization, or import approval.
import {validateRouteConsequenceOutline} from './validate-route-consequence-outline.mjs';

const id = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => obj(x) && Object.keys(x).length === keys.length &&
  keys.every(k => Object.hasOwn(x,k));
const fail = code => ({ok:false,code}); // Never echo private text or IDs.
const normalized = text => text.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('und');

export function validateRouteResponseDifferentiation(outline, plan) {
  try {
    if (!validateRouteConsequenceOutline(outline).ok) return fail('outline_invalid');
    if (!exact(plan,['schema','responses']) || plan.schema !== 'route-response-differentiation-v1' ||
        !Array.isArray(plan.responses) || plan.responses.length > 200) return fail('plan_invalid');
    const siblingGroups = outline.nodes.filter(n => n.exits.length > 1)
      .map(n => n.exits.map(e => e.impactKey));
    if (siblingGroups.length === 0) return fail('no_branch_choices');
    const expected = new Set(siblingGroups.flat());
    const responseMap = new Map();
    for (const r of plan.responses) {
      if (!exact(r,['impactKey','approved','copy']) || !id(r.impactKey) ||
          typeof r.approved !== 'boolean' || typeof r.copy !== 'string' ||
          r.copy.length > 2000) return fail('response_invalid');
      if (!expected.has(r.impactKey) || responseMap.has(r.impactKey)) return fail('response_catalog_invalid');
      responseMap.set(r.impactKey,r);
    }
    if (responseMap.size !== expected.size) return fail('response_missing');
    for (const r of responseMap.values()) {
      if (!r.approved || normalized(r.copy).length === 0) return fail('response_unapproved');
    }
    for (const group of siblingGroups) {
      const copies = group.map(k => normalized(responseMap.get(k).copy));
      if (new Set(copies).size !== copies.length) return fail('response_indistinct');
    }
    return {ok:true,branchCount:siblingGroups.length,copyCount:responseMap.size};
  } catch { return fail('input_invalid'); }
}
