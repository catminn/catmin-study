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
    npcContinuity:{actorRef:'demo.actor',initial:{location:'demo.choice',availability:'available',relation:'neutral',claimTier:'unverified'},claimPromotion:'only_authorized_fact_discovery',transitions:[
      {onCommitted:'demo.event-a',set:{relation:'demo.guarded'}},
      {onCommitted:'demo.event-b',set:{relation:'demo.open'}}]},
    convergence:{scene:'demo.join',preserve:['route_trace','npc_relation','committed_event_ids'],
      routeOutcomes:[{routeTrace:'a',npcRelation:'demo.guarded'},{routeTrace:'b',npcRelation:'demo.open'}]},
    learning:{scenes:['demo.a','demo.b'],requiresPlayerConsent:true,allowsNonAcademicProgress:true,
      fabricateMeasurements:false,narrationMayCommitEffects:false},
    publicProjection:{source:'committed_state_only',claimTierWithoutDiscovery:'unverified',
      exposeInternalIds:false,exposeUncommittedConsequences:false}};
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
 ['both branches share a scene before declared reunion',x=>{x.world.nodes[2].next=['demo.shared'];x.world.nodes[3].next=['demo.shared'];x.world.nodes.push({id:'demo.shared',next:['demo.join']});},'premature_convergence'],
 ['optional routes overlap at an intermediate scene',x=>{x.world.nodes[2].next=['demo.join','demo.shared'];x.world.nodes[3].next=['demo.join','demo.shared'];x.world.nodes.push({id:'demo.shared',next:['demo.join']});},'premature_convergence'],
 ['independent detours preserve distinct branch interiors',x=>{x.world.nodes[2].next=['demo.a-detour'];x.world.nodes[3].next=['demo.b-detour'];x.world.nodes.push({id:'demo.a-detour',next:['demo.join']},{id:'demo.b-detour',next:['demo.join']});},null],
 ['shared scene after declared reunion is legal',x=>{x.world.nodes[4].next=['demo.post'];x.world.nodes.push({id:'demo.post',next:['demo.end']});},null],
 ['missing NPC actor reference',x=>{delete x.causal.npcContinuity.actorRef;},'npc_baseline_invalid'],
 ['missing NPC baseline',x=>{delete x.causal.npcContinuity.initial;},'npc_baseline_invalid'],
 ['NPC starts in wrong scene',x=>{x.causal.npcContinuity.initial.location='demo.end';},'npc_baseline_invalid'],
 ['NPC unavailable at opening choice',x=>{x.causal.npcContinuity.initial.availability='unavailable';},'npc_baseline_invalid'],
 ['NPC starts with route relationship',x=>{x.causal.npcContinuity.initial.relation='demo.guarded';},'npc_baseline_invalid'],
 ['NPC starts with confirmed claim',x=>{x.causal.npcContinuity.initial.claimTier='confirmed';},'npc_baseline_invalid'],
 ['unreviewed claim promotion policy',x=>{x.causal.npcContinuity.claimPromotion='narrator_may_confirm';},'npc_baseline_invalid'],
 ['NPC baseline contains unreviewed knowledge',x=>{x.causal.npcContinuity.initial.knowledge=['demo.private'];},'npc_baseline_invalid'],
 ['route reaction silently changes availability',x=>{x.causal.npcContinuity.transitions[0].set.availability='unavailable';},'npc_invalid'],
 ['route reaction silently changes claim tier',x=>{x.causal.npcContinuity.transitions[0].set.claimTier='unverified';},'npc_invalid'],
 ['route reaction contains unreviewed effect',x=>{x.causal.npcContinuity.transitions[0].extra='demo.hidden';},'npc_invalid'],
 ['missing public projection',x=>{delete x.causal.publicProjection;},'projection_invalid'],
 ['internal IDs exposed',x=>{x.causal.publicProjection.exposeInternalIds=true;},'projection_invalid'],
 ['uncommitted consequences exposed',x=>{x.causal.publicProjection.exposeUncommittedConsequences=true;},'projection_invalid'],
 ['claim promoted without discovery',x=>{x.causal.publicProjection.claimTierWithoutDiscovery='confirmed';},'projection_invalid'],
 ['unapproved projection source',x=>{x.causal.publicProjection.source='client_state';},'projection_invalid'],
 ['projection smuggles an extra field',x=>{x.causal.publicProjection.debugInfo='demo.private';},'projection_invalid'],
 ['commit smuggles extra effect',x=>{x.causal.routeCommits[0].onEnter='demo.private';},'commit_invalid'],
 ['cause smuggles extra guard',x=>{x.causal.routeCommits[0].cause.autoAdvance=true;},'commit_invalid'],
 ['effect smuggles extra state mutation',x=>{x.causal.routeCommits[0].effect.setKnowledge='demo.private';},'commit_invalid'],
 ['NPC continuity smuggles hidden transition',x=>{x.causal.npcContinuity.forceClaim=true;},'npc_invalid'],
 ['convergence smuggles extra mutation',x=>{x.causal.convergence.autoUnlock=true;},'convergence_invalid'],
 ['outcome smuggles hidden claim',x=>{x.causal.convergence.routeOutcomes[0].hiddenClaim='demo.private';},'outcome_invalid'],
 ['convergence retains unreviewed state',x=>{x.causal.convergence.preserve.push('npc_knowledge');},'memory_erased'],
 ['learning smuggles forced completion',x=>{x.causal.learning.autoComplete=true;},'learning_route_gap'],
 ['declared scene metadata is accepted',x=>{for(const n of x.world.nodes){n.role=n.role||'investigation';n.learning=n.id==='demo.entry'?'none':n.id==='demo.a'?'math1920.partial-derivative':n.id==='demo.b'?'math1920.gradient':'contextual';n.worldMutation=n.id==='demo.entry'?'none':'on_commit_only';}},null],
 ['unreviewed scene side effect',x=>{x.world.nodes[2].autoReveal=true;},"graph_invalid"],
 ['unreviewed opening metadata',x=>{x.world.nodes[0].hiddenClaim='demo.private';},"graph_invalid"],
 ['uncommitted branch mutation',x=>{x.world.nodes[2].worldMutation='on_enter';},"node_mutation_invalid"],
 ['automatic convergence mutation',x=>{x.world.nodes[4].worldMutation='auto';},"node_mutation_invalid"],
 ['nonstring mutation metadata',x=>{x.world.nodes[2].worldMutation={mode:'on_commit_only'};},"node_mutation_invalid"],
 ['learning advertised but disabled in branch',x=>{x.world.nodes[2].learning='none';},"learning_route_gap"],
 ['forced learning metadata',x=>{x.world.nodes[2].learning='forced';},"learning_route_gap"],
 ['mandatory learning metadata',x=>{x.world.nodes[2].learning='required';},"learning_route_gap"],
 ['nonstring learning metadata',x=>{x.world.nodes[2].learning={kind:'optional'};},"learning_route_gap"],
 ['invalid role metadata',x=>{x.world.nodes[2].role='Scene Title';},"graph_invalid"],
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
