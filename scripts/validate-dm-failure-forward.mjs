/** Spoiler-free synthetic authoring preflight, not a runtime or approval boundary. */
import { readFileSync } from 'node:fs';
const ID = /^[a-z][a-z0-9._-]{0,79}$/;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isId = (v) => typeof v === 'string' && ID.test(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));
const exact = (v, expected) => keys(v, expected) && expected.every((k) => own(v, k));
const ROOT = ['schemaVersion','synthetic','worldId','manifestRevision','scenes','attempt','callbacks','previewPolicy'];
const SCENE = ['id','chapterIndex','order'];
const ATTEMPT = ['id','sceneId','recoverySceneId','endSceneId','optionalSkill','requiresQuiz','outcomes','recovery'];
const OUTCOME = ['kind','eventRef','to','copySlot','costRef','committed'];
const RECOVERY = ['id','from','to','eventRef','copySlot','requiresSkill','committed'];
const CALLBACK = ['eventRef','at','copySlot','requiresCommitted'];
const POLICY = ['askMutates','lessonDeclineMutates','previewMutates'];
const done = (errors) => ({ok: errors.size === 0, codes: [...errors].sort(), errorCount: errors.size});

export function validateDmFailureForward(value) {
  const errors = new Set();
  const fail = (code) => errors.add(code);
  if (!exact(value, ROOT)) return {ok:false,codes:['invalid_root'],errorCount:1};
  if (value.schemaVersion !== 'dm-failure-forward-v1' || value.synthetic !== true ||
      !isId(value.worldId) || !isId(value.manifestRevision)) fail('invalid_schema');
  if (!Array.isArray(value.scenes) || value.scenes.length < 3 || value.scenes.length > 12) {
    fail('invalid_scenes'); return done(errors);
  }
  const scenes = new Map();
  for (const s of value.scenes) {
    if (!exact(s,SCENE) || !isId(s.id) || !Number.isSafeInteger(s.chapterIndex) || s.chapterIndex < 0 ||
        !Number.isSafeInteger(s.order) || s.order < 0) {fail('invalid_scene'); continue;}
    if (scenes.has(s.id)) fail('duplicate_scene');
    scenes.set(s.id,s);
  }
  const pos = (id) => {const s=scenes.get(id); return s ? [s.chapterIndex,s.order] : null;};
  const before = (a,b) => {const x=pos(a), y=pos(b); return !!(x&&y&&(x[0]<y[0] || (x[0]===y[0]&&x[1]<y[1])));};
  const a=value.attempt;
  if (!exact(a,ATTEMPT) || !isId(a.id) || ![a.sceneId,a.recoverySceneId,a.endSceneId].every(isId)) {
    fail('invalid_attempt'); return done(errors);
  }
  if (a.optionalSkill !== true || a.requiresQuiz !== false) fail('forced_academic_gate');
  if (!before(a.sceneId,a.recoverySceneId) || !before(a.recoverySceneId,a.endSceneId) ||
      !(pos(a.endSceneId)?.[0] > pos(a.sceneId)?.[0])) fail('invalid_progression');
  if (!Array.isArray(a.outcomes) || a.outcomes.length !== 3) fail('outcome_cardinality');
  const kinds = new Set(), eventRefs = new Set(), slots = new Set();
  for (const o of Array.isArray(a.outcomes) ? a.outcomes : []) {
    if (!exact(o,OUTCOME) || !['success','setback','refusal'].includes(o.kind) ||
        !isId(o.eventRef) || !isId(o.to) || !isId(o.copySlot) ||
        !(o.costRef === null || isId(o.costRef)) || o.committed !== true) {fail('invalid_outcome'); continue;}
    if (kinds.has(o.kind)) fail('duplicate_outcome');
    kinds.add(o.kind);
    if (eventRefs.has(o.eventRef) || slots.has(o.copySlot)) fail('outcome_alias_collision');
    eventRefs.add(o.eventRef); slots.add(o.copySlot);
    if (o.to !== (o.kind === 'success' ? a.endSceneId : a.recoverySceneId)) fail('invalid_outcome_route');
    if (o.kind === 'setback' ? o.costRef === null : o.costRef !== null) fail('invalid_consequence');
  }
  if (['success','setback','refusal'].some((k)=>!kinds.has(k))) fail('missing_outcome');
  if (!Array.isArray(a.recovery) || a.recovery.length < 1 || a.recovery.length > 3) fail('invalid_recovery');
  let baseRecovery = false;
  for (const r of Array.isArray(a.recovery) ? a.recovery : []) {
    if (!exact(r,RECOVERY) || ![r.id,r.from,r.to,r.eventRef,r.copySlot].every(isId) ||
        typeof r.requiresSkill !== 'boolean' || r.committed !== true) {fail('invalid_recovery');continue;}
    if (r.from !== a.recoverySceneId || r.to !== a.endSceneId) fail('recovery_dead_end');
    if (!r.requiresSkill) baseRecovery = true;
    if (eventRefs.has(r.eventRef) || slots.has(r.copySlot)) fail('recovery_alias_collision');
    eventRefs.add(r.eventRef); slots.add(r.copySlot);
  }
  if (!baseRecovery) fail('no_nonacademic_recovery');
  if (!Array.isArray(value.callbacks) || value.callbacks.length !== 2) fail('invalid_callbacks');
  const callbacks = new Map();
  for (const c of Array.isArray(value.callbacks) ? value.callbacks : []) {
    if (!exact(c,CALLBACK) || !isId(c.eventRef) || !isId(c.at) || !isId(c.copySlot) ||
        c.requiresCommitted !== true) {fail('invalid_callback');continue;}
    if (callbacks.has(c.eventRef) || slots.has(c.copySlot)) fail('callback_alias_collision');
    callbacks.set(c.eventRef,c); slots.add(c.copySlot);
    if (c.at !== a.endSceneId) fail('premature_callback');
  }
  for (const kind of ['setback','refusal']) {
    const o = Array.isArray(a.outcomes) ? a.outcomes.find((x)=>object(x)&&x.kind===kind) : null;
    if (o && !callbacks.has(o.eventRef)) fail('missing_consequence_callback');
  }
  for (const ref of callbacks.keys()) {
    if (!Array.isArray(a.outcomes) || !a.outcomes.some((o)=>object(o)&&o.eventRef===ref&&['setback','refusal'].includes(o.kind))) fail('orphan_callback');
  }
  if (!exact(value.previewPolicy,POLICY) || (object(value.previewPolicy) && Object.values(value.previewPolicy).some((x)=>x!==false))) fail('preview_mutates');
  return done(errors);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const value=JSON.parse(readFileSync(process.argv[2],'utf8'));
    const result=validateDmFailureForward(value);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode=1;
  } catch {
    process.stdout.write('{"ok":false,"codes":["invalid_input"],"errorCount":1}\n');
    process.exitCode=1;
  }
}
