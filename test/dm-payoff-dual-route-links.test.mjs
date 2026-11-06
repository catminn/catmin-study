import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDmPayoffDualRouteLinks as check} from '../scripts/validate-dm-payoff-dual-route-links.mjs';

const route = which => ({routeBeatId:'route-'+which,traceRef:'demo.trace-'+which,
  entrySceneId:'demo-'+which,goalSceneId:'demo-goal',actionKey:'demo-action',
  baseActionKey:'demo-base',worldFrom:'demo-join',worldTo:'demo-goal'});
const proof = () => ({schemaVersion:'dm-payoff-route-reachability-v1',synthetic:true,
  worldId:'demo-world',dmRevision:'demo-r1',dungeonId:'demo-dungeon',
  actionRevision:1,lessonBeatId:'demo-offer',applicationRef:'demo.application',
  skillId:'demo-skill',chapterIndex:0,routes:[route('a'),route('b')]});
const link = which => ({schemaVersion:'dm-learning-payoff-v1',synthetic:true,
  worldId:'demo-world',dmRevision:'demo-r1',dungeonId:'demo-dungeon',
  actionRevision:1,lessonBeatId:'demo-offer',applicationRef:'demo.application',
  skillId:'demo-skill',chapterIndex:0,actionKey:'demo-action',
  baseActionKey:'demo-base',routeBeatId:'route-'+which,traceRef:'demo.trace-'+which,
  worldFrom:'demo-join',worldTo:'demo-goal'});
const links = () => [link('a'),link('b')];
const reject = (l,p,code) => {
  const result = check(l,p);
  assert.deepEqual(result,{ok:false,code});
  assert.doesNotMatch(JSON.stringify(result),/demo|secret|private/i);
};

test('two independently reviewable route links match one world proof',() =>
  assert.deepEqual(check(links(),proof()),{ok:true,coveredRoutes:2,matchedLinks:2}));
test('links may be supplied in reverse order',() =>
  assert.equal(check(links().reverse(),proof()).ok,true));
test('a single validated route link is insufficient',() =>
  reject([link('a')],proof(),'links_invalid'));
test('duplicate route link cannot stand in for the other branch',() =>
  reject([link('a'),link('a')],proof(),'route_coverage_invalid'));
test('duplicate route proof cannot stand in for the other branch',() => {
  const p=proof();p.routes[1]=structuredClone(p.routes[0]);
  reject(links(),p,'route_coverage_invalid');
});
test('duplicate trace references cannot stand in for distinct committed routes',() => {
  const p=proof();p.routes[1].traceRef=p.routes[0].traceRef;
  reject(links(),p,'route_coverage_invalid');
});
test('mismatched branch trace is rejected',() => {
  const l=links();l[1].traceRef='demo.wrong';
  reject(l,proof(),'route_action_mismatch');
});
test('optional action mismatch on second route is rejected',() => {
  const l=links();l[1].actionKey='demo-other';
  reject(l,proof(),'route_action_mismatch');
});
test('ordinary base exit mismatch on second route is rejected',() => {
  const l=links();l[1].baseActionKey='demo-other';
  reject(l,proof(),'route_action_mismatch');
});
test('world source and target must match on both branches',() => {
  for(const key of ['worldFrom','worldTo']){
    const l=links();l[0][key]='demo-other';
    reject(l,proof(),'route_action_mismatch');
  }
});
test('concept application and skill identity cannot drift across checks',() => {
  for(const key of ['lessonBeatId','applicationRef','skillId','chapterIndex']){
    const l=links();l[1][key]=key==='chapterIndex'?1:'demo-other';
    reject(l,proof(),'scope_mismatch');
  }
});
test('world, dungeon, and revision scope must agree',() => {
  for(const key of ['worldId','dmRevision','dungeonId','actionRevision']){
    const l=links();l[0][key]=key==='actionRevision'?2:'demo-other';
    reject(l,proof(),'scope_mismatch');
  }
});
test('hidden fields in proof and links are rejected',() => {
  const p=proof();p.secret='private';reject(links(),p,'proof_invalid');
  const l=links();l[0].secret='private';reject(l,proof(),'links_invalid');
});
test('hidden fields inside route proof are rejected',() => {
  const p=proof();p.routes[0].requiresSecretGate=true;
  reject(links(),p,'proof_invalid');
});
test('synthetic-only boundary cannot be replaced with production flag',() => {
  const p=proof();p.synthetic=false;reject(links(),p,'proof_invalid');
  const l=links();l[0].synthetic=false;reject(l,proof(),'links_invalid');
});
test('malformed and missing inputs fail closed without echo',() => {
  for(const [l,p] of [[null,proof()],[links(),null],[{},{}],[links(),{routes:null}]]){
    const result=check(l,p);assert.equal(result.ok,false);
    assert.doesNotMatch(JSON.stringify(result),/demo|secret|private/i);
  }
});
test('different registered actions can be bound to distinct routes',() => {
  const p=proof(),l=links();
  p.routes[1].actionKey='demo-action-b';p.routes[1].baseActionKey='demo-base-b';
  p.routes[1].worldFrom='demo-other-join';p.routes[1].worldTo='demo-other-goal';
  Object.assign(l[1],{actionKey:'demo-action-b',baseActionKey:'demo-base-b',
    worldFrom:'demo-other-join',worldTo:'demo-other-goal'});
  assert.equal(check(l,p).ok,true);
});
