import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCrossChapterConsequence as check} from '../scripts/validate-cross-chapter-consequence.mjs';
// Invented demo identifiers only; no formal-world secrets or dialogue.
const node=(id,{end=false,exits=[],acknowledges=[]}={})=>({id,end,exits,acknowledges});
const edge=(to,impactKey=null)=>({to,impactKey});
const fixture=()=>({chapters:[
  {id:'demo-one',start:'demo-start',nodes:[
    node('demo-start',{exits:[edge('demo-left','demo-impact-left'),edge('demo-right','demo-impact-right')]}),
    node('demo-left',{exits:[edge('demo-finish')]}),node('demo-right',{exits:[edge('demo-finish')]}),
    node('demo-finish',{end:true})]},
  {id:'demo-two',start:'demo-followup',nodes:[
    node('demo-followup',{acknowledges:['demo-impact-left','demo-impact-right'],exits:[edge('demo-end')]}),
    node('demo-end',{end:true})]}
],deferrals:[
  {impactKey:'demo-impact-left',dueChapterId:'demo-two'},
  {impactKey:'demo-impact-right',dueChapterId:'demo-two'}
]});
const reject=(m,code)=>assert.deepEqual(check(m),{ok:false,code});
test('both deferred outcomes acknowledged in a later chapter',()=>assert.deepEqual(check(fixture()),{ok:true,chapterCount:2,nodeCount:6,deferredOutcomeCount:2}));
test('missing later acknowledgement rejects',()=>{const m=fixture();m.chapters[1].nodes[0].acknowledges=['demo-impact-left'];reject(m,'deferred_callback_missing')});
test('same-chapter callback cannot satisfy a deferral',()=>{const m=fixture();m.chapters[0].nodes[1].acknowledges=['demo-impact-left'];reject(m,'acknowledgement_invalid')});
test('terminal-only acknowledgement is invalid',()=>{const m=fixture();m.chapters[1].nodes[1].acknowledges=['demo-impact-left'];reject(m,'exit_invalid')});
test('callback after due chapter is invalid',()=>{const m=fixture();m.chapters.push({id:'demo-three',start:'demo-third',nodes:[node('demo-third',{acknowledges:['demo-impact-left'],exits:[edge('demo-third-end')]}),node('demo-third-end',{end:true})]});m.chapters[1].nodes[0].acknowledges=['demo-impact-right'];reject(m,'acknowledgement_invalid')});
test('later due chapter may satisfy deferred callback',()=>{const m=fixture();m.chapters.push({id:'demo-three',start:'demo-third',nodes:[node('demo-third',{acknowledges:['demo-impact-left','demo-impact-right'],exits:[edge('demo-third-end')]}),node('demo-third-end',{end:true})]});m.chapters[1].nodes[0].acknowledges=[];m.deferrals.forEach(d=>d.dueChapterId='demo-three');assert.equal(check(m).ok,true)});
test('callback on only one route through due chapter is insufficient',()=>{const m=fixture();m.chapters[1].nodes=[node('demo-followup',{exits:[edge('demo-route-a','demo-later-a'),edge('demo-route-b','demo-later-b')]}),node('demo-route-a',{acknowledges:['demo-impact-left','demo-impact-right'],exits:[edge('demo-end')]}),node('demo-route-b',{exits:[edge('demo-end')]}),node('demo-end',{end:true})];reject(m,'deferred_callback_missing')});
test('callbacks on both later routes satisfy obligation',()=>{const m=fixture();m.chapters[1].nodes=[node('demo-followup',{exits:[edge('demo-route-a','demo-later-a'),edge('demo-route-b','demo-later-b')]}),node('demo-route-a',{acknowledges:['demo-impact-left','demo-impact-right'],exits:[edge('demo-end')]}),node('demo-route-b',{acknowledges:['demo-impact-left','demo-impact-right'],exits:[edge('demo-end')]}),node('demo-end',{end:true})];assert.equal(check(m).ok,true)});
test('unknown deferred key rejects',()=>{const m=fixture();m.deferrals[0].impactKey='demo-absent';reject(m,'deferral_invalid')});
test('unknown callback rejects',()=>{const m=fixture();m.chapters[1].nodes[0].acknowledges.push('demo-unknown');reject(m,'acknowledgement_invalid')});
test('duplicate obligation rejects',()=>{const m=fixture();m.deferrals.push({...m.deferrals[0]});reject(m,'deferral_invalid')});
test('same chapter due date rejects',()=>{const m=fixture();m.deferrals[0].dueChapterId='demo-one';reject(m,'deferral_invalid')});
test('unknown due chapter rejects',()=>{const m=fixture();m.deferrals[0].dueChapterId='demo-never';reject(m,'deferral_invalid')});
test('duplicate impact key rejects',()=>{const m=fixture();m.chapters[0].nodes[0].exits[1].impactKey='demo-impact-left';reject(m,'impact_invalid')});
test('branch cannot omit impact key',()=>{const m=fixture();m.chapters[0].nodes[0].exits[1].impactKey=null;reject(m,'impact_invalid')});
test('linear edge cannot introduce an impact key',()=>{const m=fixture();m.chapters[0].nodes[1].exits[0].impactKey='demo-fake';reject(m,'impact_invalid')});
test('cross-chapter exits are forbidden in author projection',()=>{const m=fixture();m.chapters[0].nodes[1].exits[0].to='demo-followup';reject(m,'edge_invalid')});
test('cycle in a chapter rejects',()=>{const m=fixture();m.chapters[1].nodes[0].exits=[edge('demo-followup')];reject(m,'cycle_invalid')});
test('unreachable node rejects',()=>{const m=fixture();m.chapters[1].nodes.push(node('demo-island',{exits:[edge('demo-end')]}));reject(m,'unreachable_node')});
test('unreviewed runtime gate field rejects',()=>{const m=fixture();m.chapters[1].nodes[0].requiresPractice=true;reject(m,'node_invalid')});
test('unreviewed obligation field rejects',()=>{const m=fixture();m.deferrals[0].secretCondition='demo-value';reject(m,'deferral_invalid')});
test('error codes never echo opaque keys',()=>{const m=fixture();m.chapters[1].nodes[0].acknowledges=[];const out=check(m);assert.deepEqual(out,{ok:false,code:'deferred_callback_missing'});assert.equal(JSON.stringify(out).includes('demo-impact-left'),false)});
test('non-deferred local impacts remain outside this checker scope',()=>{const m=fixture();m.deferrals=[m.deferrals[0]];m.chapters[1].nodes[0].acknowledges=['demo-impact-left'];assert.equal(check(m).ok,true)});
test('empty deferral catalog cannot pass vacuously',()=>{const m=fixture();m.deferrals=[];reject(m,'shape_invalid')});
