import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredCallbackTraceReference as rawMake} from '../scripts/deferred-callback-trace-reference.mjs';
import {legacyCallbackAdapter} from './lib/legacy-callback-adapter.mjs';
const make=legacyCallbackAdapter(rawMake);
const n=(id,end=false,exits=[],acknowledges=[])=>({id,end,exits,acknowledges});
const e=(to,impactKey=null)=>({to,impactKey});
const outline=()=>({chapters:[
  {id:'demo-one',start:'demo-fork',nodes:[n('demo-fork',false,[e('demo-left','demo-left-impact'),e('demo-right','demo-right-impact')]),n('demo-left',false,[e('demo-end')]),n('demo-right',false,[e('demo-end')]),n('demo-end',true)]},
  {id:'demo-two',start:'demo-callback',nodes:[n('demo-callback',false,[e('demo-followup')],['demo-left-impact','demo-right-impact']),n('demo-followup',false,[e('demo-two-end')],['demo-left-impact','demo-right-impact']),n('demo-two-end',true)]}
],deferrals:[{impactKey:'demo-left-impact',dueChapterId:'demo-two'},{impactKey:'demo-right-impact',dueChapterId:'demo-two'}]});
const step=(chapterId,fromNodeId,to,commitId)=>({chapterId,fromNodeId,to,commitId,source:'server'});
const advance=(fromChapterId,toChapterId,commitId)=>({fromChapterId,toChapterId,commitId,source:'server'});
const ack=(nodeId='demo-callback',commitId='demo-ack')=>({chapterId:'demo-two',nodeId,commitId,source:'server'});
function session(choice='left') {
 const x=make(outline()).openSession();
 assert.equal(x.step(step('demo-one','demo-fork',`demo-${choice}`,'demo-c1')).ok,true);
 assert.equal(x.step(step('demo-one',`demo-${choice}`,'demo-end','demo-c2')).ok,true);
 assert.equal(x.advance(advance('demo-one','demo-two','demo-c3')).ok,true);
 return x;
}
const count=x=>x.render().visibleCount;
test('a callback is shown once at the same scene even after repeated renders',()=>{const x=session();assert.equal(count(x),1);assert.equal(count(x),1);x.acknowledge(ack());assert.equal(count(x),0)});
test('a callback is not repeated at a later eligible scene',()=>{const x=session();assert.equal(count(x),1);x.acknowledge(ack());x.step(step('demo-two','demo-callback','demo-followup','demo-c4'));assert.equal(count(x),0)});
test('if the first eligible scene is not rendered, a later eligible scene still shows it once',()=>{const x=session();x.step(step('demo-two','demo-callback','demo-followup','demo-c4'));assert.equal(count(x),1);assert.equal(count(x),1);x.acknowledge(ack('demo-followup'));assert.equal(count(x),0)});
test('renderedCount is stable on repeated renders',()=>{const x=session();count(x);const before=x.snapshot();count(x);assert.deepEqual(x.snapshot(),before)});
test('ASK and preview cannot reset one-shot projection',()=>{const x=session();count(x);x.acknowledge(ack());assert.deepEqual(x.ask(),{ok:true});assert.deepEqual(x.preview({to:'demo-followup'}),{ok:true});assert.equal(count(x),0)});
test('the unchosen route cannot produce another callback',()=>{const x=session('right');assert.equal(count(x),1);x.acknowledge(ack());assert.equal(count(x),0);assert.equal(x.snapshot().renderedCount,1)});
test('independent sessions each have their own one-shot projection',()=>{const x=session(),y=session();assert.equal(count(x),1);x.acknowledge(ack());assert.equal(count(x),0);assert.equal(count(y),1)});
test('chapter completion remains possible after one projection, with no new callback',()=>{const x=session();assert.equal(count(x),1);x.acknowledge(ack());x.step(step('demo-two','demo-callback','demo-followup','demo-c4'));assert.equal(count(x),0);x.step(step('demo-two','demo-followup','demo-two-end','demo-c5'));assert.equal(x.advance(advance('demo-two',null,'demo-c6')).finished,true)});
test('failed stale step does not reset the projection ledger',()=>{const x=session();count(x);x.acknowledge(ack());assert.deepEqual(x.step(step('demo-one','demo-fork','demo-right','demo-c9')),{ok:false,code:'stale_cursor'});assert.equal(count(x),0)});
test('render output never echoes author-controlled identifiers',()=>{const x=session();assert.equal(JSON.stringify(x.render()).includes('demo-'),false)});
