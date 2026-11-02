/**
 * Spoiler-free author-side chapter preflight for player-facing route responses.
 * Combines scoped story/learning/callback timing with approved, visibly
 * distinguishable response copy for every authored branch outcome.
 *
 * This only checks synthetic author contracts. It is not an approval sidecar,
 * private prose review, runtime projection, or permission to import.
 */
import {validateChapterNarrativeReadiness} from './validate-chapter-narrative-readiness.mjs';
import {validateRouteResponseDifferentiation} from './validate-route-response-differentiation.mjs';

const fail = code => ({ok:false,code}); // Never return copy or author-controlled IDs.

export function validateChapterPlayerCopyReadiness(input,responsePlan,learningLimits,callbackLimits) {
  const chapter=validateChapterNarrativeReadiness(input,learningLimits,callbackLimits);
  if(chapter?.ok!==true) return chapter;
  let copy;
  try {
    copy=validateRouteResponseDifferentiation(input.consequence.graph,responsePlan);
  } catch {
    return fail('public_copy_invalid');
  }
  if(copy?.ok!==true) {
    if(copy?.code==='response_indistinct') return fail('response_indistinct');
    if(copy?.code==='response_unapproved') return fail('response_unapproved');
    if(copy?.code==='response_missing') return fail('response_missing');
    return fail('public_copy_invalid');
  }
  if(copy.copyCount!==chapter.branchOutcomeCount) return fail('public_copy_invalid');
  return {...chapter,approvedResponseCount:copy.copyCount,branchChoiceCount:copy.branchCount};
}
