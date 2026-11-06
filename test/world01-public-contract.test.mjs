import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {checkWorld01PublicContract as check} from '../scripts/check-world01-public-contract.mjs';

// This test uses ONLY the repository's public, synthetic, spoiler-free fixtures.
const load = () => {
  const world=JSON.parse(readFileSync(fileURLToPath(new URL('../content/contracts/world01-opening-skeleton.json',import.meta.url)),'utf8'));
  const causal=JSON.parse(readFileSync(fileURLToPath(new URL('../test/fixtures/world01-causal-authoring-v1.json',import.meta.url)),'utf8'));
  return {world,causal};
};
const cases=[
  ['published public snapshot',()=>{},null],
  ['node registration order does not matter',x=>x.world.nodes.reverse(),null],
  ['choice edge order does not matter',x=>x.world.nodes[1].next.reverse(),null],
  ['causal declaration order does not matter',x=>{x.causal.routeCommits.reverse();x.causal.npcContinuity.transitions.reverse();x.causal.convergence.routeOutcomes.reverse();},null],
  ['wrong public identity',x=>x.world.packageId='other','public_identity_drift'],
  ['same pointer but substituted scene',x=>x.world.nodes[2].id='w01.impostor','public_scene_drift'],
  ['same pointer but rewired scene',x=>x.world.nodes[4].next=['w01.aftermath'],'public_scene_drift'],
  ['same pointer but changed learning concept',x=>x.world.nodes[2].learning='math1920.gradient','public_scene_drift'],
  ['same pointer but extra scene field',x=>x.world.nodes[2].autoReveal=true,'public_scene_drift'],
  ['same pointer but omitted scene',x=>x.world.nodes.pop(),'public_scene_drift'],
  ['published acceptance path drift',x=>x.world.acceptance[0].route[3]='w01.resolve','public_acceptance_drift'],
  ['published acceptance ID drift',x=>x.world.acceptance[0].id='branch-c','public_acceptance_drift'],
  ['route trace drift',x=>x.causal.routeCommits[0].effect.value='b','public_causal_drift'],
  ['NPC reaction drift',x=>x.causal.npcContinuity.transitions[0].set.relation='open','public_causal_drift'],
  ['projection policy drift',x=>x.causal.publicProjection.exposeInternalIds=true,'public_causal_drift'],

  ['metadata registration order does not matter',x=>{x.world.authoringConstraints.reverse();x.world.acceptance.reverse();},null],
  ['world warning cannot drift',x=>x.world.warning='unreviewed copy','public_metadata_drift'],
  ['ownership cannot drift',x=>x.world.ownership.engineering='unreviewed','public_metadata_drift'],
  ['authoring constraints cannot drift',x=>x.world.authoringConstraints[0]='unreviewed copy','public_metadata_drift'],
  ['unreviewed world metadata rejected',x=>x.world.hiddenNarration='unreviewed','public_metadata_drift'],
  ['unreviewed causal metadata rejected',x=>x.causal.hiddenFacts='unreviewed','public_metadata_drift'],
  ['causal warning cannot drift',x=>x.causal.warning='unreviewed copy','public_metadata_drift'],
  ['missing non-route acceptance requirement rejected',x=>x.world.acceptance.pop(),'public_acceptance_drift'],
  ['changed non-route acceptance requirement rejected',x=>x.world.acceptance[2].require='unreviewed copy','public_acceptance_drift'],
  ['extra non-route acceptance requirement rejected',x=>x.world.acceptance.push({id:'extra',require:'unreviewed copy'}),'public_acceptance_drift'],
  ['unreviewed acceptance field rejected',x=>x.world.acceptance[2].debug='unreviewed','public_acceptance_drift'],
  ['no input mutation',()=>{},null]
];
for(const [name,mutate,error] of cases)test(name,()=>{
  const x=load();mutate(x);const before=JSON.stringify(x);
  const result=check(x.world,x.causal);
  assert.deepEqual(result,error?{ok:false,code:error}:{ok:true,boundScenes:8,boundRoutes:2});
  assert.equal(JSON.stringify(x),before);
  assert.doesNotMatch(JSON.stringify(result),/w01|npc|secret|answer|route_a/i);
});
