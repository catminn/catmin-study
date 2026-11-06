import test from "node:test";
import assert from "node:assert/strict";
import {suggestLearningOpportunities,validateCoursePacks,mayOfferPrompt} from "../src/learning-adapter.ts";
const courses=[
 {id:"math1920",version:"1",concepts:[{id:"math1920.gradient",courseId:"math1920",title:"Gradient",prerequisites:[],applications:["infer-slope"]}]},
 {id:"math2940",version:"1",concepts:[{id:"math2940.linear-systems",courseId:"math2940",title:"Linear systems",prerequisites:[],applications:["reconcile-measurements"]},{id:"math2940.eigenvectors",courseId:"math2940",title:"Eigenvectors",prerequisites:["math2940.linear-systems"],applications:["principal-direction"]}]},
 {id:"phys1112",version:"1",concepts:[{id:"phys1112.force",courseId:"phys1112",title:"Force balance",prerequisites:[],applications:["analyze-load"]}]}
];
const cues=[{id:"mapped-slope",visible:true,evidence:"Two public map readings."},{id:"water",visible:true,evidence:"Water flows downhill."},{id:"measurements",visible:true,evidence:"Public measurements disagree."}];
const affords=[
 {id:"terrain",publicCueIds:["mapped-slope","water"],application:"infer-slope",eligibleConceptIds:["math1920.gradient"],prompt:"Compare the mapped slope and visible water flow."},
 {id:"sensors",publicCueIds:["measurements"],application:"reconcile-measurements",eligibleConceptIds:["math2940.linear-systems"],prompt:"Can we reconcile the measurements?"},
 {id:"direction",publicCueIds:["measurements"],application:"principal-direction",eligibleConceptIds:["math2940.eigenvectors"],prompt:"What direction is most stable?"}
];
const run=(profile,override={})=>suggestLearningOpportunities(courses,{cues,affordances:affords,profile,requestedLearning:false,...override});
test("course pack references valid and available without fixed semester",()=>assert.deepEqual(validateCoursePacks(courses),[]));
test("first semester gradient emerges only from visible clues",()=>{const r=run({enrolledCourseIds:["math1920"],learnedConceptIds:[]});assert.deepEqual(r.candidates.map(x=>x.conceptId),["math1920.gradient"]);});
test("new semester linear algebra works without changing story engine",()=>{const r=run({enrolledCourseIds:["math2940"],learnedConceptIds:[]});assert.deepEqual(r.candidates.map(x=>x.conceptId),["math2940.linear-systems"]);});
test("advanced concept needs prerequisites",()=>{const r=run({enrolledCourseIds:["math2940"],learnedConceptIds:["math2940.linear-systems"]});assert.deepEqual(r.candidates.map(x=>x.conceptId),["math2940.linear-systems","math2940.eigenvectors"]);});
test("missing/hidden physical clue cannot create teaching trigger",()=>{const r=run({enrolledCourseIds:["math1920"],learnedConceptIds:[]},{cues:cues.map(x=>x.id==="water"?{...x,visible:false}:x)});assert.equal(r.candidates.length,0);assert.equal(r.rejected[0].reason,"missing_public_evidence");});
test("player declines learning, no prompt",()=>{const r=run({enrolledCourseIds:["math1920"],learnedConceptIds:[],avoidLearning:true});assert.equal(r.candidates.length,0);});
test("learning opt-out not overridden by unrelated course",()=>{const r=run({enrolledCourseIds:["math1920","math2940"],learnedConceptIds:[],optedOutCourseIds:["math1920"]});assert.deepEqual(r.candidates.map(x=>x.conceptId),["math2940.linear-systems"]);});
test("no mandatory interruption while exploring",()=>{const r=run({enrolledCourseIds:["math1920"],learnedConceptIds:[]});assert.equal(mayOfferPrompt(r,false,true).length,0);assert.equal(mayOfferPrompt(r,true,true).length,1);});
test("a scene cue alone never creates a world action or reward",()=>{const r=run({enrolledCourseIds:["math1920"],learnedConceptIds:[]});assert.ok(r.candidates.every(x=>!Object.hasOwn(x,"worldEffects")&&!Object.hasOwn(x,"knowledgeBonus")));});
