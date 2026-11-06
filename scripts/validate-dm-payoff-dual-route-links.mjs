/**
 * Synthetic, spoiler-free author preflight: both committed DM routes must have
 * individually reviewable lesson-to-action links, consistent with a separate
 * two-route world reachability proof. No runtime or import authorization.
 */
const ID = /^[a-z][a-z0-9._-]{0,79}$/;
const id = value => typeof value === 'string' && ID.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) &&
  Object.keys(value).length === fields.length && fields.every(k => Object.hasOwn(value, k));
const fail = code => ({ok:false, code});
const SHARED = ['worldId','dmRevision','dungeonId','actionRevision',
  'lessonBeatId','applicationRef','skillId','chapterIndex'];
const PROOF = ['schemaVersion','synthetic',...SHARED,'routes'];
const LINK = ['schemaVersion','synthetic',...SHARED,
  'actionKey','baseActionKey','routeBeatId','traceRef','worldFrom','worldTo'];
const ROUTE = ['routeBeatId','traceRef','entrySceneId','goalSceneId',
  'actionKey','baseActionKey','worldFrom','worldTo'];
const validShared = value => SHARED.filter(k => k !== 'actionRevision' && k !== 'chapterIndex')
  .every(k => id(value[k])) && Number.isSafeInteger(value.actionRevision) &&
  value.actionRevision >= 1 && Number.isSafeInteger(value.chapterIndex) &&
  value.chapterIndex >= 0 && value.chapterIndex < 4;

export function validateDmPayoffDualRouteLinks(links, proof) {
  try {
    if (!exact(proof, PROOF) ||
        proof.schemaVersion !== 'dm-payoff-route-reachability-v1' ||
        proof.synthetic !== true || !validShared(proof) ||
        !Array.isArray(proof.routes) || proof.routes.length !== 2 ||
        proof.routes.some(r => !exact(r, ROUTE) || !ROUTE.every(k => id(r[k]))))
      return fail('proof_invalid');
    if (!Array.isArray(links) || links.length !== 2 || links.some(link =>
        !exact(link, LINK) || link.schemaVersion !== 'dm-learning-payoff-v1' ||
        link.synthetic !== true || !validShared(link) ||
        !['actionKey','baseActionKey','routeBeatId','traceRef','worldFrom','worldTo']
          .every(k => id(link[k])))) return fail('links_invalid');
    if (links.some(link => SHARED.some(k => link[k] !== proof[k])))
      return fail('scope_mismatch');
    const routeIds = proof.routes.map(r => r.routeBeatId);
    const linkIds = links.map(link => link.routeBeatId);
    if (new Set(routeIds).size !== 2 || new Set(proof.routes.map(r => r.traceRef)).size !== 2 ||
        new Set(linkIds).size !== 2 || new Set(links.map(link => link.traceRef)).size !== 2 ||
        linkIds.some(key => !routeIds.includes(key)))
      return fail('route_coverage_invalid');
    for (const link of links) {
      const route = proof.routes.find(r => r.routeBeatId === link.routeBeatId);
      if (['traceRef','actionKey','baseActionKey','worldFrom','worldTo']
          .some(k => link[k] !== route[k])) return fail('route_action_mismatch');
    }
    return {ok:true, coveredRoutes:2, matchedLinks:2};
  } catch { return fail('invalid_input'); }
}
