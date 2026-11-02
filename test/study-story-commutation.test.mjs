import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  initialState, validateState, applySyntheticAction, projectEntrySurface
} from '../scripts/validate-study-story-isolation.mjs';

// A spoiler-free two-mode interleaving model check. Every identifier is demo-only.
// This tests the author reference, not the live Worker, D1, or saved progress.
const manifest = JSON.parse(readFileSync(
  new URL('./fixtures/study-story-isolation-synthetic-v1.json', import.meta.url), 'utf8'));
const chapter = i => manifest.chapters[i].id;
const story = (type, extra={}) => ({mode:'story',type,...extra});
const study = (type, extra={}) => ({mode:'study',type,...extra});
const apply = (state, action) => {
  const before = structuredClone(state);
  const result = applySyntheticAction(manifest,state,action);
  assert.equal(result.ok,true,result.code);
  assert.deepEqual(state,before,'reference action mutated its input');
  assert.equal(validateState(manifest,result.state),true);
  return result.state;
};
const enter = i => story('enter',{chapterId:chapter(i)});
const commit = i => story('commit',{
  chapterId:chapter(i),eventId:'demo.interleave.'+i,source:'trusted-demo'});
const advanceTo = i => {
  let s=initialState(manifest);
  for(let n=0;n<i;n++)s=apply(apply(s,enter(n)),commit(n));
  return s;
};
const storySlice = s => ({
  worldId:s.worldId,revision:s.revision,frontier:s.frontier,
  committedChapters:s.committedChapters,committedEvents:s.committedEvents,
  storyCursor:s.storyCursor
});
const studySlice = s => ({
  studySelection:s.studySelection,studyVisits:s.studyVisits,
  verifiedPractices:s.verifiedPractices
});
const studyActions = selected => [
  study('select',{dungeonId:manifest.dungeons[(selected+1)%manifest.dungeons.length].id}),
  study('practice_verified',{
    practiceId:manifest.dungeons[selected].practiceId,source:'trusted-demo'}),
  study('exit')
];

test('54 study/story interleavings commute across all three saga frontiers',()=>{
  let checked=0;
  for(let i=0;i<manifest.chapters.length;i++)
    for(let j=0;j<manifest.dungeons.length;j++)
      for(const action of studyActions(j))
        for(const storyAction of [enter(i),commit(i)]) {
          let base=advanceTo(i);
          base=apply(base,study('select',{dungeonId:manifest.dungeons[j].id}));
          if(storyAction.type==='commit')base=apply(base,enter(i));
          const first=apply(apply(base,action),storyAction);
          const second=apply(apply(base,storyAction),action);
          assert.deepEqual(first,second,
            'interleaving mismatch at chapter '+i+', dungeon '+j+', '+action.type+'/'+storyAction.type);
          assert.deepEqual(storySlice(first),storySlice(apply(base,storyAction)));
          assert.deepEqual(studySlice(first),studySlice(apply(base,action)));
          checked++;
        }
  assert.equal(checked,54);
});

test('interleaved study evidence stays visible without revealing later story chapters',()=>{
  for(let i=0;i<manifest.chapters.length;i++)
    for(let j=0;j<manifest.dungeons.length;j++) {
      let state=advanceTo(i);
      state=apply(state,enter(i));
      const before=storySlice(state);
      state=apply(state,study('select',{dungeonId:manifest.dungeons[j].id}));
      state=apply(state,study('practice_verified',{
        practiceId:manifest.dungeons[j].practiceId,source:'trusted-demo'}));
      state=apply(state,study('exit'));
      assert.deepEqual(storySlice(state),before,'study changed story cursor or frontier');
      const studyView=projectEntrySurface(manifest,state,'study');
      const storyView=projectEntrySurface(manifest,state,'story');
      assert.equal(studyView.ok,true);
      assert.equal(storyView.ok,true);
      assert.deepEqual(Object.keys(studyView.view).sort(),
        ['availablePractices','mode','selectedDungeonId','verifiedPracticeIds']);
      assert.deepEqual(Object.keys(storyView.view).sort(),
        ['canContinue','currentChapterId','mode','resumeActive']);
      assert.equal(storyView.view.currentChapterId,chapter(i));
      assert.equal(storyView.view.resumeActive,true);
      assert.ok(studyView.view.verifiedPracticeIds.includes(manifest.dungeons[j].practiceId));
      const publicStudy=JSON.stringify(studyView.view);
      for(const c of manifest.chapters)
        for(const hidden of [c.id,c.storyEntry,c.publicCopySlot])
          assert.equal(publicStudy.includes(hidden),false);
      state=apply(state,commit(i));
      assert.ok(state.verifiedPractices.includes(manifest.dungeons[j].practiceId));
    }
});
