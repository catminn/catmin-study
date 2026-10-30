import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateDmNpcRouteBridge} from '../scripts/validate-dm-npc-route-bridge.mjs';
import {policy} from '../scripts/npc-testimony-reference.mjs';

// Entirely synthetic author fixtures: no formal-world identities or story text.
const flow = JSON.parse(readFileSync(new URL('./fixtures/dm-npc-route-synthetic-v1.json', import.meta.url), 'utf8'));
const original = structuredClone(policy);
original.routes['demo-a'].trace = 'demo.trace-a';
original.routes['demo-b'].trace = 'demo.trace-b';
const binding = {
  schemaVersion:'dm-npc-route-bridge-v1',synthetic:true,worldId:'demo-world',
  manifestRevision:'demo-r1',choiceBeatId:'demo-fork',convergenceBeatId:'demo-join',
  routeBindings:[
    {routeBeatId:'demo-route-a',npcRouteKey:'demo-a',traceRef:'demo.trace-a',callbackCopySlot:'demo.callback-a',dialogueCopyId:'demo-guarded'},
    {routeBeatId:'demo-route-b',npcRouteKey:'demo-b',traceRef:'demo.trace-b',callbackCopySlot:'demo.callback-b',dialogueCopyId:'demo-open'}
  ]
};
const run = edit => {
  const p = structuredClone(original);
  edit?.(p);
  return validateDmNpcRouteBridge(flow, p, binding);
};
const indistinct = (name, edit) => test(name, () => {
  const r = run(edit);
  assert.equal(r.ok, false);
  assert.ok(r.codes.includes('route_consequence_erased'), JSON.stringify(r));
  assert.deepEqual(Object.keys(r).sort(), ['codes','errorCount','ok']);
});

test('genuinely distinct demo dialogue survives the NPC route bridge', () => {
  assert.deepEqual(run(), {ok:true,codes:[],errorCount:0});
});
indistinct('exactly duplicated dialogue is rejected', p => {
  p.publicCopies['demo-open'].text = p.publicCopies['demo-guarded'].text;
});
indistinct('case changes cannot fake a branch consequence', p => {
  p.publicCopies['demo-open'].text = p.publicCopies['demo-guarded'].text.toUpperCase();
});
indistinct('extra spaces cannot fake a branch consequence', p => {
  p.publicCopies['demo-open'].text = '  The  reply is careful.  ';
});
indistinct('full-width compatibility characters cannot fake a branch consequence', p => {
  p.publicCopies['demo-guarded'].text = 'Reply';
  p.publicCopies['demo-open'].text = 'Ｒｅｐｌｙ';
});
indistinct('combining accents cannot fake a branch consequence', p => {
  p.publicCopies['demo-guarded'].text = 'Café';
  p.publicCopies['demo-open'].text = 'Cafe\u0301';
});
indistinct('emoji variation selectors cannot fake a branch consequence', p => {
  p.publicCopies['demo-guarded'].text = '⚙';
  p.publicCopies['demo-open'].text = '⚙️';
});
indistinct('ZWJ emoji differences are conservatively treated as equivalent', p => {
  p.publicCopies['demo-guarded'].text = '👩‍🔬';
  p.publicCopies['demo-open'].text = '👩🔬';
});
for (const [name, a, b] of [
  ['different words', 'Proceed.', 'Stop.'],
  ['negated meaning', 'You may proceed.', 'You may not proceed.'],
  ['punctuation difference', 'Wait.', 'Wait!']
]) test(`${name} remains lexically distinct`, () => {
  const r = run(p => {p.publicCopies['demo-guarded'].text = a; p.publicCopies['demo-open'].text = b;});
  assert.deepEqual(r, {ok:true,codes:[],errorCount:0});
});
test('fixed diagnostics never echo synthetic dialogue or author IDs', () => {
  const marker = 'SYNTHETIC_MARKER_NOT_FOR_OUTPUT';
  const r = run(p => {
    p.publicCopies['demo-guarded'].text = marker;
    p.publicCopies['demo-open'].text = marker.toLowerCase();
  });
  assert.equal(r.ok, false);
  assert.ok(r.codes.includes('route_consequence_erased'));
  assert.equal(JSON.stringify(r).includes(marker), false);
  assert.equal(JSON.stringify(r).includes('demo-guarded'), false);
});
