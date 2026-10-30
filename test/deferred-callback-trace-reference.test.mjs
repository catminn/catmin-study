import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredCallbackTraceReference as make} from '../scripts/deferred-callback-trace-reference.mjs';

// Entirely invented synthetic graph. The two branch outcomes must remain exclusive.
const n=(id,end=false,exits=[],acknowledges=[])=>({id,end,exits,acknowledges});
const e=(to,impactKey=null)=>({to,impactKey});
const outline=()=>({chapters:[
  {id:'demo-one',start:'demo-fork',nodes:[
    n('demo-fork',false,[e('demo-left','demo-left-impact'),e('demo-right','demo-right-impact')]),
    n('demo-left',false,[e('demo-end')]),n('demo-right',false,[e('demo-end')]),n('demo-end',true)]},
  {id:'demo-two',start:'demo-callback',nodes:[
    n('demo-callback',false,[e('demo-two-end')],['demo-left-impact','demo-right-impact']),
    n('demo-two-end',true)]}
],deferrals:[{impactKey:'demo-left-impact',dueChapterId:'demo-two'},
  {impactKey:'demo-right-impact',dueChapterId:'demo-two'}]});
const s=(to,commitId,source='server',chapterId='demo-one',fromNodeId='demo-fork')=>({chapterId,fromNodeId,to,commitId,source});
const a=(toChapterId,commitId,source='server',fromChapterId=toChapterId===null?'demo-two':'demo-one')=>({fromChapterId,toChapterId,commitId,source});
const ack=(commitId='demo-delivery',nodeId='demo-callback')=>({chapterId:'demo-two',nodeId,commitId,source:'server'});
const left=()=>{const x=make(outline()).openSession();assert.equal(x.step(s('demo-left','demo-event-one')).ok,true);return x};
const reachTwo=(x,from='demo-left')=>{assert.equal(x.step(s('demo-end','demo-event-two','server','demo-one',from)).ok,true);assert.equal(x.advance(a('demo-two','demo-event-three')).ok,true);return x};
const done=(x)=>{assert.equal(x.step(s('demo-two-end','demo-event-four','server','demo-two','demo-callback')).ok,true);return x};
const reject=(r,code)=>assert.deepEqual(r,{ok:false,code});

test('valid outline accepted, invalid outline fails closed',()=>{
  assert.equal(make(outline()).ok,true);const m=outline();m.chapters[1].nodes[0].acknowledges=[];reject(make(m),'outline_invalid');
});
test('only selected left callback is visible, competing right hidden',()=>{
  const x=reachTwo(left());assert.deepEqual(x.render(),{ok:true,visibleCount:1});x.acknowledge(ack());
  assert.equal(x.snapshot().renderedCount,1);assert.equal(done(x).advance(a(null,'demo-event-five')).finished,true);
});
test('selected right callback visible, left hidden',()=>{
  const x=make(outline()).openSession();x.step(s('demo-right','demo-event-one'));
  reachTwo(x,'demo-right');assert.deepEqual(x.render(),{ok:true,visibleCount:1});x.acknowledge(ack());
  assert.equal(done(x).advance(a(null,'demo-event-five')).ok,true);
});
test('no callback may render before the choice',()=>{
  const x=make(outline()).openSession();assert.deepEqual(x.render(),{ok:true,visibleCount:0});
});
test('missing render at due chapter blocks completion',()=>{
  const x=done(reachTwo(left()));reject(x.advance(a(null,'demo-event-five')),'callback_not_confirmed');
  assert.equal(x.snapshot().finished,false); // failed transition is atomic
  assert.equal(x.render().visibleCount,0); // at terminal: cannot fabricate a callback
});
test('render at callback beat permits later completion',()=>{
  const x=reachTwo(left());x.render();x.acknowledge(ack());done(x);assert.equal(x.advance(a(null,'demo-event-five')).ok,true);
});
test('ASK and preview never mutate cursor or evidence',()=>{
  const x=make(outline()).openSession(),before=x.snapshot();
  assert.deepEqual(x.ask(),{ok:true});assert.deepEqual(x.preview({to:'demo-left'}),{ok:true});
  assert.deepEqual(x.snapshot(),before);
});
test('preview of unavailable target rejects without mutation',()=>{
  const x=make(outline()).openSession(),before=x.snapshot();
  reject(x.preview({to:'demo-two-end'}),'target_invalid');assert.deepEqual(x.snapshot(),before);
});
test('non-server assertion cannot commit an exit',()=>{
  const x=make(outline()).openSession();reject(x.step(s('demo-left','demo-event-one','client')),'untrusted_event');
  assert.equal(x.snapshot().chosenCount,0);
});
test('non-server assertion cannot advance a chapter',()=>{
  const x=left();x.step(s('demo-end','demo-event-two','server','demo-one','demo-left'));
  reject(x.advance(a('demo-two','demo-event-three','client')),'untrusted_event');
  assert.equal(x.snapshot().chapterOrdinal,1);
});
test('duplicate commit is idempotent even after cursor moved',()=>{
  const x=left();assert.deepEqual(x.step(s('demo-left','demo-event-one')),{ok:true,replayed:true});
  assert.equal(x.snapshot().chosenCount,1);
});
test('same event id cannot be reused for a different action',()=>{
  const x=left();reject(x.step(s('demo-end','demo-event-one')),'commit_conflict');
  assert.equal(x.snapshot().atTerminal,false);
});
test('cannot skip a chapter or advance before terminal',()=>{
  const x=left();reject(x.advance(a('demo-two','demo-event-three')),'chapter_not_finished');
  x.step(s('demo-end','demo-event-two','server','demo-one','demo-left'));
  reject(x.advance(a(null,'demo-event-three','server','demo-one')),'chapter_order_invalid');
  assert.equal(x.snapshot().chapterOrdinal,1);
});
test('replayed chapter advance does not advance twice',()=>{
  const x=reachTwo(left());assert.deepEqual(x.advance(a('demo-two','demo-event-three')),
    {ok:true,replayed:true,finished:false});assert.equal(x.snapshot().chapterOrdinal,2);
});
test('separate sessions never share selected impacts or callback renders',()=>{
  const ref=make(outline()),x=ref.openSession(),y=ref.openSession();
  x.step(s('demo-left','demo-event-one'));y.step(s('demo-right','demo-event-one'));
  reachTwo(x);reachTwo(y,'demo-right');x.render();x.acknowledge(ack());
  assert.equal(x.snapshot().renderedCount,1);assert.equal(y.snapshot().renderedCount,0);
  reject(done(y).advance(a(null,'demo-event-five')),'callback_not_confirmed');
});
test('extra action fields and invalid event IDs fail closed',()=>{
  const x=make(outline()).openSession();reject(x.step({...s('demo-left','demo-event-one'),secretGate:true}),'request_invalid');
  reject(x.step(s('demo-left','INVALID')),'request_invalid');
  assert.equal(x.snapshot().chosenCount,0);
});
test('caller mutation after construction cannot rewrite callback eligibility',()=>{
  const m=outline(),ref=make(m);m.chapters[1].nodes[0].acknowledges=[];
  const x=ref.openSession();x.step(s('demo-left','demo-event-one'));reachTwo(x);
  assert.equal(x.render().visibleCount,1);
});
test('completion is terminal and cannot be advanced again with new commit',()=>{
  const x=reachTwo(left());x.render();x.acknowledge(ack());done(x);x.advance(a(null,'demo-event-five'));
  reject(x.advance(a(null,'demo-event-six')),'session_finished');
  reject(x.step(s('demo-left','demo-event-seven')),'session_finished');
});
test('errors never include impact, chapter, or node identifiers',()=>{
  const x=done(reachTwo(left()));const r=x.advance(a(null,'demo-event-five'));
  assert.equal(JSON.stringify(r).includes('demo-'),false);
});

test('stale chapter or scene provenance is rejected without state change',()=>{
  const x=left();const before=x.snapshot();
  reject(x.step(s('demo-end','demo-event-two','server','demo-two','demo-left')),'stale_cursor');
  reject(x.step(s('demo-end','demo-event-two','server','demo-one','demo-right')),'stale_cursor');
  assert.deepEqual(x.snapshot(),before);
});
test('same event id with same destination but different source is a conflict',()=>{
  const x=left();
  reject(x.step(s('demo-left','demo-event-one','server','demo-two','demo-fork')),'commit_conflict');
});
test('chapter advance rejects stale source even when target is next',()=>{
  const x=left();x.step(s('demo-end','demo-event-two','server','demo-one','demo-left'));
  reject(x.advance(a('demo-two','demo-event-three','server','demo-other')),'stale_cursor');
});
