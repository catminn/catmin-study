/**
 * Spoiler-free, author-side chapter preflight. Two independently authored
 * projections must name the same world/revision/chapter, describe the same
 * route graph, and place learning opportunities early on EVERY story path.
 * This does not authenticate a scope, review private prose, or authorize import.
 */
import {validateRouteLearningAlignment} from './validate-route-learning-alignment.mjs';
import {validateSceneLearningPacing} from './validate-scene-learning-pacing.mjs';

const fail = code => ({ok:false,code}); // Never echo author-controlled identifiers.
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x,keys) => object(x) && Object.keys(x).length === keys.length &&
  keys.every(key => Object.hasOwn(x,key));
const id = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const scopeOK = s => exact(s,['worldId','manifestRevision','chapterId']) &&
  [s.worldId,s.manifestRevision,s.chapterId].every(id);

export function validateChapterProjectionReadiness(input,limits) {
  try {
    if (!exact(input,['learning','consequence']) ||
        !exact(input.learning,['scope','graph']) ||
        !exact(input.consequence,['scope','graph'])) return fail('input_invalid');
    const a=input.learning.scope,b=input.consequence.scope;
    if (!scopeOK(a) || !scopeOK(b)) return fail('scope_invalid');
    if (a.worldId!==b.worldId || a.manifestRevision!==b.manifestRevision ||
        a.chapterId!==b.chapterId) return fail('scope_mismatch');

    const alignment=validateRouteLearningAlignment(input.learning.graph,input.consequence.graph);
    if (alignment?.ok!==true)
      return fail(alignment?.code==='projection_mismatch'?'route_mismatch':'projection_invalid');
    const pacing=validateSceneLearningPacing(input.learning.graph,limits);
    if (pacing?.ok!==true) {
      const code=pacing?.code;
      return fail(['teaching_too_late','practice_too_late','learning_not_reached',
        'limits_invalid'].includes(code)?code:'pacing_invalid');
    }
    return {ok:true,nodeCount:alignment.nodeCount,practiceCount:alignment.practiceCount,
      branchOutcomeCount:alignment.branchOutcomeCount,
      latestTeachBeat:pacing.latestTeachBeat,latestPracticeBeat:pacing.latestPracticeBeat};
  } catch { return fail('input_invalid'); }
}
