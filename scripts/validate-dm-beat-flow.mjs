/**
 * Spoiler-free, pure authoring preflight for a synthetic DM beat sheet.
 * This is NOT an engine, content approval, or a runtime security boundary.
 * Diagnostics deliberately contain codes/counts only, never source values.
 */
import { readFileSync } from 'node:fs';

const ID = /^[a-z][a-z0-9._-]{0,79}$/;
const TYPES = new Set(['entry', 'observation', 'lesson_offer', 'choice', 'route', 'convergence', 'aftermath']);
const COMMON = ['id', 'type', 'next', 'copySlot'];
const EXTRA = {
  entry: [],
  observation: ['observationRef'],
  lesson_offer: ['anchorBeat', 'conceptId', 'applicationRef', 'optional', 'mutatesWorld', 'requiresPass', 'skipTo', 'resumeTo'],
  choice: [],
  route: ['traceRef', 'requiresCommit', 'eventType'],
  convergence: ['callbacks'],
  aftermath: [],
};
const ROOT = new Set(['schemaVersion', 'synthetic', 'worldId', 'manifestRevision', 'start', 'end', 'beats']);
const isId = (v) => typeof v === 'string' && ID.test(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateDmBeatFlow(input) {
  const errors = new Set();
  const fail = (code) => errors.add(code);
  if (!obj(input)) return { ok: false, codes: ['invalid_root'], errorCount: 1 };
  if (Object.keys(input).some((k) => !ROOT.has(k))) fail('unknown_root_field');
  if (input.schemaVersion !== 'dm-beat-flow-v1' || input.synthetic !== true) fail('invalid_schema');
  if (![input.worldId, input.manifestRevision, input.start, input.end].every(isId)) fail('invalid_identity');
  if (!Array.isArray(input.beats) || input.beats.length < 7 || input.beats.length > 30) {
    fail('invalid_beat_count');
    return { ok: false, codes: [...errors].sort(), errorCount: errors.size };
  }
  const beats = new Map();
  for (const b of input.beats) {
    if (!obj(b) || !isId(b.id) || !TYPES.has(b.type) || !Array.isArray(b.next) || !isId(b.copySlot)) {
      fail('invalid_beat');
      continue;
    }
    if (beats.has(b.id)) fail('duplicate_beat');
    beats.set(b.id, b);
    if (Object.keys(b).some((k) => ![...COMMON, ...EXTRA[b.type]].includes(k))) fail('unreviewed_payload_field');
    if (b.next.some((n) => !isId(n)) || new Set(b.next).size !== b.next.length) fail('invalid_edges');
    if (b.type === 'entry' && b.next.length !== 1) fail('entry_shape');
    if (b.type === 'observation' && (!isId(b.observationRef) || b.next.length !== 1)) fail('observation_shape');
    if (b.type === 'lesson_offer') {
      if (![b.anchorBeat, b.conceptId, b.applicationRef, b.skipTo, b.resumeTo].every(isId)
          || b.optional !== true || b.mutatesWorld !== false || b.requiresPass !== false
          || b.next.length !== 1 || b.next[0] !== b.resumeTo || b.skipTo !== b.resumeTo) fail('lesson_not_optional');
    }
    if (b.type === 'choice' && b.next.length !== 2) fail('choice_shape');
    if (b.type === 'route' && (!isId(b.traceRef) || b.requiresCommit !== true
        || b.eventType !== 'action_resolved' || b.next.length !== 1)) fail('uncommitted_route');
    if (b.type === 'convergence' && (b.next.length !== 1 || !Array.isArray(b.callbacks)
        || b.callbacks.length !== 2 || b.callbacks.some((c) => !obj(c) || Object.keys(c).sort().join(',') !== 'copySlot,requiresCommittedTrace,traceRef'
        || !isId(c.copySlot) || !isId(c.traceRef) || c.requiresCommittedTrace !== true))) fail('callback_shape');
    if (b.type === 'aftermath' && b.next.length !== 0) fail('aftermath_not_terminal');
  }
  if (!beats.has(input.start) || beats.get(input.start)?.type !== 'entry'
      || !beats.has(input.end) || beats.get(input.end)?.type !== 'aftermath') fail('invalid_endpoints');
  const byType = (type) => [...beats.values()].filter((b) => b.type === type);
  for (const type of TYPES) if (byType(type).length !== (type === 'route' ? 2 : 1)) fail('beat_type_cardinality');
  for (const b of beats.values()) for (const to of b.next) if (!beats.has(to)) fail('dangling_edge');
  if (!errors.has('invalid_beat') && !errors.has('dangling_edge') && !errors.has('invalid_endpoints')) {
    // All paths must terminate. Check graph acyclicity, reachability and a non-lesson path.
    const seen = new Set();
    const active = new Set();
    const walk = (id) => {
      if (active.has(id)) { fail('cycle'); return; }
      if (seen.has(id)) return;
      active.add(id);
      for (const n of beats.get(id).next) walk(n);
      active.delete(id);
      seen.add(id);
    };
    walk(input.start);
    if (seen.size !== beats.size || !seen.has(input.end)) fail('unreachable_beat');
    const reachable = (from, to, blocked = new Set()) => {
      const q = [from], visited = new Set();
      while (q.length) {
        const id = q.shift();
        if (blocked.has(id) || visited.has(id)) continue;
        if (id === to) return true;
        visited.add(id);
        const b = beats.get(id);
        if (b) q.push(...b.next);
      }
      return false;
    };
    for (const b of beats.values()) if (!reachable(b.id, input.end)) fail('dead_end');
    const lesson = byType('lesson_offer')[0];
    if (lesson) {
      const anchor = beats.get(lesson.anchorBeat);
      if (anchor?.type !== 'observation' || !anchor.next.includes(lesson.id)) fail('missing_world_anchor');
      const blocked = new Set([lesson.id]);
      // The offer is a presentation beat, not a mandatory academic step; its skip is an authorized edge.
      const q = [input.start], visited = new Set();
      while (q.length) {
        const id = q.shift();
        if (visited.has(id)) continue;
        visited.add(id);
        const b = beats.get(id);
        if (!b) continue;
        if (b.type === 'lesson_offer') q.push(b.skipTo);
        else q.push(...b.next);
      }
      if (!visited.has(input.end) || !visited.has(lesson.resumeTo) || blocked.has(lesson.resumeTo)) fail('forced_learning');
    }
    const choice = byType('choice')[0];
    const merge = byType('convergence')[0];
    if (choice && merge) {
      const routes = choice.next.map((id) => beats.get(id));
      if (routes.some((r) => r?.type !== 'route') || routes.some((r) => r.next[0] !== merge.id)) fail('route_structure');
      else {
        const refs = routes.map((r) => r.traceRef);
        if (new Set(refs).size !== 2) fail('route_trace_collision');
        const callbacks = merge.callbacks;
        if (Array.isArray(callbacks) && callbacks.length === 2 && callbacks.every(obj)) {
          const callbackRefs = callbacks.map((c) => c.traceRef);
          const slots = callbacks.map((c) => c.copySlot);
          if (new Set(callbackRefs).size !== 2 || refs.some((ref) => !callbackRefs.includes(ref))
              || new Set(slots).size !== 2) fail('missing_route_memory');
        }
      }
    }
  }
  return { ok: errors.size === 0, codes: [...errors].sort(), errorCount: errors.size };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const value = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const result = validateDmBeatFlow(value);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stdout.write('{"ok":false,"codes":["invalid_input"],"errorCount":1}\n');
    process.exitCode = 1;
  }
}
