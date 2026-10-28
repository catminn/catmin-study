// Pure, spoiler-safe authoring gate. This layer designs OPTIONAL narrative drafts;
// the world engine remains the only authority for committed scenes/events.
import { suggestLearningOpportunities, type CoursePack, type Context } from "./learning-adapter.ts";
export type SourceRef = { fileId:string; revision:string; passageId:string; verified:boolean };
export type KnowledgeNote = { conceptId:string; sourceRefs:SourceRef[]; claim:string; review:"pending"|"approved"|"rejected" };
export type StoryBeat = { kind:"observe"|"investigate"|"dialogue"|"reflect"; text:string; supportedCueIds:string[]; conceptIds:string[]; optional:boolean };
export type StoryDraft = { id:string; mode:"optional_side_quest"; courseVersion:string; sourceRefs:SourceRef[]; sceneCueIds:string[]; beats:StoryBeat[]; worldEffects:never[]; status:"draft" };
export type StoryRequest = { packs:CoursePack[]; context:Context; notes:KnowledgeNote[]; draftId:string; courseVersion:string };
export type Gate = {ok:boolean; errors:string[]; draft?:StoryDraft};
const noSpoilers=/(?:sceneId|npcSecret|hiddenFact|server_private|ending_locked|内部剧情|隐藏真相|系统密钥|api[_-]?key)/i;
const nonEmpty=(x:unknown)=>typeof x==="string"&&x.trim().length>0;
export function draftKnowledgeStory(req:StoryRequest):Gate {
  const errors:string[]=[];
  if(!/^[a-z][a-z0-9._-]{1,119}$/.test(req.draftId))errors.push("invalid_draft_id");
  if(!nonEmpty(req.courseVersion))errors.push("missing_course_version");
  if(req.context.profile.avoidLearning&&!req.context.requestedLearning)errors.push("learning_opted_out");
  const result=suggestLearningOpportunities(req.packs,req.context);
  const eligible=result.candidates.filter(c=>req.notes.some(n=>n.conceptId===c.conceptId&&n.review==="approved"&&n.sourceRefs.length>0&&n.sourceRefs.every(s=>nonEmpty(s.fileId)&&nonEmpty(s.revision)&&nonEmpty(s.passageId)&&s.verified)));
  if(!eligible.length)errors.push("no_approved_grounded_concept");
  const first=eligible[0];
  const note=req.notes.find(n=>n.conceptId===first?.conceptId&&n.review==="approved");
  if(first&&note&&(noSpoilers.test(first.prompt)||noSpoilers.test(note.claim)))errors.push("unsafe_or_private_marker");
  if(errors.length)return {ok:false,errors};
  const cueIds=req.context.affordances.find(a=>a.id===first.affordanceId)?.publicCueIds||[];
  const draft:StoryDraft={id:req.draftId,mode:"optional_side_quest",courseVersion:req.courseVersion,sourceRefs:note!.sourceRefs.map(x=>({...x})),sceneCueIds:[...cueIds],beats:[
    {kind:"observe",text:"Offer a closer look at the already visible clues; do not add measurements.",supportedCueIds:[...cueIds],conceptIds:[],optional:true},
    {kind:"investigate",text:first.prompt,supportedCueIds:[...cueIds],conceptIds:[first.conceptId],optional:true},
    {kind:"reflect",text:"If the player chooses, invite an explanation; otherwise offer a non-academic path forward.",supportedCueIds:[...cueIds],conceptIds:[first.conceptId],optional:true}
  ],worldEffects:[],status:"draft"};
  return {ok:true,errors:[],draft};
}
export function validateGeneratedStory(draft:StoryDraft, allowedCues:string[],approvedConcepts:string[]):string[] {
  const errors:string[]=[];
  if(draft.mode!=="optional_side_quest"||draft.status!=="draft")errors.push("not_optional_draft");
  if(!Array.isArray(draft.worldEffects)||draft.worldEffects.length)errors.push("unauthorized_world_effects");
  if(!draft.sourceRefs.length||draft.sourceRefs.some(s=>!s.verified||!s.fileId||!s.revision||!s.passageId))errors.push("unverified_sources");
  const cues=new Set(allowedCues),concepts=new Set(approvedConcepts);
  if(!draft.sceneCueIds.length||draft.sceneCueIds.some(c=>!cues.has(c)))errors.push("unsupported_scene_cues");
  if(!draft.beats.length||draft.beats.some(b=>!b.optional||!["observe","investigate","dialogue","reflect"].includes(b.kind)||!nonEmpty(b.text)))errors.push("nonoptional_or_invalid_beats");
  if(draft.beats.some(b=>b.supportedCueIds.some(c=>!cues.has(c))||b.conceptIds.some(c=>!concepts.has(c))))errors.push("unsupported_beat_references");
  if(draft.beats.some(b=>noSpoilers.test(b.text)))errors.push("possible_private_content");
  return [...new Set(errors)];
}
