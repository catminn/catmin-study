/** Synthetic-only, spoiler-free route agency and NPC consequence cross-check.
 * Author-side reference: never approves imports or authenticates runtime events. */
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(x);
const fail=code=>({ok:false,code});
const unique=xs=>new Set(xs).size===xs.length;
const equalSet=(a,b)=>a.length===b.length&&unique(a)&&unique(b)&&a.every(x=>b.includes(x));

export function validateWorld01RouteAgency(world, causal) {
  try {
    if(!obj(world)||!obj(causal)||causal.scope!=='synthetic-mechanics-only'||
       causal.schema!=='world01-causal-authoring-v1'||world.visibility!=='mechanics_only'||
       !id(world.packageId)||causal.worldId!==world.packageId||
       !Array.isArray(world.nodes)||world.nodes.length<5||world.nodes.length>32||
       !Array.isArray(causal.routeCommits)||causal.routeCommits.length!==2)
      return fail('input_invalid');
    const nodes=new Map();
    for(const n of world.nodes){
      if(!obj(n)||!id(n.id)||!Array.isArray(n.next)||n.next.length>8||
         !n.next.every(id)||!unique(n.next)||nodes.has(n.id))return fail('graph_invalid');
      nodes.set(n.id,n);
    }
    if([...nodes.values()].some(n=>n.next.some(to=>!nodes.has(to))))return fail('graph_invalid');
    const events=causal.routeCommits;
    if(events.some(e=>!obj(e)||!id(e.id)||!id(e.from)||!id(e.to)||
       !obj(e.cause)||e.cause.type!=='scene_entered'||
       e.cause.sceneId!==e.to||e.cause.requiresCommittedTransition!==true||
       !obj(e.effect)||e.effect.type!=='set_flag'||e.effect.target!=='route_trace'||
       !id(e.effect.value)||e.repeatPolicy!=='once_per_world'))return fail('commit_invalid');
    if(!unique(events.map(e=>e.id))||!unique(events.map(e=>e.effect.value)))
      return fail('commit_alias');
    if(!unique(events.map(e=>e.to))||events[0].from!==events[1].from)
      return fail('route_collapsed');
    const fork=nodes.get(events[0].from);
    if(!fork||!equalSet(fork.next,events.map(e=>e.to)))return fail('choice_mismatch');
    const convergence=causal.convergence;
    if(!obj(convergence)||!id(convergence.scene)||!nodes.has(convergence.scene)||
       convergence.scene===events[0].from||events.some(e=>e.to===convergence.scene))
      return fail('convergence_invalid');
    // No branch may enter the other branch before the shared convergence.
    for(let i=0;i<2;i++){
      const start=events[i].to,other=events[1-i].to;
      const seen=new Set(),stack=[start];let reached=false;
      while(stack.length){
        const cur=stack.pop();
        if(cur===other)return fail('branch_bleed');
        if(cur===convergence.scene){reached=true;continue;}
        if(seen.has(cur))continue;
        seen.add(cur);
        for(const next of nodes.get(cur).next)stack.push(next);
      }
      if(!reached)return fail('route_dead_end');
      // Every route continuation, not merely one lucky path, must reach the reunion.
      const canReach=new Set([convergence.scene]);
      let changed=true;
      while(changed){
        changed=false;
        for(const node of seen)if(!canReach.has(node)&&nodes.get(node).next.some(n=>canReach.has(n))){
          canReach.add(node);changed=true;
        }
      }
      if([...seen].some(node=>!canReach.has(node)))return fail('route_dead_end');
    }
    const npc=causal.npcContinuity;
    if(!obj(npc)||!Array.isArray(npc.transitions)||npc.transitions.length!==2)
      return fail('npc_invalid');
    const relations=[];
    for(const e of events){
      const matching=npc.transitions.filter(t=>obj(t)&&t.onCommitted===e.id);
      if(matching.length!==1||!obj(matching[0].set)||!id(matching[0].set.relation)||
         matching[0].set.claimTier==='confirmed')return fail('npc_invalid');
      relations.push(matching[0].set.relation);
    }
    if(!unique(relations))return fail('npc_consequence_erased');
    if(!Array.isArray(convergence.routeOutcomes)||convergence.routeOutcomes.length!==2)
      return fail('outcome_invalid');
    for(let i=0;i<2;i++){
      const matched=convergence.routeOutcomes.filter(o=>obj(o)&&
        o.routeTrace===events[i].effect.value&&o.npcRelation===relations[i]);
      if(matched.length!==1)return fail('outcome_invalid');
    }
    if(!unique(convergence.routeOutcomes.map(o=>o.routeTrace)))return fail('outcome_invalid');
    if(!Array.isArray(convergence.preserve)||
       !['route_trace','npc_relation','committed_event_ids'].every(k=>convergence.preserve.includes(k)))
      return fail('memory_erased');
    const learning=causal.learning;
    if(!obj(learning)||!Array.isArray(learning.scenes)||
       !equalSet(learning.scenes,events.map(e=>e.to))||
       learning.requiresPlayerConsent!==true||learning.allowsNonAcademicProgress!==true||
       learning.fabricateMeasurements!==false||learning.narrationMayCommitEffects!==false)
      return fail('learning_route_gap');
    return {ok:true,validatedRoutes:2};
  }catch{return fail('input_invalid');}
}
