/**
 * Synthetic author-side bridge: a DM's optional lesson application must point
 * to an actual optional skill-enhanced world exit for the SAME chapter skill.
 * No real plot, author approval, runtime authority, or private binding here.
 */
import {validateDmBeatFlow} from './validate-dm-beat-flow.mjs';
import {validateDmKnowledgeAlignment} from './validate-dm-knowledge-alignment.mjs';
import {validateSkillActionBindings} from './validate-dungeon-skill-actions.mjs';

const ID=/^[a-z][a-z0-9._-]{0,79}$/;
const isId=x=>typeof x==='string'&&ID.test(x);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const FIELDS=['schemaVersion','synthetic','worldId','dmRevision','dungeonId',
  'actionRevision','lessonBeatId','applicationRef','skillId','chapterIndex',
  'actionKey','baseActionKey','routeBeatId','traceRef','worldFrom','worldTo'];
const exact=x=>object(x)&&Object.keys(x).length===FIELDS.length&&
  FIELDS.every(k=>Object.hasOwn(x,k));
const fail=code=>({ok:false,code});
const valid=x=>exact(x)&&x.schemaVersion==='dm-learning-payoff-v1'&&
  x.synthetic===true&&
  ['worldId','dmRevision','dungeonId','lessonBeatId','applicationRef','skillId',
    'actionKey','baseActionKey','routeBeatId','traceRef','worldFrom','worldTo']
    .every(k=>isId(x[k]))&&
  Number.isSafeInteger(x.actionRevision)&&x.actionRevision>=1&&
  Number.isSafeInteger(x.chapterIndex)&&x.chapterIndex>=0&&x.chapterIndex<4;

export function validateDmLearningPayoff(flow,chapter,alignment,actions,worldGraph,link){
  try {
    if(!valid(link))return fail('link_invalid');
    if(!validateDmBeatFlow(flow).ok)return fail('dm_invalid');
    if(!validateDmKnowledgeAlignment(flow,chapter,alignment).ok)
      return fail('chapter_alignment_invalid');
    if(actions?.scope!=='synthetic-mechanics-only'||
       !validateSkillActionBindings(actions,worldGraph).ok)
      return fail('action_binding_invalid');
    if(flow.worldId!==link.worldId||flow.manifestRevision!==link.dmRevision||
       actions.worldId!==link.worldId||actions.dungeonId!==link.dungeonId||
       actions.manifestRevision!==link.actionRevision)
      return fail('scope_mismatch');
    const lesson=flow.beats.find(b=>b.type==='lesson_offer');
    if(lesson.id!==link.lessonBeatId||lesson.applicationRef!==link.applicationRef)
      return fail('lesson_application_unbound');
    const choice=flow.beats.find(b=>b.type==='choice');
    const route=flow.beats.find(b=>b.id===link.routeBeatId);
    if(route?.type!=='route'||!choice.next.includes(route.id)||
       route.traceRef!==link.traceRef)
      return fail('route_unbound');
    if(alignment.skillId!==link.skillId)return fail('chapter_skill_mismatch');
    const skill=actions.skills.find(s=>s.skillId===link.skillId);
    if(!skill||skill.chapter!==link.chapterIndex)
      return fail('chapter_skill_mismatch');
    const action=actions.bindings.find(b=>b.actionKey===link.actionKey);
    if(!action||action.skillId!==link.skillId||
       action.baseActionKey!==link.baseActionKey||
       action.from!==link.worldFrom||action.to!==link.worldTo)
      return fail('skill_action_unbound');
    return {ok:true,matchedApplications:1};
  }catch{return fail('invalid_input');}
}
