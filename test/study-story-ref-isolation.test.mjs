import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  validateManifest, initialState, applySyntheticAction, projectEntrySurface
} from '../scripts/validate-study-story-isolation.mjs';

// Public synthetic IDs only; no formal-world content or private narrative.
const manifest = JSON.parse(readFileSync(
  new URL('./fixtures/study-story-isolation-synthetic-v1.json', import.meta.url), 'utf8'));
const copy = x => structuredClone(x);
const storyFields = ['id', 'storyEntry', 'publicCopySlot'];
const studyFields = ['id', 'practiceId', 'conceptId'];

test('disjoint synthetic study/story references remain valid and public study view is isolated', () => {
  assert.equal(validateManifest(manifest).ok, true);
  const result = projectEntrySurface(manifest, initialState(manifest), 'study');
  assert.equal(result.ok, true);
  const publicText = JSON.stringify(result.view);
  for (const chapter of manifest.chapters)
    for (const field of storyFields)
      assert.equal(publicText.includes(chapter[field]), false);
});

test('all nine story-to-study reference aliases fail closed before entry projection', () => {
  let cases = 0;
  for (const storyField of storyFields)
    for (const studyField of studyFields) {
      const altered = copy(manifest);
      altered.chapters[0][storyField] = altered.dungeons[0][studyField];
      if (storyField === 'id')
        altered.chapters[1].predecessor = altered.chapters[0].id;
      const before = copy(altered);
      const result = validateManifest(altered);
      assert.equal(result.ok, false, storyField + '/' + studyField);
      assert.ok(result.codes.includes('CROSS_MODE_REF_COLLISION'));
      assert.deepEqual(altered, before, 'validator mutated manifest');
      assert.equal(initialState(altered), null);
      const projection = projectEntrySurface(altered, initialState(manifest), 'study');
      assert.deepEqual(projection, {ok:false,code:'MANIFEST_INVALID'});
      cases++;
    }
  assert.equal(cases, 9);
});

test('cross-mode collision cannot be smuggled through action or diagnostic output', () => {
  const altered = copy(manifest);
  altered.chapters[2].storyEntry = altered.dungeons[1].conceptId;
  const payload = 'private future chapter text must never appear';
  const result = applySyntheticAction(altered, initialState(manifest),
    {mode:'study',type:'exit',secret:payload});
  assert.deepEqual(result, {ok:false,code:'MANIFEST_INVALID'});
  assert.equal(JSON.stringify(result).includes(payload), false);
});
