import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest, initialState, validateState, applySyntheticAction } from '../scripts/validate-study-story-isolation.mjs';

const m = JSON.parse(readFileSync(new URL('./fixtures/study-story-isolation-synthetic-v1.json', import.meta.url), 'utf8'));
const clone = x => structuredClone(x);
const run = (s, a, manifest=m) => applySyntheticAction(manifest, s, a);
const study = (type, extra={}) => ({mode:'study', type, ...extra});
const story = (type, extra={}) => ({mode:'story', type, ...extra});
const baseline = () => initialState(m);
const success = r => { assert.equal(r.ok, true, r.code); return r.state; };
const fail = (r, code) => { assert.equal(r.ok, false); assert.equal(r.code, code); assert.deepEqual(Object.keys(r).sort(), ['code','ok']); };
const chapter = i => m.chapters[i].id;
const enter = (s,i) => success(run(s,story('enter',{chapterId:chapter(i)})));
const commit = (s,i,event=`demo.event.${i}`) => success(run(s,story('commit',{chapterId:chapter(i),eventId:event,source:'trusted-demo'})));

test('valid synthetic manifest',()=>assert.deepEqual(validateManifest(m),{ok:true,codes:[],errorCount:0}));
test('initial state validates',()=>assert.equal(validateState(m,baseline()),true));
for(const [name,edit,code] of [
  ['unexpected private field',x=>{x.secret='demo.no';},'MANIFEST_SHAPE'],
  ['non-demo world ref',x=>{x.worldId='real-world';},'MANIFEST_SHAPE'],
  ['duplicate chapter ID',x=>{x.chapters[1].id=x.chapters[0].id;},'DUPLICATE_OR_BAD_ID'],
  ['broken predecessor',x=>{x.chapters[1].predecessor=null;},'STORY_CHAIN'],
  ['missing study dungeon',x=>{x.chapters[0].dungeonId='demo.absent';},'CHAPTER_SHAPE'],
  ['reused practice',x=>{x.dungeons[1].practiceId=x.dungeons[0].practiceId;},'PRACTICE_REUSE'],
  ['reused story entry',x=>{x.chapters[1].storyEntry=x.chapters[0].storyEntry;},'CHAPTER_REF_REUSE'],
  ['reused copy slot',x=>{x.chapters[1].publicCopySlot=x.chapters[0].publicCopySlot;},'CHAPTER_REF_REUSE'],
  ['prose leak in chapter',x=>{x.chapters[0].dialogue='secret answer';},'CHAPTER_SHAPE'],
  ['prose leak in dungeon',x=>{x.dungeons[0].hiddenAnswer='secret';},'DUNGEON_SHAPE']
]) test(`reject manifest: ${name}`,()=>{const x=clone(m);edit(x);assert.ok(validateManifest(x).codes.includes(code));});

test('study can select future chapter dungeon without advancing frontier',()=>{
  const s=baseline();const n=success(run(s,study('select',{dungeonId:m.dungeons[2].id})));
  assert.equal(n.studySelection,m.dungeons[2].id);assert.equal(n.frontier,chapter(0));assert.deepEqual(n.committedEvents,[]);assert.equal(s.studySelection,null);
});
test('study can switch between unrelated subjects',()=>{
  let s=baseline();for(const d of m.dungeons) s=success(run(s,study('select',{dungeonId:d.id})));
  assert.equal(s.studySelection,m.dungeons[2].id);assert.deepEqual(s.studyVisits,m.dungeons.map(d=>d.id));assert.equal(s.frontier,chapter(0));
});
test('revisiting study dungeon is idempotent',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[0].id})));
  s=success(run(s,study('select',{dungeonId:m.dungeons[0].id})));
  assert.deepEqual(s.studyVisits,[m.dungeons[0].id]);
});
test('unrecognized study dungeon is rejected',()=>fail(run(baseline(),study('select',{dungeonId:'demo.dungeon.unknown'})),'STUDY_UNKNOWN'));
test('practice cannot verify without selecting its dungeon',()=>fail(run(baseline(),study('practice_verified',{practiceId:m.dungeons[0].practiceId,source:'trusted-demo'})),'EVIDENCE_NOT_VERIFIED'));
test('practice cannot verify with wrong course',()=>{
  const s=success(run(baseline(),study('select',{dungeonId:m.dungeons[0].id})));
  fail(run(s,study('practice_verified',{practiceId:m.dungeons[1].practiceId,source:'trusted-demo'})),'EVIDENCE_NOT_VERIFIED');
});
test('practice cannot verify without synthetic trusted assertion',()=>{
  const s=success(run(baseline(),study('select',{dungeonId:m.dungeons[0].id})));
  fail(run(s,study('practice_verified',{practiceId:m.dungeons[0].practiceId})),'EVIDENCE_NOT_VERIFIED');
});
test('practice can record synthetic verified evidence without moving saga',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[1].id})));
  s=success(run(s,study('practice_verified',{practiceId:m.dungeons[1].practiceId,source:'trusted-demo'})));
  assert.deepEqual(s.verifiedPractices,[m.dungeons[1].practiceId]);assert.equal(s.frontier,chapter(0));assert.equal(s.storyCursor,null);
});
test('practice retry does not double grant',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[0].id})));
  const a=study('practice_verified',{practiceId:m.dungeons[0].practiceId,source:'trusted-demo'});
  s=success(run(s,a));s=success(run(s,a));assert.deepEqual(s.verifiedPractices,[m.dungeons[0].practiceId]);
});
test('exiting study does not enter story',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[2].id})));
  s=success(run(s,study('exit')));assert.equal(s.studySelection,null);assert.equal(s.storyCursor,null);assert.equal(s.frontier,chapter(0));
});
for(const type of ['ask','preview']) test(`${type} on current frontier is strictly read-only`,()=>{
  const s=baseline();const n=success(run(s,story(type,{chapterId:chapter(0)})));assert.deepEqual(n,s);assert.notEqual(n,s);
});
test('unscoped ASK remains read-only',()=>{
  const s=baseline();const n=success(run(s,story('ask')));assert.deepEqual(n,s);
});
for(const type of ['ask','preview']) test(`${type} cannot target a future story chapter`,()=>{
  fail(run(baseline(),story(type,{chapterId:chapter(2)})),'STORY_LOCKED');
});
test('preview requires an explicit current chapter',()=>fail(run(baseline(),story('preview')),'STORY_LOCKED'));
test('old chapter preview is denied after advancing',()=>{
  const s=commit(enter(baseline(),0),0);
  fail(run(s,story('preview',{chapterId:chapter(0)})),'STORY_LOCKED');
});
test('completed story cannot preview a chapter',()=>{
  let s=baseline();for(let i=0;i<m.chapters.length;i++)s=commit(enter(s,i),i);
  fail(run(s,story('preview',{chapterId:chapter(2)})),'STORY_LOCKED');
  assert.deepEqual(success(run(s,story('ask'))),s);
});
test('cannot enter chapter 2 before chapter 1 committed',()=>fail(run(baseline(),story('enter',{chapterId:chapter(1)})),'STORY_LOCKED'));
test('cannot commit chapter without entering it',()=>fail(run(baseline(),story('commit',{chapterId:chapter(0),eventId:'demo.event.one',source:'trusted-demo'})),'COMMIT_NOT_VERIFIED'));
test('cannot commit without authoritative synthetic event',()=>{
  const s=enter(baseline(),0);fail(run(s,story('commit',{chapterId:chapter(0),eventId:'demo.event.one'})),'COMMIT_NOT_VERIFIED');
});
test('cannot commit with non-demo event ref',()=>{
  const s=enter(baseline(),0);fail(run(s,story('commit',{chapterId:chapter(0),eventId:'private-secret',source:'trusted-demo'})),'COMMIT_NOT_VERIFIED');
});
test('committed chapter advances frontier once',()=>{
  const s=commit(enter(baseline(),0),0);assert.equal(s.frontier,chapter(1));assert.deepEqual(s.committedChapters,[chapter(0)]);assert.deepEqual(s.committedEvents,['demo.event.0']);
});
test('cannot replay chapter commit as a second progression',()=>{
  const s=commit(enter(baseline(),0),0);fail(run(s,story('commit',{chapterId:chapter(0),eventId:'demo.event.0',source:'trusted-demo'})),'STORY_LOCKED');
});
test('cannot reuse committed event ID for later chapter',()=>{
  let s=commit(enter(baseline(),0),0);s=enter(s,1);
  fail(run(s,story('commit',{chapterId:chapter(1),eventId:'demo.event.0',source:'trusted-demo'})),'EVENT_REPLAY_SCOPE');
});
test('completing study before story does not bypass story order',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[2].id})));
  s=success(run(s,study('practice_verified',{practiceId:m.dungeons[2].practiceId,source:'trusted-demo'})));
  fail(run(s,story('enter',{chapterId:chapter(2)})),'STORY_LOCKED');
});
test('story progression preserves verified learning evidence',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[2].id})));
  s=success(run(s,study('practice_verified',{practiceId:m.dungeons[2].practiceId,source:'trusted-demo'})));
  s=commit(enter(s,0),0);assert.deepEqual(s.verifiedPractices,[m.dungeons[2].practiceId]);
});
test('study selection persists while story progresses',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[1].id})));
  s=commit(enter(s,0),0);assert.equal(s.studySelection,m.dungeons[1].id);
});
test('all story chapters require individual commits',()=>{
  let s=baseline();for(let i=0;i<m.chapters.length;i++)s=commit(enter(s,i),i);
  assert.equal(s.frontier,null);assert.equal(s.committedChapters.length,3);assert.equal(s.storyCursor,null);
});
test('study remains available after story terminal state',()=>{
  let s=baseline();for(let i=0;i<m.chapters.length;i++)s=commit(enter(s,i),i);
  s=success(run(s,study('select',{dungeonId:m.dungeons[0].id})));assert.equal(s.frontier,null);assert.equal(s.studySelection,m.dungeons[0].id);
});
test('study cannot enter a story chapter via type confusion',()=>fail(run(baseline(),study('enter',{chapterId:chapter(0)})),'MODE_ACTION_INVALID'));
test('story cannot select a study dungeon via type confusion',()=>fail(run(baseline(),story('select',{dungeonId:m.dungeons[0].id})),'MODE_ACTION_INVALID'));
test('unknown mode fails closed',()=>fail(run(baseline(),{mode:'admin',type:'commit'}),'MODE_INVALID'));
test('unknown action fields cannot smuggle hidden content',()=>fail(run(baseline(),{mode:'study',type:'exit',hiddenFact:'demo.secret'}),'ACTION_SHAPE'));
test('state with injected private field fails closed',()=>fail(run({...baseline(),npcSecret:'demo.private'},study('exit')),'STATE_INVALID'));
test('cross-world state fails closed',()=>fail(run({...baseline(),worldId:'demo.other'},study('exit')),'STATE_INVALID'));
test('cross-revision state fails closed',()=>fail(run({...baseline(),revision:'demo.rev2'},study('exit')),'STATE_INVALID'));
test('forged frontier cannot be accepted',()=>fail(run({...baseline(),frontier:chapter(2)},story('enter',{chapterId:chapter(2)})),'STATE_INVALID'));
test('forged completed chapter cannot be accepted',()=>fail(run({...baseline(),committedChapters:[chapter(1)]},story('enter',{chapterId:chapter(1)})),'STATE_INVALID'));
test('diagnostics never echo private injected text',()=>{
  const payload='private story solution should never appear';
  const x=clone(m);x.chapters[0].privateStory=payload;
  const output=JSON.stringify(validateManifest(x));assert.equal(output.includes(payload),false);
  const result=run(baseline(),{mode:'study',type:'exit',secret:payload});assert.equal(JSON.stringify(result).includes(payload),false);
});
test('study action preserves all story-owned fields byte-for-byte',()=>{
  let s=commit(enter(baseline(),0),0);const before=JSON.stringify([s.frontier,s.committedChapters,s.committedEvents,s.storyCursor,s.worldId,s.revision]);
  s=success(run(s,study('select',{dungeonId:m.dungeons[2].id})));
  s=success(run(s,study('practice_verified',{practiceId:m.dungeons[2].practiceId,source:'trusted-demo'})));
  s=success(run(s,study('exit')));
  assert.equal(JSON.stringify([s.frontier,s.committedChapters,s.committedEvents,s.storyCursor,s.worldId,s.revision]),before);
});

test('active story cursor must match current frontier entry',()=>{
  const s=enter(baseline(),0);assert.equal(validateState(m,s),true);
  const forged={...s,storyCursor:m.chapters[2].storyEntry};
  assert.equal(validateState(m,forged),false);
  fail(run(forged,story('ask')),'STATE_INVALID');
});
test('past story cursor is invalid after chapter commit',()=>{
  const s=commit(enter(baseline(),0),0);
  const forged={...s,storyCursor:m.chapters[0].storyEntry};
  assert.equal(validateState(m,forged),false);
  fail(run(forged,story('preview')),'STATE_INVALID');
});
test('current frontier cursor is allowed after a prior commit',()=>{
  const s=enter(commit(enter(baseline(),0),0),1);
  assert.equal(validateState(m,s),true);
});
test('terminal story cannot retain a chapter cursor',()=>{
  let s=baseline();for(let i=0;i<m.chapters.length;i++)s=commit(enter(s,i),i);
  assert.equal(validateState(m,s),true);
  const forged={...s,storyCursor:m.chapters[2].storyEntry};
  assert.equal(validateState(m,forged),false);
});
test('study selection must have a matching recorded visit',()=>{
  const forged={...baseline(),studySelection:m.dungeons[2].id};
  assert.equal(validateState(m,forged),false);
  fail(run(forged,study('exit')),'STATE_INVALID');
});
test('a legitimately selected future study dungeon remains valid',()=>{
  const s=success(run(baseline(),study('select',{dungeonId:m.dungeons[2].id})));
  assert.equal(validateState(m,s),true);
  assert.equal(s.frontier,chapter(0));
  assert.deepEqual(s.studyVisits,[m.dungeons[2].id]);
});
test('forged future cursor remains invalid even after future study verification',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[2].id})));
  s=success(run(s,study('practice_verified',{practiceId:m.dungeons[2].practiceId,source:'trusted-demo'})));
  const forged={...s,storyCursor:m.chapters[2].storyEntry};
  assert.equal(validateState(m,forged),false);
  fail(run(forged,story('commit',{chapterId:chapter(2),eventId:'demo.event.fake',source:'trusted-demo'})),'STATE_INVALID');
});

test('verified practice requires a prior visit to its dungeon',()=>{
  const s={...baseline(),verifiedPractices:[m.dungeons[2].practiceId]};
  assert.equal(validateState(m,s),false);
  fail(run(s,story('ask')),'STATE_INVALID');
});
test('visit to a different dungeon cannot justify practice evidence',()=>{
  const s={...baseline(),studyVisits:[m.dungeons[0].id],verifiedPractices:[m.dungeons[2].practiceId]};
  assert.equal(validateState(m,s),false);
});
test('verified practice with matching prior visit remains valid',()=>{
  let s=success(run(baseline(),study('select',{dungeonId:m.dungeons[2].id})));
  s=success(run(s,study('practice_verified',{practiceId:m.dungeons[2].practiceId,source:'trusted-demo'})));
  assert.equal(validateState(m,s),true);
});
