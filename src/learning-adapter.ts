// Course-agnostic, read-only learning opportunity adapter.
// This module NEVER generates plot facts or changes state. It only proposes
// pedagogical affordances from explicitly authorized public scene observations.
export type Concept = { id:string; courseId:string; title:string; prerequisites:string[]; applications:string[] };
export type CoursePack = { id:string; version:string; concepts:Concept[] };
export type Affordance = { id:string; publicCueIds:string[]; application:string; eligibleConceptIds:string[]; prompt:string };
export type Cue = { id:string; visible:boolean; evidence:string };
export type Candidate = { affordanceId:string; conceptId:string; prompt:string; reason:string };
export type LearningProfile = { enrolledCourseIds:string[]; learnedConceptIds:string[]; optedOutCourseIds?:string[]; avoidLearning?:boolean };
export type Context = { cues:Cue[]; affordances:Affordance[]; profile:LearningProfile; requestedLearning:boolean };
export type AdapterResult = { candidates:Candidate[]; rejected:{affordanceId:string;reason:string}[] };
const ID=/^[a-z][a-z0-9._-]{1,119}$/;
export function validateCoursePacks(packs:CoursePack[]) {
  const errors:string[]=[];const ids=new Set<string>();
  for(const pack of packs) {
    if(!ID.test(pack.id)||!pack.version||!Array.isArray(pack.concepts))errors.push("invalid_pack");
    for(const c of pack.concepts||[]) {
      if(!ID.test(c.id)||ids.has(c.id)||c.courseId!==pack.id||!c.title||!Array.isArray(c.prerequisites)||!Array.isArray(c.applications))errors.push("invalid_concept");
      ids.add(c.id);
    }
  }
  for(const pack of packs) for(const c of pack.concepts||[])
    for(const p of c.prerequisites||[])if(!ids.has(p))errors.push("missing_prerequisite");
  return [...new Set(errors)];
}
export function suggestLearningOpportunities(packs:CoursePack[],ctx:Context):AdapterResult {
  const rejected:AdapterResult["rejected"]=[],candidates:Candidate[]=[];
  if(ctx.profile.avoidLearning&&!ctx.requestedLearning)return {candidates,rejected:[{affordanceId:"*",reason:"player_declined"}]};
  if(validateCoursePacks(packs).length)return {candidates,rejected:[{affordanceId:"*",reason:"invalid_course_packs"}]};
  const concepts=new Map(packs.flatMap(p=>p.concepts.map(c=>[c.id,c] as const)));
  const visible=new Set(ctx.cues.filter(x=>x.visible&&x.evidence.trim()).map(x=>x.id));
  const learned=new Set(ctx.profile.learnedConceptIds);
  const enrolled=new Set(ctx.profile.enrolledCourseIds);
  const optedOut=new Set(ctx.profile.optedOutCourseIds||[]);
  for(const a of ctx.affordances) {
    if(!a.id||!a.application||!a.prompt||!a.publicCueIds.length||!a.eligibleConceptIds.length){rejected.push({affordanceId:a.id,reason:"invalid_affordance"});continue;}
    if(!a.publicCueIds.every(id=>visible.has(id))){rejected.push({affordanceId:a.id,reason:"missing_public_evidence"});continue;}
    const eligible=a.eligibleConceptIds.map(id=>concepts.get(id)).filter((c):c is Concept=>!!c&&c.applications.includes(a.application)&&enrolled.has(c.courseId)&&!optedOut.has(c.courseId)&&c.prerequisites.every(p=>learned.has(p)));
    if(!eligible.length){rejected.push({affordanceId:a.id,reason:"no_eligible_concept"});continue;}
    for(const c of eligible)candidates.push({affordanceId:a.id,conceptId:c.id,prompt:a.prompt,reason:a.application});
  }
  return {candidates,rejected};
}
// Authorized affordances form a soft opportunity, never a mandatory quiz, a
// success/failure judgment, or a grant of mathematical skill evidence.
export function mayOfferPrompt(result:AdapterResult,requestedLearning:boolean,explorationPreferred:boolean) {
  return (requestedLearning||!explorationPreferred)?result.candidates.slice(0,1):[];
}
