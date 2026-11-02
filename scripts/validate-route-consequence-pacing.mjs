/**
 * Spoiler-free author-side pacing check for conditional branch callbacks.
 * A route consequence may be correct but arrive so late that the choice feels
 * forgotten. Check the FIRST acknowledgement on EVERY suffix of each choice.
 * No narrative text, private content, runtime gating, or import authorization.
 */
import {validateRouteConsequenceOutline} from './validate-route-consequence-outline.mjs';

const DEFAULT_LIMITS=Object.freeze({callbackBy:6});
const fail=code=>({ok:false,code}); // Do not echo author-controlled keys or IDs.
const limitsOK=x=>x!==null && typeof x==='object' && !Array.isArray(x) &&
  Object.keys(x).length===1 && Object.hasOwn(x,'callbackBy') &&
  Number.isSafeInteger(x.callbackBy) && x.callbackBy>=1 && x.callbackBy<=200;

export function validateRouteConsequencePacing(graph,limits=DEFAULT_LIMITS) {
  if(!limitsOK(limits)) return fail('limits_invalid');
  let base;
  try {base=validateRouteConsequenceOutline(graph);}
  catch {return fail('graph_invalid');}
  if(base?.ok!==true) return fail('graph_invalid');

  // The base validator has already bounded and checked this finite DAG.
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
  const indegree=new Map([...nodes.keys()].map(id=>[id,0]));
  for(const n of nodes.values()) for(const edge of n.exits)
    indegree.set(edge.to,indegree.get(edge.to)+1);
  const ready=[...nodes.keys()].filter(id=>indegree.get(id)===0);
  const order=[];
  for(let i=0;i<ready.length;i++) {
    const id=ready[i];order.push(id);
    for(const edge of nodes.get(id).exits) {
      indegree.set(edge.to,indegree.get(edge.to)-1);
      if(indegree.get(edge.to)===0) ready.push(edge.to);
    }
  }
  if(order.length!==nodes.size) return fail('graph_invalid');

  let latestCallbackBeat=0;
  for(const node of nodes.values()) if(node.exits.length>1) for(const edge of node.exits) {
    const key=edge.impactKey;
    const latest=new Map();
    for(const id of [...order].reverse()) {
      const beat=nodes.get(id);
      if(beat.acknowledges.includes(key)) latest.set(id,1);
      else if(beat.end) latest.set(id,Infinity);
      else latest.set(id,1+Math.max(...beat.exits.map(e=>latest.get(e.to))));
    }
    const distance=latest.get(edge.to);
    // Base validation guarantees a callback on every suffix, so infinity
    // here is an invariant failure, not an author-controlled diagnostic.
    if(!Number.isFinite(distance)) return fail('graph_invalid');
    latestCallbackBeat=Math.max(latestCallbackBeat,distance);
  }
  if(latestCallbackBeat>limits.callbackBy) return fail('callback_too_late');
  return {ok:true,branchOutcomeCount:base.branchOutcomeCount,latestCallbackBeat};
}
