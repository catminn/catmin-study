import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  initialState, validateState, applySyntheticAction, projectEntrySurface
} from '../scripts/validate-study-story-isolation.mjs';

// Entirely synthetic author-side state; no real story, identity, secret, or
// production persistence. This is not a Worker/D1 authorization test.
const manifest = JSON.parse(readFileSync(
  new URL('./fixtures/study-story-isolation-synthetic-v1.json', import.meta.url), 'utf8'));
const action = (mode, type, payload = {}) => ({mode, type, ...payload});
const advance = (state, a) => {
  const result = applySyntheticAction(manifest, state, a);
  assert.equal(result.ok, true, result.code);
  return result.state;
};
function snapshots() {
  const chapterId = manifest.chapters[0].id;
  const dungeon = manifest.dungeons[0];
  const states = [initialState(manifest)];
  states.push(advance(states.at(-1), action('story', 'enter', {chapterId})));
  states.push(advance(states.at(-1), action('study', 'select', {dungeonId:dungeon.id})));
  states.push(advance(states.at(-1), action('study', 'practice_verified',
    {practiceId:dungeon.practiceId, source:'trusted-demo'})));
  states.push(advance(states.at(-1), action('story', 'commit',
    {chapterId, eventId:'demo.state-integrity', source:'trusted-demo'})));
  states.push(advance(states.at(-1), action('study', 'exit')));
  return states;
}

test('all six normal dual-entry state snapshots remain valid and project only reviewed fields', () => {
  const expected = [
    'worldId','revision','frontier','committedChapters','committedEvents',
    'storyCursor','studySelection','verifiedPractices','studyVisits'
  ].sort();
  for (const state of snapshots()) {
    assert.equal(validateState(manifest, state), true);
    assert.deepEqual(Object.keys(state).sort(), expected);
    assert.equal(projectEntrySurface(manifest, state, 'study').ok, true);
    assert.equal(projectEntrySurface(manifest, state, 'story').ok, true);
    assert.equal(validateState(manifest, JSON.parse(JSON.stringify(state))), true);
  }
});

test('unreviewed saved state fields fail closed before action cloning or either public projection', () => {
  let cases = 0;
  for (const state of snapshots())
    for (const extra of [
      {privateStory: 'SYNTHETIC_SENTINEL'},
      {unreviewedMeta: {secret: 'SYNTHETIC_SENTINEL'}},
      {traceRef: ['SYNTHETIC_SENTINEL']}
    ]) {
      const contaminated = JSON.parse(JSON.stringify({...state, ...extra}));
      const before = JSON.stringify(contaminated);
      assert.equal(validateState(manifest, contaminated), false);
      const applied = applySyntheticAction(manifest, contaminated,
        action('study', 'exit'));
      assert.deepEqual(applied, {ok:false,code:'STATE_INVALID'});
      for (const mode of ['study', 'story']) {
        const projection = projectEntrySurface(manifest, contaminated, mode);
        assert.deepEqual(projection, {ok:false,code:'STATE_INVALID'});
        assert.equal(JSON.stringify(projection).includes('SYNTHETIC_SENTINEL'), false);
      }
      assert.equal(JSON.stringify(contaminated), before);
      cases++;
    }
  assert.equal(cases, 18);
});
