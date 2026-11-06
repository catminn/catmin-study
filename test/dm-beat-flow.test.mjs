import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { validateDmBeatFlow } from '../scripts/validate-dm-beat-flow.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'fixtures/dm-beat-flow-synthetic-v1.json');
const scriptPath = resolve(here, '../scripts/validate-dm-beat-flow.mjs');
const base = JSON.parse(readFileSync(fixturePath, 'utf8'));
const copy = () => structuredClone(base);
const beat = (d, id) => d.beats.find((b) => b.id === id);
const rejected = (edit, code) => {
  const d = copy();
  edit(d);
  const r = validateDmBeatFlow(d);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.ok(r.codes.includes(code), JSON.stringify(r));
  assert.deepEqual(Object.keys(r).sort(), ['codes', 'errorCount', 'ok']);
  assert.equal(r.errorCount, r.codes.length);
};

test('synthetic eight-beat sheet passes', () => {
  const r = validateDmBeatFlow(base);
  assert.deepEqual(r, { ok: true, codes: [], errorCount: 0 });
});
test('valid fixture does not change when checked', () => {
  const d = copy(), before = JSON.stringify(d);
  validateDmBeatFlow(d);
  assert.equal(JSON.stringify(d), before);
});
test('rejects non-object root', () => assert.deepEqual(validateDmBeatFlow(null), { ok: false, codes: ['invalid_root'], errorCount: 1 }));
test('rejects wrong schema', () => rejected((d) => { d.schemaVersion = 'other'; }, 'invalid_schema'));
test('requires synthetic marker', () => rejected((d) => { d.synthetic = false; }, 'invalid_schema'));
test('rejects unknown root story payload', () => rejected((d) => { d.secretEnding = 'PRIVATE_VALUE'; }, 'unknown_root_field'));
test('rejects invalid world revision', () => rejected((d) => { d.manifestRevision = 'bad revision'; }, 'invalid_identity'));
test('rejects empty beats', () => rejected((d) => { d.beats = []; }, 'invalid_beat_count'));
test('rejects duplicate beat IDs', () => rejected((d) => { d.beats.push(structuredClone(beat(d, 'route-a'))); }, 'duplicate_beat'));
test('rejects a hidden script text field', () => rejected((d) => { beat(d, 'entry').narration = 'PRIVATE_VALUE'; }, 'unreviewed_payload_field'));
test('rejects extra answer field in lesson', () => rejected((d) => { beat(d, 'lesson-offer').answer = 'PRIVATE_VALUE'; }, 'unreviewed_payload_field'));
test('rejects invalid copy slot', () => rejected((d) => { beat(d, 'entry').copySlot = ''; }, 'invalid_beat'));
test('rejects duplicate edge', () => rejected((d) => { beat(d, 'decision').next = ['route-a', 'route-a']; }, 'invalid_edges'));
test('rejects dangling scene link', () => rejected((d) => { beat(d, 'entry').next = ['missing']; }, 'dangling_edge'));
test('requires one entry edge', () => rejected((d) => { beat(d, 'entry').next = []; }, 'entry_shape'));
test('requires visible observation reference', () => rejected((d) => { delete beat(d, 'observation').observationRef; }, 'observation_shape'));
test('lesson cannot become mandatory', () => rejected((d) => { beat(d, 'lesson-offer').optional = false; }, 'lesson_not_optional'));
test('lesson cannot mutate world', () => rejected((d) => { beat(d, 'lesson-offer').mutatesWorld = true; }, 'lesson_not_optional'));
test('lesson cannot require academic pass', () => rejected((d) => { beat(d, 'lesson-offer').requiresPass = true; }, 'lesson_not_optional'));
test('skip must return to original choice', () => rejected((d) => { beat(d, 'lesson-offer').skipTo = 'aftermath'; }, 'lesson_not_optional'));
test('lesson must be anchored to visible observation', () => rejected((d) => { beat(d, 'lesson-offer').anchorBeat = 'entry'; }, 'missing_world_anchor'));
test('choice must offer two routes', () => rejected((d) => { beat(d, 'decision').next = ['route-a']; }, 'choice_shape'));
test('routes require committed events', () => rejected((d) => { beat(d, 'route-a').requiresCommit = false; }, 'uncommitted_route'));
test('routes cannot use quiz result as commit event', () => rejected((d) => { beat(d, 'route-a').eventType = 'practice_passed'; }, 'uncommitted_route'));
test('route traces must differ', () => rejected((d) => { beat(d, 'route-b').traceRef = 'demo.trace-a'; }, 'route_trace_collision'));
test('both routes must meet at declared convergence', () => rejected((d) => { beat(d, 'route-b').next = ['aftermath']; }, 'route_structure'));
test('callbacks must match committed route traces', () => rejected((d) => { beat(d, 'merge').callbacks[1].traceRef = 'demo.wrong'; }, 'missing_route_memory'));
test('callbacks cannot collapse into same text slot', () => rejected((d) => { beat(d, 'merge').callbacks[1].copySlot = 'demo.callback-a'; }, 'missing_route_memory'));
test('callbacks require committed trace evidence', () => rejected((d) => { beat(d, 'merge').callbacks[0].requiresCommittedTrace = false; }, 'callback_shape'));
test('invalid callback must fail cleanly', () => rejected((d) => { beat(d, 'merge').callbacks[0] = null; }, 'callback_shape'));
test('aftermath is terminal', () => rejected((d) => { beat(d, 'aftermath').next = ['entry']; }, 'aftermath_not_terminal'));
test('cycles cannot be authored', () => rejected((d) => { beat(d, 'merge').next = ['decision']; }, 'cycle'));
test('disconnected beat is rejected', () => rejected((d) => { beat(d, 'entry').next = ['decision']; }, 'unreachable_beat'));
test('unknown terminal ID is rejected', () => rejected((d) => { d.end = 'missing'; }, 'invalid_endpoints'));
test('CLI succeeds with synthetic fixture', () => {
  const p = spawnSync(process.execPath, [scriptPath, fixturePath], { encoding: 'utf8' });
  assert.equal(p.status, 0);
  assert.deepEqual(JSON.parse(p.stdout), { ok: true, codes: [], errorCount: 0 });
});
test('CLI rejects malformed JSON without echoing private content', () => {
  const p = spawnSync(process.execPath, [scriptPath, '/dev/null'], { encoding: 'utf8' });
  assert.equal(p.status, 1);
  assert.deepEqual(JSON.parse(p.stdout), { ok: false, codes: ['invalid_input'], errorCount: 1 });
});
test('diagnostics never contain input values', () => {
  const d = copy(); d.secretEnding = 'DO_NOT_PRINT_THIS';
  const r = validateDmBeatFlow(d);
  assert.equal(JSON.stringify(r).includes('DO_NOT_PRINT_THIS'), false);
  assert.equal(JSON.stringify(r).includes('demo.trace-a'), false);
});
