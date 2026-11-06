/**
 * Spoiler-free author-side copy-placement preflight. Every conditional
 * acknowledgement beat must explicitly bind to its own approved response key.
 * This checks a synthetic author manifest, NOT renderer wiring, human approval,
 * private plot text, or permission to import a formal world.
 */
import {validateChapterPlayerCopyReadiness} from './validate-chapter-player-copy-readiness.mjs';

const fail=code=>({ok:false,code}); // No private text or IDs in diagnostics.
const object=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const exact=(x,keys)=>object(x) && Object.keys(x).length===keys.length &&
  keys.every(k=>Object.hasOwn(x,k));
const id=x=>typeof x==='string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const pair=(sceneId,impactKey)=>JSON.stringify([sceneId,impactKey]);

export function validateChapterCopyPlacementReadiness(input,responsePlan,placementPlan,learningLimits,callbackLimits) {
  const chapter=validateChapterPlayerCopyReadiness(input,responsePlan,learningLimits,callbackLimits);
  if(chapter?.ok!==true) return chapter;
  try {
    if(!exact(placementPlan,['schema','placements']) ||
       placementPlan.schema!=='chapter-copy-placement-v1' ||
       !Array.isArray(placementPlan.placements) || placementPlan.placements.length>2048)
      return fail('copy_placement_invalid');
    const expected=new Set();
    for(const scene of input.consequence.graph.nodes)
      for(const impactKey of scene.acknowledges)
        expected.add(pair(scene.id,impactKey));
    const bound=new Set();
    for(const entry of placementPlan.placements) {
      if(!exact(entry,['sceneId','impactKey','responseKey']) ||
         !id(entry.sceneId) || !id(entry.impactKey) || !id(entry.responseKey) ||
         entry.responseKey!==entry.impactKey)
        return fail('copy_placement_invalid');
      const key=pair(entry.sceneId,entry.impactKey);
      if(!expected.has(key) || bound.has(key)) return fail('copy_placement_invalid');
      bound.add(key);
    }
    if(bound.size!==expected.size) return fail('copy_placement_missing');
    return {...chapter,copyPlacementCount:bound.size};
  } catch {return fail('copy_placement_invalid');}
}
