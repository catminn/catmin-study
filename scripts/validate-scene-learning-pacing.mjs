/**
 * Synthetic, spoiler-free author-side pacing check for a chapter beat DAG.
 * This is not a real-time turn budget, a lesson renderer, or a production gate.
 */
import {validateSceneLearningFlow} from './validate-scene-learning-flow.mjs';

const DEFAULT_LIMITS = Object.freeze({teachBy:3, practiceBy:6});
const fail = code => ({ok:false,code});
const limitsValid = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  Object.keys(x).length === 2 && Object.hasOwn(x,'teachBy') && Object.hasOwn(x,'practiceBy') &&
  [x.teachBy,x.practiceBy].every(n=>Number.isSafeInteger(n) && n>=1 && n<=200);

export function validateSceneLearningPacing(graph, limits = DEFAULT_LIMITS) {
  if (!limitsValid(limits)) return fail('limits_invalid');
  try {
    if (!validateSceneLearningFlow(graph).ok) return fail('graph_invalid');
  } catch { return fail('graph_invalid'); }

  const nodes = new Map(graph.nodes.map(n=>[n.id,n]));
  const indegree = new Map([...nodes.keys()].map(id=>[id,0]));
  for (const n of nodes.values()) for (const to of n.exits)
    indegree.set(to,indegree.get(to)+1);
  const ready = [...nodes.keys()].filter(id=>indegree.get(id)===0);
  const order=[];
  for(let i=0;i<ready.length;i++) {
    const id=ready[i];order.push(id);
    for(const to of nodes.get(id).exits) {
      indegree.set(to,indegree.get(to)-1);
      if(indegree.get(to)===0) ready.push(to);
    }
  }
  // The base graph validator already rejects cycles and unreachable nodes.
  if(order.length!==nodes.size) return fail('graph_invalid');

  // Each map stores the longest path prefix that has NOT yet encountered the
  // corresponding learning opportunity. Max at joins is essential: union/min
  // would hide a late-learning branch behind an earlier one.
  const waitingTeach=new Map([[graph.start,0]]);
  const waitingPractice=new Map([[graph.start,0]]);
  let latestTeachBeat=0, latestPracticeBeat=0;
  for(const id of order) {
    const n=nodes.get(id);
    for(const [waiting,field,update] of [
      [waitingTeach,'teaches',v=>{latestTeachBeat=Math.max(latestTeachBeat,v);} ],
      [waitingPractice,'offers',v=>{latestPracticeBeat=Math.max(latestPracticeBeat,v);} ]
    ]) {
      if(!waiting.has(id)) continue;
      const at=waiting.get(id)+1;
      if(n[field].length>0) update(at);
      else if(n.end) return fail('learning_not_reached');
      else for(const to of n.exits) waiting.set(to,Math.max(waiting.get(to)??-1,at));
    }
  }
  if(!latestTeachBeat || !latestPracticeBeat) return fail('learning_not_reached');
  if(latestTeachBeat>limits.teachBy) return fail('teaching_too_late');
  if(latestPracticeBeat>limits.practiceBy) return fail('practice_too_late');
  return {ok:true,latestTeachBeat,latestPracticeBeat};
}
