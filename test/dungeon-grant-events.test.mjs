import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic author-contract reference, NOT the production event writer.
const registry = Object.freeze({
  'opaque-a': {worldId:'synthetic-world', dungeonId:'synthetic-one', manifestRevision:3, kind:'zeroUnlocked'},
  'opaque-b': {worldId:'synthetic-world', dungeonId:'synthetic-one', manifestRevision:3, kind:'hiddenUnlocked'},
  'opaque-c': {worldId:'synthetic-world', dungeonId:'synthetic-two', manifestRevision:3, kind:'hiddenUnlocked'},
});
const event = (patch={}) => ({eventId:'event-1', source:'world-event-log', committed:true,
  worldId:'synthetic-world', dungeonId:'synthetic-one', manifestRevision:3,
  triggerRef:'opaque-a', kind:'zeroUnlocked', evidenceRefs:['fact-1'],
  eventClass:'narrative-milestone', ...patch});
function grantReducer(events, reg=registry) {
  const seen=new Set(), grants=new Map();
  for (const e of events) {
    if (!e || typeof e.eventId!=='string' || !e.eventId || seen.has(e.eventId)) continue;
    seen.add(e.eventId);
    const r=reg[e.triggerRef];
    if (!r || e.source!=='world-event-log' || e.committed!==true ||
        !Array.isArray(e.evidenceRefs) || e.evidenceRefs.length===0 ||
        e.evidenceRefs.some(x=>typeof x!=='string'||!x) ||
        e.eventClass!=='narrative-milestone' ||
        !['zeroUnlocked','hiddenUnlocked'].includes(e.kind) ||
        ['worldId','dungeonId','manifestRevision','kind'].some(k=>e[k]!==r[k])) continue;
    const key=e.dungeonId+'|'+e.kind;
    if (!grants.has(key)) grants.set(key,{dungeonId:e.dungeonId,kind:e.kind,eventId:e.eventId,triggerRef:e.triggerRef,manifestRevision:e.manifestRevision});
  }
  return grants;
}
const has=(g,d,k)=>g.has(d+'|'+k);
const publicCopy=(g,{dungeonId='synthetic-one',allDone=false}={})=>({
  ...(allDone && has(g,dungeonId,'zeroUnlocked')?{zero:'Approved memory'}:{}),
  ...(has(g,dungeonId,'hiddenUnlocked')?{hidden:'Approved discovery'}:{})
});
test('committed narrative memory milestone grants zero',()=>assert.equal(has(grantReducer([event()]),'synthetic-one','zeroUnlocked'),true));
test('unverified chapters still withhold zero text',()=>assert.deepEqual(publicCopy(grantReducer([event()])),{}));
test('zero text appears after independent chapter completion',()=>assert.equal(publicCopy(grantReducer([event()]),{allDone:true}).zero,'Approved memory'));
test('chapter completion alone never grants zero',()=>assert.deepEqual(publicCopy(grantReducer([]),{allDone:true}),{}));
test('hidden milestone is independent of chapter completion',()=>assert.equal(publicCopy(grantReducer([event({eventId:'event-2',triggerRef:'opaque-b',kind:'hiddenUnlocked'})])).hidden,'Approved discovery'));
test('zero does not imply hidden',()=>assert.equal(publicCopy(grantReducer([event()]),{allDone:true}).hidden,undefined));
test('hidden does not imply zero',()=>assert.equal(publicCopy(grantReducer([event({triggerRef:'opaque-b',kind:'hiddenUnlocked'})]),{allDone:true}).zero,undefined));
test('client and model events cannot grant',()=>{for(const source of ['client','llm','api-request'])assert.equal(grantReducer([event({source})]).size,0)});
test('uncommitted and missing-evidence events cannot grant',()=>{for(const patch of [{committed:false},{evidenceRefs:[]},{evidenceRefs:['']},{evidenceRefs:null}])assert.equal(grantReducer([event(patch)]).size,0)});
test('quiz, skill and scene-view events cannot grant',()=>{for(const eventClass of ['quiz-verified','chapter-complete','skill-award','scene-view'])assert.equal(grantReducer([event({eventClass})]).size,0)});
test('unknown trigger and mismatched kind fail closed',()=>{for(const patch of [{triggerRef:'unknown'},{kind:'hiddenUnlocked'}])assert.equal(grantReducer([event(patch)]).size,0)});
test('world, dungeon and revision mismatch fail closed',()=>{for(const patch of [{worldId:'other'},{dungeonId:'synthetic-two'},{manifestRevision:4}])assert.equal(grantReducer([event(patch)]).size,0)});
test('replay and repeated milestones yield a single durable grant',()=>{const g=grantReducer([event(),event(),event({eventId:'event-3'})]);assert.equal(g.size,1);assert.equal(g.get('synthetic-one|zeroUnlocked').eventId,'event-1')});
test('other dungeon grant never appears in this dungeon',()=>{const g=grantReducer([event({eventId:'event-4',dungeonId:'synthetic-two',triggerRef:'opaque-c',kind:'hiddenUnlocked'})]);assert.equal(publicCopy(g).hidden,undefined);assert.equal(publicCopy(g,{dungeonId:'synthetic-two'}).hidden,'Approved discovery')});
test('two distinct story grants coexist without duplication',()=>{const g=grantReducer([event(),event({eventId:'event-2',triggerRef:'opaque-b',kind:'hiddenUnlocked'})]);assert.equal(g.size,2);assert.deepEqual(publicCopy(g,{allDone:true}),{zero:'Approved memory',hidden:'Approved discovery'})});
test('public projection contains no trigger or evidence metadata',()=>{const s=JSON.stringify(publicCopy(grantReducer([event()]),{allDone:true}));assert.doesNotMatch(s,/opaque|fact-|event-|manifestRevision|triggerRef|evidenceRef/)});
