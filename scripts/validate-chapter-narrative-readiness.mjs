/**
 * Spoiler-free, author-side joint narrative preflight for a chapter.
 * Validates scope/route alignment, optional learning opportunities, and
 * timely conditional acknowledgement of story choices in one call.
 * Synthetic graph checks only: not private prose review or import approval.
 */
import {validateChapterProjectionReadiness} from './validate-chapter-projection-readiness.mjs';
import {validateRouteConsequencePacing} from './validate-route-consequence-pacing.mjs';

const fail = code => ({ok:false,code}); // No author-controlled text in diagnostics.

export function validateChapterNarrativeReadiness(input,learningLimits,callbackLimits) {
  const chapter=validateChapterProjectionReadiness(input,learningLimits);
  if(chapter?.ok!==true) return chapter;
  const callbacks=validateRouteConsequencePacing(input.consequence.graph,callbackLimits);
  if(callbacks?.ok!==true) {
    if(callbacks?.code==='callback_too_late') return fail('callback_too_late');
    if(callbacks?.code==='limits_invalid') return fail('callback_limits_invalid');
    return fail('consequence_invalid');
  }
  if(callbacks.branchOutcomeCount!==chapter.branchOutcomeCount)
    return fail('consequence_invalid');
  return {...chapter,latestCallbackBeat:callbacks.latestCallbackBeat};
}
