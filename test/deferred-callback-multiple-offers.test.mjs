import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredCallbackTraceReference as rawMake} from '../scripts/deferred-callback-trace-reference.mjs';
import {legacyCallbackAdapter} from './lib/legacy-callback-adapter.mjs';
const make=legacyCallbackAdapter(rawMake);

// All data is synthetic. Two independently selected branches create two due callbacks.
const n=(id,end=false,exits=[],acknowledges=[])=>({id,end,exits,acknowledges});
const e=(to,impactKey=null)=>({to,impactKey});
const keys=['demo-a1-impact','demo-a2-impact','demo-b1-impact','demo-b2-impact'];
const outline=()=>({chapters:[
  {id:'demo-one',start:'demo-fork-a',nodes:[
    n('demo-fork-a',false,[e('demo-a1',keys[0]),e('demo-a2',keys[1])]),
    n('demo-a1',false,[e('demo-fork-b')]),n('demo-a2',false,[e('demo-fork-b')]),
    n('demo-fork-b',false,[e('demo-b1',keys[2]),e('demo-b2',keys[3])]),
    n('demo-b1',false,[e('demo-end')]),n('demo-b2',false,[e('demo-end')]),n('demo-end',true)]},
  {id:'demo-two',start:'demo-callback',nodes:[
    n('demo-callback',false,[e('demo-two-end')],keys),n('demo-two-end',true)]}
],deferrals:keys.map(impactKey=>({impactKey,dueChapterId:'demo-two'}))});
const step=(fromNodeId,to,commitId)=>({chapterId:'demo-one',fromNodeId,to,commitId,source:'server'});
const ack=commitId=>({chapterId:'demo-two',nodeId:'demo-callback',commitId,source:'server'});
const advance=(fromChapterId,toChapterId,commitId)=>({fromChapterId,toChapterId,commitId,source:'server'});
const reject=(actual,code)=>assert.deepEqual(actual,{ok:false,code});
function session() {
  const ref=make(outline());
  assert.equal(ref.ok,true);
  const x=ref.openSession();
  for(const action of [
    step('demo-fork-a','demo-a1','demo-c1'),
    step('demo-a1','demo-fork-b','demo-c2'),
    step('demo-fork-b','demo-b2','demo-c3'),
    step('demo-b2','demo-end','demo-c4')])
    assert.equal(x.step(action).ok,true);
  assert.equal(x.advance(advance('demo-one','demo-two','demo-c5')).ok,true);
  return x;
}
const finish=x=>{assert.equal(x.step({chapterId:'demo-two',fromNodeId:'demo-callback',to:'demo-two-end',commitId:'demo-c8',source:'server'}).ok,true);return x.advance(advance('demo-two',null,'demo-c9'));};

test('two independent route choices both create due callback obligations',()=>{
  const x=session();assert.equal(x.snapshot().chosenCount,2);
});
test('one offer represents one callback even when two are eligible',()=>{
  const x=session();assert.deepEqual(x.render(),{ok:true,visibleCount:1});
});
test('repeated proposals do not silently confirm either callback',()=>{
  const x=session();x.render();x.render();assert.equal(x.snapshot().renderedCount,0);
});
test('one confirmation never confirms the second callback',()=>{
  const x=session();x.render();assert.equal(x.acknowledge(ack('demo-c6')).ok,true);
  assert.equal(x.snapshot().renderedCount,1);
});
test('second callback remains eligible after first confirmation',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));
  assert.deepEqual(x.render(),{ok:true,visibleCount:1});
});
test('two distinct acknowledgements can confirm both callbacks',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));
  x.render();assert.equal(x.acknowledge(ack('demo-c7')).ok,true);
  assert.equal(x.snapshot().renderedCount,2);
});
test('all callbacks consumed means no further proposal',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));
  x.render();x.acknowledge(ack('demo-c7'));
  assert.deepEqual(x.render(),{ok:true,visibleCount:0});
});
test('replay of first acknowledgement does not consume the second',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));
  assert.deepEqual(x.acknowledge(ack('demo-c6')),{ok:true,replayed:true});
  assert.equal(x.snapshot().renderedCount,1);
  assert.equal(x.render().visibleCount,1);
});
test('one confirmation is insufficient at due-chapter completion',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));
  reject(finish(x),'callback_not_confirmed');
});
test('both confirmations allow author QA completion',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));
  x.render();x.acknowledge(ack('demo-c7'));
  assert.equal(finish(x).finished,true);
});
test('an unconfirmed second offer is lost on scene transition',()=>{
  const x=session();x.render();x.acknowledge(ack('demo-c6'));x.render();
  reject(finish(x),'callback_not_confirmed');
  reject(x.acknowledge(ack('demo-c7')),'stale_cursor');
});
test('multiple callback offers never reveal private impact identifiers',()=>{
  const x=session();assert.equal(JSON.stringify(x.render()).includes('demo-'),false);
  x.acknowledge(ack('demo-c6'));assert.equal(JSON.stringify(x.render()).includes('demo-'),false);
});
