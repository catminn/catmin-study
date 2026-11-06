/**
 * Spoiler-free author-side consistency check for two independently reviewed
 * chapter outlines. This is NOT a runtime importer, engine, or content approval.
 */
import {validateSceneLearningFlow} from './validate-scene-learning-flow.mjs';
import {validateRouteConsequenceOutline} from './validate-route-consequence-outline.mjs';

const fail = code => ({ok:false,code}); // Never echo author-controlled IDs.

export function validateRouteLearningAlignment(learning, consequence) {
  let learningResult, consequenceResult;
  try { learningResult = validateSceneLearningFlow(learning); }
  catch { return fail('learning_invalid'); }
  if (!learningResult?.ok) return fail('learning_invalid');
  try { consequenceResult = validateRouteConsequenceOutline(consequence); }
  catch { return fail('consequence_invalid'); }
  if (!consequenceResult?.ok) return fail('consequence_invalid');

  if (learning.start !== consequence.start || learning.nodes.length !== consequence.nodes.length)
    return fail('projection_mismatch');
  const consequences = new Map(consequence.nodes.map(n => [n.id,n]));
  for (const beat of learning.nodes) {
    const counterpart = consequences.get(beat.id);
    if (!counterpart || beat.end !== counterpart.end ||
        beat.exits.length !== counterpart.exits.length) return fail('projection_mismatch');
    // Ordering is editorial, not a route change. Each base validator has
    // already rejected duplicate destinations within its own projection.
    const learningTargets = [...beat.exits].sort();
    const consequenceTargets = counterpart.exits.map(e => e.to).sort();
    if (learningTargets.some((to,i) => to !== consequenceTargets[i]))
      return fail('projection_mismatch');
  }
  return {ok:true,nodeCount:learningResult.nodeCount,
    practiceCount:learningResult.practiceCount,
    branchOutcomeCount:consequenceResult.branchOutcomeCount};
}
