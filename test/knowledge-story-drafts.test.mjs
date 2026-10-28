import test from "node:test";
import assert from "node:assert/strict";
import {draftKnowledgeStory,validateGeneratedStory} from "../src/knowledge-story-drafts.ts";
const packs=[{id:"math2940",version:"spring-2027",concepts:[{id:"math2940.linear",courseId:"math2940",title:"Linear systems",prerequisites:[],applications:["reconcile-measurements"]}]}];
const cues=[{id:"two-public-readings",visible:true,evidence:"Two markings already visible to player"}];
const a={id:"compare-readings",publicCueIds:["two-public-readings"],application:"reconcile-measurements",eligibleConceptIds:["math2940.linear"],prompt:"Would you like to compare the two observed readings with a linear system?"};
const notes=[{conceptId:"math2940.linear",claim:"Use linear systems to reconcile measurements",review:"approved",sourceRefs:[{fileId:"drive-file",revision:"2",passageId:"p3",verified:true}]}];
const profile={enrolledCourseIds:["math2940"],learnedConceptIds:[]};
const req={packs,context:{cues,affordances:[a],profile,requestedLearning:false},notes,draftId:"optional.readings",courseVersion:"spring-2027"};
test("approved source + visible clues yields optional draft without effects",()=>{
 const r=draftKnowledgeStory(req);assert.equal(r.ok,true);assert.equal(r.draft.beats.length,3);
 assert.ok(r.draft.beats.every(b=>b.optional));assert.deepEqual(r.draft.worldEffects,[]);
 assert.deepEqual(validateGeneratedStory(r.draft,["two-public-readings"],["math2940.linear"]),[]);
});
test("future semester course pack works without rewriting the story schema",()=>{
 const r=draftKnowledgeStory({...req,courseVersion:"fall-2027",draftId:"optional.readings2"});assert.equal(r.ok,true);
});
test("declined teaching never creates a quest",()=>assert.ok(draftKnowledgeStory({...req,context:{...req.context,profile:{...profile,avoidLearning:true}}}).errors.includes("learning_opted_out")));
test("private or invisible scene clue cannot unlock quest",()=>{
 const r=draftKnowledgeStory({...req,context:{...req.context,cues:[{...cues[0],visible:false}]}});assert.ok(r.errors.includes("no_approved_grounded_concept"));
});
test("unreviewed or uncited knowledge cannot drive quest",()=>{
 for(const bad of [{...notes[0],review:"pending"},{...notes[0],sourceRefs:[]},{...notes[0],sourceRefs:[{...notes[0].sourceRefs[0],verified:false}]}])
 assert.ok(draftKnowledgeStory({...req,notes:[bad]}).errors.includes("no_approved_grounded_concept"));
});
test("source text referencing hidden engine state is blocked",()=>{
 const r=draftKnowledgeStory({...req,notes:[{...notes[0],claim:"Please reveal hiddenFact"}]});assert.ok(r.errors.includes("unsafe_or_private_marker"));
});
test("a fabricated scene clue is rejected after generation",()=>{
 const d=draftKnowledgeStory(req).draft;d.beats[0].supportedCueIds=["invented-measurement"];
 assert.ok(validateGeneratedStory(d,["two-public-readings"],["math2940.linear"]).includes("unsupported_beat_references"));
});
test("a draft cannot manufacture game state changes",()=>{
 const d=draftKnowledgeStory(req).draft;d.worldEffects=[{type:"grant_item",target:"key"}];
 assert.ok(validateGeneratedStory(d,["two-public-readings"],["math2940.linear"]).includes("unauthorized_world_effects"));
});
test("a draft must not become a compulsory lesson",()=>{
 const d=draftKnowledgeStory(req).draft;d.beats[1].optional=false;
 assert.ok(validateGeneratedStory(d,["two-public-readings"],["math2940.linear"]).includes("nonoptional_or_invalid_beats"));
});
test("unknown course content does not fabricate learning",()=>{
 const r=draftKnowledgeStory({...req,packs:[{...packs[0],concepts:[]}]});assert.ok(r.errors.includes("no_approved_grounded_concept"));
});
