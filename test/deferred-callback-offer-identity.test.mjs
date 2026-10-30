import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredCallbackTraceReference as make} from '../scripts/deferred-callback-trace-reference.mjs';
// Entirely synthetic, spoiler-free author QA.
const n=(id,end=false,exits=[],acknowledges=[])=>({id,end,exits,acknowledges});
const e=(to,impactKey=null)=>({to,impactKey});
const keys=['demo-left-impact','demo-right-impact','demo-up-impact','demo-down-impact'];
const outline=()=>({chapters:[
 {id:'demo-one',start:'demo-first',nodes:[
 n('demo-first',false,[e('demo-left',keys[0]),e('demo-right',keys[1])]),
 n('demo-left',false,[e('demo-second')]),n('demo-right',false,[e('demo-second')]),
 n('demo-second',false,[e('demo-up',keys[2]),e('demo-down',keys[3])]),
 n('demo-up',false,[e('demo-end')]),n('demo-down',false,[e('demo-end')]),n('demo-end',true)]},
 {id:'demo-two',start:'demo-callback',nodes:[n('demo-callback',false,[e('demo-final')],keys),n('demo-final',true)]}
],deferrals:keys.map(impactKey=>({impactKey,dueChapterId:'demo-two'}))});
const step=(fromNodeId,to,commitId)=>({chapterId:'demo-one',fromNodeId,to,commitId,source:'server'});
const ack=(offerId,commitId)=>({chapterId:'demo-two',nodeId:'demo-callback',commitId,source:'server',offerId});
const reject=(r,code)=>assert.deepEqual(r,{ok:false,code});
function session(){
 const x=make(outline()).openSession();
 for(const s of [step('demo-first','demo-left','demo-c1'),step('demo-left','demo-second','demo-c2'),
 step('demo-second','demo-down','demo-c3'),step('demo-down','demo-end','demo-c4')])
 assert.equal(x.step(s).ok,true);
 assert.equal(x.advance({fromChapterId:'demo-one',toChapterId:'demo-two',commitId:'demo-c5',source:'server'}).ok,true);
 return x;
}
test('generated offer token contains no author identifiers',()=>{
 const x=session(),r=x.render();assert.equal(r.visibleCount,1);
 assert.equal(/^offer-[0-9]+-[0-9]+$/.test(r.offerId),true);
 assert.equal(JSON.stringify(r).includes('demo-'),false);
});
test('repeated proposal keeps the same offer identity',()=>{
 const x=session();assert.deepEqual(x.render(),x.render());
});
test('missing token fails closed',()=>{
 const x=session();x.render();reject(x.acknowledge({chapterId:'demo-two',nodeId:'demo-callback',commitId:'demo-c6',source:'server'}),'request_invalid');
});
test('fabricated and malformed tokens fail closed',()=>{
 const x=session();x.render();reject(x.acknowledge(ack('offer-fake','demo-c6')),'callback_not_offered');
 reject(x.acknowledge(ack('INVALID','demo-c7')),'request_invalid');
});
test('two independent callbacks receive distinct tokens',()=>{
 const x=session(),a=x.render();assert.equal(x.acknowledge(ack(a.offerId,'demo-c6')).ok,true);
 const b=x.render();assert.equal(b.visibleCount,1);assert.equal(a.offerId!==b.offerId,true);
});
test('delayed duplicate confirmation with new commit cannot consume second callback',()=>{
 const x=session(),a=x.render();x.acknowledge(ack(a.offerId,'demo-c6'));const b=x.render();
 reject(x.acknowledge(ack(a.offerId,'demo-c7')),'callback_not_offered');
 assert.equal(x.snapshot().renderedCount,1);assert.deepEqual(x.render(),b);
});
test('correct second token confirms second callback independently',()=>{
 const x=session(),a=x.render();x.acknowledge(ack(a.offerId,'demo-c6'));
 const b=x.render();assert.equal(x.acknowledge(ack(b.offerId,'demo-c7')).ok,true);
 assert.equal(x.snapshot().renderedCount,2);
});
test('exact replay of first confirmation cannot consume second',()=>{
 const x=session(),a=x.render();x.acknowledge(ack(a.offerId,'demo-c6'));const b=x.render();
 assert.deepEqual(x.acknowledge(ack(a.offerId,'demo-c6')),{ok:true,replayed:true});
 assert.deepEqual(x.render(),b);assert.equal(x.snapshot().renderedCount,1);
});
test('same commit reused with a different token is a conflict',()=>{
 const x=session(),a=x.render();x.acknowledge(ack(a.offerId,'demo-c6'));const b=x.render();
 reject(x.acknowledge(ack(b.offerId,'demo-c6')),'commit_conflict');
});
test('two sessions have different offer tokens',()=>{
 const ref=make(outline()),x=ref.openSession(),y=ref.openSession();
 for(const z of [x,y]){
 for(const s of [step('demo-first','demo-left','demo-c1'),step('demo-left','demo-second','demo-c2'),step('demo-second','demo-down','demo-c3'),step('demo-down','demo-end','demo-c4')])z.step(s);
 z.advance({fromChapterId:'demo-one',toChapterId:'demo-two',commitId:'demo-c5',source:'server'});
 }
 const a=x.render(),b=y.render();assert.equal(a.offerId!==b.offerId,true);
 reject(y.acknowledge(ack(a.offerId,'demo-c6')),'callback_not_offered');
 assert.equal(y.acknowledge(ack(b.offerId,'demo-c6')).ok,true);
});
test('scene transition invalidates unconfirmed offer',()=>{
 const x=session(),a=x.render();
 x.step({chapterId:'demo-two',fromNodeId:'demo-callback',to:'demo-final',commitId:'demo-c8',source:'server'});
 reject(x.acknowledge(ack(a.offerId,'demo-c9')),'stale_cursor');
});
test('no callback before choice returns null token',()=>{
 const x=make(outline()).openSession();assert.deepEqual(x.render(),{ok:true,visibleCount:0,offerId:null});
});
