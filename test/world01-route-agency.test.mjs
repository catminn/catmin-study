import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorld01RouteAgency as check} from '../scripts/validate-world01-route-agency.mjs';
const base=()=>{
  const world={packageId:'demo-world',visibility:'mechanics_only',nodes:[
    {id:'demo.entry',role:'orientation',next:['demo.choice']},{id:'demo.choice',next:['demo.a','demo.b']},
    {id:'demo.a',next:['demo.join']},{id:'demo.b',next:['demo.join']},
    {id:'demo.join',next:['demo.end']},{id:'demo.end',next:[]}]};
  const commit=(s)=>({id:'demo.event-'+s,from:'demo.choice',to:'demo.'+s,
    cause:{type:'scene_entered',sceneId:'demo.'+s,requiresCommittedTransition:true},
    effect:{type:'set_flag',target:'route_trace',value:s},repeatPolicy:'once_per_world'});
  const causal={schema:'world01-causal-authoring-v1',scope:'synthetic-mechanics-only',worldId:'demo-world',
    routeCommits:[commit('a'),commit('b')],
    npcContinuity:{transitions:[
      {onCommitted:'demo.event-a',set:{relation:'demo.guarded'}},
      {onCommitted:'demo.event-b',set:{relation:'demo.open'}}]},
    convergence:{scene:'demo.join',preserve:['route_trace','npc_relation','committed_event_ids'],
      routeOutcomes:[{routeTrace:'a',npcRelation:'demo.guarded'},{routeTrace:'b',npcRelation:'demo.open'}]},
    learning:{scenes:['demo.a','demo.b'],requiresPlayerConsent:true,allowsNonAcademicProgress:true,
      fabricateMeasurements:false,narrationMayCommitEffects:false}};
  return {world,causal};
};
const cases=[
 ['two meaningful routes',()=>{},null],
 ['reversed route registration',x=>{x.causal.routeCommits.reverse();x.causal.npcContinuity.transitions.reverse();x.causal.convergence.routeOutcomes.reverse();},null],
 ['same destination erases choice',x=>{x.causal.routeCommits[1].to='demo.a';x.causal.routeCommits[1].cause.sceneId='demo.a';},'route_collapsed'],
 ['different choice origin',x=>x.causal.routeCommits[1].from='demo.entry','route_collapsed'],
 ['extra uncommitted fork edge',x=>x.world.nodes[1].next.push('demo.end'),'choice_mismatch'],
 ['missing branch event',x=>x.causal.routeCommits.pop(),'input_invalid'],
 ['duplicate event identity',x=>x.causal.routeCommits[1].id='demo.event-a','commit_alias'],
 ['uncommitted branch cause',x=>x.causal.routeCommits[0].cause.requiresCommittedTransition=false,'commit_invalid'],
 ['branch reaches sibling before convergence',x=>x.world.nodes[2].next=['demo.b'],'branch_bleed'],
 ['branch cannot reach convergence',x=>x.world.nodes[2].next=['demo.end'],'route_dead_end'],
 ['branch has a side dead-end despite valid path',x=>x.world.nodes[2].next=['demo.join','demo.end'],'route_dead_end'],
 ['branch self-loop with optional exit',x=>x.world.nodes[2].next=['demo.a','demo.join'],'route_cycle'],
 ['two-scene branch cycle with optional exit',x=>{x.world.nodes[2].next=['demo.detour'];x.world.nodes.push({id:'demo.detour',next:['demo.a','demo.join']});},'route_cycle'],
 ['acyclic branch detour rejoins',x=>{x.world.nodes[2].next=['demo.detour','demo.join'];x.world.nodes.push({id:'demo.detour',next:['demo.join']});},null],
 ['post-convergence revisit is outside branch scope',x=>x.world.nodes[4].next=['demo.end','demo.join'],null],
 ['NPC reaction collapsed',x=>x.causal.npcContinuity.transitions[1].set.relation='demo.guarded','npc_consequence_erased'],
 ['NPC reaction missing',x=>x.causal.npcContinuity.transitions.pop(),'npc_invalid'],
 ['route outcome misattributed',x=>x.causal.convergence.routeOutcomes[1].npcRelation='demo.guarded','outcome_invalid'],
 ['convergence loses route memory',x=>x.causal.convergence.preserve=['route_trace'],'memory_erased'],
 ['one route missing learning opportunity',x=>x.causal.learning.scenes=['demo.a'],'learning_route_gap'],
 ['forced learning gate',x=>x.causal.learning.allowsNonAcademicProgress=false,'learning_route_gap'],
 ['learning fabricates world evidence',x=>x.causal.learning.fabricateMeasurements=true,'learning_route_gap'],
 ['opening can skip the choice to reunion',x=>x.world.nodes[0].next.push('demo.join'),'choice_bypass'],
 ['opening can skip the choice to ending',x=>x.world.nodes[0].next.push('demo.end'),'choice_bypass'],
 ['opening can enter a route without committing',x=>x.world.nodes[0].next.push('demo.a'),'choice_bypass'],
 ['pre-choice cycle can postpone choice forever',x=>x.world.nodes[0].next.push('demo.entry'),'choice_bypass'],
 ['detached scene cannot be visited from opening',x=>x.world.nodes.push({id:'demo.orphan',next:['demo.orphan']}),'graph_unreachable'],
 ['ambiguous opening role',x=>x.world.nodes[1].role='orientation','entry_invalid'],
 ['post-convergence revisit of opening is legal',x=>x.world.nodes[4].next.push('demo.entry'),null],
 ['acyclic pre-choice detour still reaches choice',x=>{x.world.nodes[0].next.push('demo.before');x.world.nodes.push({id:'demo.before',next:['demo.choice']});},null],
 ['implicit unique graph root is accepted',x=>delete x.world.nodes[0].role,null],
 ['no input mutation',()=>{},null]
];
for(const [name,mutate,code] of cases)test(name,()=>{
  const x=base(),snapshot=JSON.stringify(x);mutate(x);
  const before=JSON.stringify(x),r=check(x.world,x.causal);
  if(code)assert.deepEqual(r,{ok:false,code});
  else assert.deepEqual(r,{ok:true,validatedRoutes:2});
  assert.equal(JSON.stringify(x),before);
  assert.doesNotMatch(JSON.stringify(r),/demo|secret|private|world|trace/i);
});
