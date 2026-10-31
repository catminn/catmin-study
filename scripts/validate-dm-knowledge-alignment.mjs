/**
 * Synthetic DM lesson -> chapter skill/practice alignment preflight.
 * No story text, real identities, author approval or runtime authority.
 */
import {validateDmBeatFlow} from './validate-dm-beat-flow.mjs';
import {validateSceneLearningFlow} from './validate-scene-learning-flow.mjs';
import {validateSceneLearningPacing} from './validate-scene-learning-pacing.mjs';

const ID=/^[a-z][a-z0-9._-]{0,79}$/;
const isId=x=>typeof x==='string'&&ID.test(x);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>({ok:false,code});
const KEYS=['schemaVersion','synthetic','worldId','manifestRevision','lessonBeatId','conceptId','skillId','practiceIds'];
const validBinding=b=>obj(b)&&Object.keys(b).length===KEYS.length&&
  KEYS.every(k=>Object.hasOwn(b,k))&&b.schemaVersion==='dm-knowledge-alignment-v1'&&
  b.synthetic===true&&
  [b.worldId,b.manifestRevision,b.lessonBeatId,b.conceptId,b.skillId].every(isId)&&
  Array.isArray(b.practiceIds)&&b.practiceIds.length>0&&b.practiceIds.length<=20&&
  b.practiceIds.every(isId)&&new Set(b.practiceIds).size===b.practiceIds.length;

// Maximum FIRST occurrence along each path, not maximum occurrence overall.
// Missing paths must fail even when another branch offers the target early.
function targetFirstBeat(graph,field,qualifies) {
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
  const indegree=new Map([...nodes.keys()].map(id=>[id,0]));
  for(const n of nodes.values())for(const to of n.exits)indegree.set(to,indegree.get(to)+1);
  const order=[...nodes.keys()].filter(id=>indegree.get(id)===0);
  for(let i=0;i<order.length;i++){
    for(const to of nodes.get(order[i]).exits){
      indegree.set(to,indegree.get(to)-1);
      if(indegree.get(to)===0)order.push(to);
    }
  }
  const waiting=new Map([[graph.start,0]]);
  let latest=0,missing=false;
  for(const id of order){
    if(!waiting.has(id))continue;
    const n=nodes.get(id),at=waiting.get(id)+1;
    if(!n.end&&n[field].some(qualifies))latest=Math.max(latest,at);
    else if(n.end)missing=true;
    else for(const to of n.exits)waiting.set(to,Math.max(waiting.get(to)??-1,at));
  }
  return {latest,missing:missing||latest===0};
}

export function validateDmKnowledgeAlignment(flow,chapter,binding,limits={teachBy:3,practiceBy:6}) {
  try {
    if(!validateDmBeatFlow(flow).ok)return fail('dm_invalid');
    if(!validateSceneLearningFlow(chapter).ok)return fail('chapter_invalid');
    const pace=validateSceneLearningPacing(chapter,limits);
    if(!pace.ok)return fail(pace.code==='limits_invalid'?'limits_invalid':'chapter_pacing_invalid');
    if(!validBinding(binding))return fail('binding_invalid');
    if(binding.worldId!==flow.worldId||binding.manifestRevision!==flow.manifestRevision)
      return fail('scope_mismatch');
    const lesson=flow.beats.find(b=>b.type==='lesson_offer');
    if(lesson.id!==binding.lessonBeatId||lesson.conceptId!==binding.conceptId)
      return fail('lesson_unbound');
    const catalog=new Map(chapter.practices.map(p=>[p.id,p.skillId]));
    if(!chapter.skills.includes(binding.skillId)||
       binding.practiceIds.some(id=>catalog.get(id)!==binding.skillId))
      return fail('target_catalog_mismatch');
    const teach=targetFirstBeat(chapter,'teaches',id=>id===binding.skillId);
    const targetCards=new Set(binding.practiceIds);
    const practice=targetFirstBeat(chapter,'offers',id=>targetCards.has(id));
    if(teach.missing)return fail('target_teaching_missing');
    if(practice.missing)return fail('target_practice_missing');
    if(teach.latest>limits.teachBy)return fail('target_teaching_too_late');
    if(practice.latest>limits.practiceBy)return fail('target_practice_too_late');
    return {ok:true,latestTargetTeachBeat:teach.latest,latestTargetPracticeBeat:practice.latest};
  } catch {return fail('invalid_input');}
}
