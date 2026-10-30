import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredCallbackTraceReference as make} from '../scripts/deferred-callback-trace-reference.mjs';
const n=(id,end=false,exits=[],acknowledges=[])=>({id,end,exits,acknowledges});
const e=(to,impactKey=null)=>({to,impactKey});
const outline=()=>({chapters:[
  {id:'demo-one',start:'demo-fork',nodes:[n('demo-fork',false,[e('demo-left','demo-left-impact'),e('demo-right','demo-right-impact')]),n('demo-left',false,[e('demo-end')]),n('demo-right',false,[e('demo-end')]),n('demo-end',true)]},
  {id:'demo-two',start:'demo-callback',nodes:[n('demo-callback',false,[e('demo-followup')],['demo-left-impact','demo-right-impact']),n('demo-followup',false,[e('demo-two-end')],['demo-left-impact','demo-right-impact']),n('demo-two-end',true)]}
],deferrals:[{impactKey:'demo-left-impact',dueChapterId:'demo-two'},{impactKey:'demo-right-impact',dueChapterId:'demo-two'}]});
const step=(chapterId,fromNodeId,to,commitId,source='server')=>({chapterId,fromNodeId,to,commitId,source});
const advance=(fromChapterId,toChapterId,commitId)=>({fromChapterId,toChapterId,commitId,source:'server'});
const ack=(nodeId='demo-callback',commitId='demo-ack',source='server',chapterId='demo-two')=>({chapterId,nodeId,commitId,source});
const reject=(r,code)=>assert.deepEqual(r,{ok:false,code});
function session(choice='left'){
 const x=make(outline()).openSession();
 assert.equal(x.step(step('demo-one','demo-fork','demo-'+choice,'demo-c1')).ok,true);
 assert.equal(x.step(step('demo-one','demo-'+choice,'demo-end','demo-c2')).ok,true);
 assert.equal(x.advance(advance('demo-one','demo-two','demo-c3')).ok,true);
 return x;
}
function finish(x){assert.equal(x.step(step('demo-two','demo-callback','demo-followup','demo-c4')).ok,true);assert.equal(x.step(step('demo-two','demo-followup','demo-two-end','demo-c5')).ok,true);return x.advance(advance('demo-two',null,'demo-c6'));}
test('a proposed callback is not automatically confirmed',()=>{const x=session();assert.equal(x.render().visibleCount,1);assert.equal(x.snapshot().renderedCount,0);reject(finish(x),'callback_not_confirmed')});
test('a repeated render remains eligible before confirmation',()=>{const x=session();assert.equal(x.render().visibleCount,1);assert.equal(x.render().visibleCount,1);assert.equal(x.snapshot().renderedCount,0)});
test('a separate confirmation consumes one callback exactly once',()=>{const x=session();x.render();assert.deepEqual(x.acknowledge(ack()),{ok:true,replayed:false});assert.equal(x.render().visibleCount,0);assert.equal(x.snapshot().renderedCount,1);assert.equal(finish(x).finished,true)});
test('acknowledging without an offered callback is rejected',()=>{const x=session();reject(x.acknowledge(ack()),'callback_not_offered');assert.equal(x.snapshot().renderedCount,0)});
test('client assertion cannot acknowledge',()=>{const x=session();x.render();reject(x.acknowledge(ack('demo-callback','demo-ack','client')),'untrusted_event');assert.equal(x.snapshot().renderedCount,0)});
test('wrong scene or chapter cannot acknowledge',()=>{const x=session();x.render();reject(x.acknowledge(ack('demo-followup')),'stale_cursor');reject(x.acknowledge(ack('demo-callback','demo-ack','server','demo-one')),'stale_cursor');assert.equal(x.snapshot().renderedCount,0)});
test('a successful scene transition invalidates an unconfirmed offer',()=>{const x=session();x.render();x.step(step('demo-two','demo-callback','demo-followup','demo-c4'));reject(x.acknowledge(ack()),'stale_cursor');reject(x.acknowledge(ack('demo-followup')),'callback_not_offered');assert.equal(x.render().visibleCount,1)});
test('a later scene can offer and confirm the skipped callback',()=>{const x=session();x.render();x.step(step('demo-two','demo-callback','demo-followup','demo-c4'));x.render();assert.equal(x.acknowledge(ack('demo-followup')).ok,true);x.step(step('demo-two','demo-followup','demo-two-end','demo-c5'));assert.equal(x.advance(advance('demo-two',null,'demo-c6')).finished,true)});
test('exact replay of confirmation is idempotent even after moving cursor',()=>{const x=session();x.render();x.acknowledge(ack());x.step(step('demo-two','demo-callback','demo-followup','demo-c4'));assert.deepEqual(x.acknowledge(ack()),{ok:true,replayed:true});assert.equal(x.snapshot().renderedCount,1)});
test('commit ID reuse for a different action is rejected',()=>{const x=session();x.render();x.acknowledge(ack());reject(x.acknowledge(ack('demo-followup')),'commit_conflict');reject(x.step(step('demo-two','demo-callback','demo-followup','demo-ack')),'commit_conflict')});
test('failed stale transition does not clear an offer',()=>{const x=session();x.render();reject(x.step(step('demo-one','demo-fork','demo-left','demo-bad')),'stale_cursor');assert.equal(x.acknowledge(ack()).ok,true)});
test('ASK and preview do not confirm callbacks',()=>{const x=session();x.render();x.ask();x.preview({to:'demo-followup'});assert.equal(x.snapshot().renderedCount,0);assert.equal(x.render().visibleCount,1)});
test('different sessions cannot share a delivery confirmation',()=>{const x=session(),y=session('right');x.render();x.acknowledge(ack());y.render();assert.equal(y.snapshot().renderedCount,0);assert.equal(y.render().visibleCount,1)});
test('extra fields and malformed IDs fail closed',()=>{const x=session();x.render();reject(x.acknowledge({...ack(),clientProof:'yes'}),'request_invalid');reject(x.acknowledge(ack('demo-callback','UPPER')),'request_invalid');assert.equal(x.snapshot().renderedCount,0)});
test('acknowledgement does not leak author-controlled IDs in result',()=>{const x=session();x.render();assert.equal(JSON.stringify(x.acknowledge(ack())).includes('demo-'),false)});
test('an unchosen route never creates a callback offer',()=>{const x=session('right');assert.equal(x.render().visibleCount,1);x.acknowledge(ack());assert.equal(x.render().visibleCount,0)});
