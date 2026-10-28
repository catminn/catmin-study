import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBundle } from '../scripts/validate-story-bundle.mjs';

const example = () => ({ records: [
  { kind: 'world', id: 'w01', content: {kind:'world',id:'w01'} },
  { kind: 'scene', id: 'a', content: {kind:'scene',id:'a',choices:['b'],knowledgeLinks:[]} },
  { kind: 'scene', id: 'b', content: {kind:'scene',id:'b',choices:[],knowledgeLinks:[]} }
]});
test('a valid minimal world bundle passes', () => {
  const r = validateBundle(example());
  assert.equal(r.ok, true);
  assert.equal(r.count.scene, 2);
});
test('duplicate record and unknown destinations reject without showing content', () => {
  const b = example();
  b.records.push({...b.records[1]});
  b.records[2].content.choices = ['missing'];
  const r = validateBundle(b);
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('duplicate record'));
  assert.ok(r.errors.includes('unknown scene destination'));
  assert.ok(!JSON.stringify(r).includes('missing'));
});
test('oversized records and unknown NPC location reject', () => {
  const b = example();
  b.records.push({kind:'npc',id:'n',content:{kind:'npc',id:'n',initial:{locationId:'void'},privateProfile:{secret:'x'.repeat(66000)}}});
  const r=validateBundle(b);
  assert.equal(r.ok,false);
  assert.ok(r.errors.includes('record exceeds 64KiB'));
  assert.ok(r.errors.includes('unknown npc location'));
});
