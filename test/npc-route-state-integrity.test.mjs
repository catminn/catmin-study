import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState, applyCommitted, projectDialogue, policy} from '../scripts/npc-testimony-reference.mjs';

// All names and lines are synthetic; this suite never imports a private world.
const fresh = () => initialState();
const send = (s, type, extra = {}) => applyCommitted(s, {
  id: 'demo-integrity-' + (s.version + 1), type, scope: structuredClone(s.scope),
  source: 'server', status: 'committed', expectedVersion: s.version, ...extra
});
const accept = (s, type, extra) => {
  const out = send(s, type, extra);
  assert.equal(out.ok, true);
  return out.state;
};
const route = (id) => accept(fresh(), 'route_committed', {route: id, next: policy.routes[id].to});
const join = (id) => accept(route(id), 'scene_entered', {next: policy.convergence.to});
const reject = (s) => {
  const before = structuredClone(s);
  const out = send(s, 'availability_changed', {next: 'unavailable'});
  assert.equal(out.code, 'state_invalid');
  assert.strictEqual(out.state, s);
  assert.deepEqual(s, before);
  assert.deepEqual(projectDialogue(s, 'demo-neutral'), {available: false, text: null});
};
test('initial, both routes and both joined states are causally valid', () => {
  for (const s of [fresh(), route('demo-a'), route('demo-b'), join('demo-a'), join('demo-b')]) {
    assert.equal(send(s, 'availability_changed', {next: 'unavailable'}).ok, true);
  }
});
test('joined routes retain their distinct relationships and approved copy', () => {
  assert.equal(projectDialogue(join('demo-a'), 'demo-guarded').text, 'The reply is careful.');
  assert.equal(projectDialogue(join('demo-b'), 'demo-open').text, 'The reply is more forthcoming.');
});
test('availability changes are valid at fork, route and convergence', () => {
  for (const s of [fresh(), route('demo-a'), join('demo-b')]) {
    const next = accept(s, 'availability_changed', {next: 'unavailable'});
    assert.equal(projectDialogue(next, 'demo-neutral').available, false);
  }
});
test('fork cannot carry a route trace', () => {const s=fresh();s.routeTrace='a';reject(s);});
test('fork cannot inherit a later relationship', () => {const s=fresh();s.npc.relation='guarded';reject(s);});
test('fork cannot place the NPC at a future scene', () => {const s=fresh();s.npc.location='demo-join';reject(s);});
test('unknown scene is rejected instead of becoming a valid persisted stage', () => {const s=fresh();s.scene='demo-unknown';reject(s);});
test('route stage cannot lose its branch trace', () => {const s=route('demo-a');s.routeTrace=null;reject(s);});
test('route stage cannot swap its relationship band', () => {const s=route('demo-a');s.npc.relation='open';reject(s);});
test('route stage cannot move the NPC before convergence', () => {const s=route('demo-b');s.npc.location='demo-join';reject(s);});
test('joined scene cannot erase its branch trace', () => {const s=join('demo-a');s.routeTrace=null;reject(s);});
test('joined scene cannot borrow the other branch relationship', () => {const s=join('demo-a');s.npc.relation='open';reject(s);});
test('joined scene cannot retain an old NPC position', () => {const s=join('demo-b');s.npc.location='demo-fork';reject(s);});
test('version ahead of commit ledger is rejected', () => {const s=fresh();s.version=1;reject(s);});
test('commit ledger ahead of version is rejected', () => {const s=fresh();s.commits['demo-extra']='{}';reject(s);});
test('version mismatch in a previously valid route is rejected', () => {const s=route('demo-a');s.version=2;reject(s);});
test('ASK and preview cannot bypass route-integrity checks', () => {
  const s=join('demo-a');s.npc.relation='neutral';
  for(const mode of ['ask','preview']) {
    const out=applyCommitted(s,{mode,scope:structuredClone(s.scope)});
    assert.equal(out.code,'state_invalid');
    assert.strictEqual(out.state,s);
  }
});
test('valid multistep event history still replays idempotently', () => {
  const s=route('demo-b');
  const e={id:'demo-integrity-2',type:'scene_entered',next:'demo-join',
    scope:structuredClone(s.scope),source:'server',status:'committed',expectedVersion:s.version};
  const out=applyCommitted(s,e);
  assert.equal(out.ok,true);
  const replay=applyCommitted(out.state,e);
  assert.equal(replay.replay,true);
  assert.strictEqual(replay.state,out.state);
});
