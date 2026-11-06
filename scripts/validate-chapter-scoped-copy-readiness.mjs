/**
 * Spoiler-free author-side scope binding for chapter response copy and callback
 * placements. Prevents accidental cross-world/revision/chapter reuse of otherwise
 * structurally valid copy catalogs. Scope labels are author declarations, NOT
 * signatures, trusted approvals, runtime enforcement, or import permission.
 */
import {validateChapterCopyPlacementReadiness} from './validate-chapter-copy-placement-readiness.mjs';

const fail=code=>({ok:false,code}); // Never echo author-controlled values.
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const exact=(x,keys)=>object(x) && Object.keys(x).length===keys.length &&
  keys.every(key=>Object.hasOwn(x,key));
const id=x=>typeof x==='string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const scopeOK=s=>exact(s,['worldId','manifestRevision','chapterId']) &&
  [s.worldId,s.manifestRevision,s.chapterId].every(id);
const same=(a,b)=>a.worldId===b.worldId &&
  a.manifestRevision===b.manifestRevision && a.chapterId===b.chapterId;

export function validateChapterScopedCopyReadiness(input,responseEnvelope,placementEnvelope,
  learningLimits,callbackLimits) {
  try {
    if(!exact(responseEnvelope,['schema','scope','plan']) ||
       responseEnvelope.schema!=='chapter-scoped-response-v1' ||
       !exact(placementEnvelope,['schema','scope','plan']) ||
       placementEnvelope.schema!=='chapter-scoped-placement-v1' ||
       !scopeOK(responseEnvelope.scope) || !scopeOK(placementEnvelope.scope))
      return fail('copy_scope_invalid');
    // Validate all four declared scopes before examining any private copy text.
    const learning=input?.learning?.scope, consequence=input?.consequence?.scope;
    if(!scopeOK(learning) || !scopeOK(consequence)) return fail('input_invalid');
    if(!same(learning,consequence) || !same(learning,responseEnvelope.scope) ||
       !same(learning,placementEnvelope.scope)) return fail('copy_scope_mismatch');
    const result=validateChapterCopyPlacementReadiness(input,responseEnvelope.plan,
      placementEnvelope.plan,learningLimits,callbackLimits);
    if(result?.ok!==true) return result;
    return {...result,copyScopeMatched:true};
  } catch {return fail('copy_scope_invalid');}
}
