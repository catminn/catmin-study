/** Synthetic-only, spoiler-free route agency and NPC consequence cross-check.
 * Author-side reference: never approves imports or authenticates runtime events. */
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(x);
const fail=code=>({ok:false,code});
const unique=xs=>new Set(xs).size===xs.length;
const equalSet=(a,b)=>a.length===b.length&&unique(a)&&unique(b)&&a.every(x=>b.includes(x));
const exact=(value,keys)=>obj(value)&&equalSet(Object.keys(value),keys);

export function validateWorld01RouteAgency(world, causal) {
  try {
    if(!obj(world)||!obj(causal)||causal.scope!=='synthetic-mechanics-only'||
       causal.schema!=='world01-causal-authoring-v1'||world.visibility!=='mechanics_only'||
       !id(world.packageId)||causal.worldId!==world.packageId||
       !Array.isArray(world.nodes)||world.nodes.length<5||world.nodes.length>32||
       !Array.isArray(causal.routeCommits)||causal.routeCommits.length!==2)
      return fail('input_invalid');
    // Unreviewed top-level declarations must not bypass the scoped author contract.
    const worldKeys=['schemaVersion','packageId','visibility','warning','ownership',
      'nodes','authoringConstraints','acceptance'];
    const causalKeys=['schema','scope','warning','worldId','sceneContract','routeCommits',
      'npcContinuity','convergence','learning','publicProjection'];
    if(Object.keys(world).some(k=>!worldKeys.includes(k))||
       Object.keys(causal).some(k=>!causalKeys.includes(k)))
      return fail('input_invalid');
    // Public authoring metadata is descriptive, not executable authority.
    const safeText=x=>typeof x==='string'&&x.length>0&&x.length<=240&&x.trim()===x&&
      ![...x].some(c=>c.charCodeAt(0)<32);
    if((world.warning!==undefined&&!safeText(world.warning))||
       (causal.warning!==undefined&&!safeText(causal.warning))||
       (world.ownership!==undefined&&(!exact(world.ownership,['narrative','engineering'])||
         world.ownership.narrative!=='ChatGPT'||world.ownership.engineering!=='Claude'))||
       (world.authoringConstraints!==undefined&&(!Array.isArray(world.authoringConstraints)||
         world.authoringConstraints.length<1||world.authoringConstraints.length>16||
         !world.authoringConstraints.every(safeText)||!unique(world.authoringConstraints)))||
       (causal.sceneContract!==undefined&&
         (typeof causal.sceneContract!=='string'||
          !/^content[/]contracts[/][a-z0-9._-]+[.]json$/.test(causal.sceneContract)||
          (world.packageId==='world01'&&
           causal.sceneContract!=='content/contracts/world01-opening-skeleton.json'))))
      return fail('metadata_invalid');
    const nodes=new Map();
    for(const n of world.nodes){
      if(!obj(n)||!id(n.id)||!Array.isArray(n.next)||n.next.length>8||
         !n.next.every(id)||!unique(n.next)||nodes.has(n.id)||
         Object.keys(n).some(k=>!['id','next','role','learning','worldMutation'].includes(k))||
         (n.role!==undefined&&!id(n.role)))return fail('graph_invalid');
      // Scene metadata is advisory, but it must not claim automatic world effects.
      if(n.worldMutation!==undefined&&!['none','on_commit_only'].includes(n.worldMutation))
        return fail('node_mutation_invalid');
      if(n.learning!==undefined&&(!id(n.learning)||
         ['forced','required','mandatory','auto_complete'].includes(n.learning)))
        return fail('learning_route_gap');
      nodes.set(n.id,n);
    }
    if([...nodes.values()].some(n=>n.next.some(to=>!nodes.has(to))))return fail('graph_invalid');
    const events=causal.routeCommits;
    if(events.some(e=>!exact(e,['id','from','to','cause','effect','repeatPolicy'])||
       !exact(e.cause,['type','sceneId','requiresCommittedTransition'])||
       !exact(e.effect,['type','target','value'])||
       !id(e.id)||!id(e.from)||!id(e.to)||
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
    // A branch advertised as an optional learning opportunity cannot say "none".
    if(events.some(e=>nodes.get(e.to).learning===undefined||nodes.get(e.to).learning==='none'))
      return fail('learning_route_gap');
    const convergence=causal.convergence;
    if(!exact(convergence,['scene','preserve','routeOutcomes'])||!id(convergence.scene)||!nodes.has(convergence.scene)||
       convergence.scene===events[0].from||events.some(e=>e.to===convergence.scene))
      return fail('convergence_invalid');
    // Find the opening from the declared orientation, or a unique graph root.
    const incoming=new Map([...nodes.keys()].map(k=>[k,0]));
    for(const n of nodes.values())for(const to of n.next)incoming.set(to,incoming.get(to)+1);
    const openings=world.nodes.filter(n=>n.role==='orientation');
    const roots=[...incoming].filter(([,count])=>count===0).map(([k])=>k);
    const entry=openings.length===1?openings[0].id:
      openings.length===0&&roots.length===1?roots[0]:null;
    if(!entry||entry===fork.id)return fail('entry_invalid');
    const reachable=new Set(),pending=[entry];
    while(pending.length){
      const cur=pending.pop();
      if(reachable.has(cur))continue;
      reachable.add(cur);pending.push(...nodes.get(cur).next);
    }
    if(reachable.size!==nodes.size)return fail('graph_unreachable');
    // A declared reunion must still have a finite completion route. Optional
    // post-reunion revisits are allowed, but an endless-only world is not.
    const endings=[...nodes.values()].filter(n=>n.next.length===0).map(n=>n.id);
    const afterReunion=new Set(),queue=[convergence.scene];
    while(queue.length){
      const cur=queue.pop();
      if(afterReunion.has(cur))continue;
      afterReunion.add(cur);queue.push(...nodes.get(cur).next);
    }
    if(!endings.some(end=>afterReunion.has(end)))return fail('ending_unreachable');
    // The committed choice must dominate the routes, reunion and ending.
    const visiting=new Set(),visited=new Set();let reachedFork=false;
    const beforeFork=cur=>{
      if(cur===fork.id){reachedFork=true;return false;}
      if(visiting.has(cur))return true;
      if(visited.has(cur))return false;
      const n=nodes.get(cur);
      if(cur===convergence.scene||events.some(e=>e.to===cur)||n.next.length===0)
        return true;
      visiting.add(cur);
      for(const next of n.next)if(beforeFork(next))return true;
      visiting.delete(cur);visited.add(cur);return false;
    };
    if(beforeFork(entry))return fail('choice_bypass');
    if(!reachedFork)return fail('fork_unreachable');
    // Distinct branches must not share a scene before their declared reunion.
    const branchInteriors=[];
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
      // A reachable pre-convergence cycle can postpone the reunion forever,
      // even when every node has an optional path out of the cycle.
      const active=new Set(),complete=new Set();
      const hasCycle=node=>{
        if(active.has(node))return true;
        if(complete.has(node))return false;
        active.add(node);
        for(const next of nodes.get(node).next){
          if(next!==convergence.scene&&hasCycle(next))return true;
        }
        active.delete(node);complete.add(node);
        return false;
      };
      if(hasCycle(start))return fail('route_cycle');
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
      branchInteriors.push(seen);
    }
    if([...branchInteriors[0]].some(node=>branchInteriors[1].has(node)))
      return fail('premature_convergence');
    const npc=causal.npcContinuity;
    if(!obj(npc)||!Array.isArray(npc.transitions)||npc.transitions.length!==2)
      return fail('npc_invalid');
    if(!exact(npc,['actorRef','initial','transitions','claimPromotion']))
      return fail('actorRef' in npc&&'initial' in npc?'npc_invalid':'npc_baseline_invalid');
    // An NPC route reaction is meaningful only from a declared, non-authoritative
    // baseline. A relationship transition cannot smuggle knowledge or availability.
    const initial=npc.initial;
    if(!id(npc.actorRef)||!obj(initial)||
       !equalSet(Object.keys(initial),['location','availability','relation','claimTier'])||
       initial.location!==fork.id||initial.availability!=='available'||
       initial.relation!=='neutral'||initial.claimTier!=='unverified'||
       npc.claimPromotion!=='only_authorized_fact_discovery')
      return fail('npc_baseline_invalid');
    const relations=[];
    for(const e of events){
      const matching=npc.transitions.filter(t=>obj(t)&&t.onCommitted===e.id);
      if(matching.length!==1||!equalSet(Object.keys(matching[0]),['onCommitted','set'])||
         !obj(matching[0].set)||!equalSet(Object.keys(matching[0].set),['relation'])||
         !id(matching[0].set.relation))return fail('npc_invalid');
      relations.push(matching[0].set.relation);
    }
    if(!unique(relations))return fail('npc_consequence_erased');
    if(!Array.isArray(convergence.routeOutcomes)||convergence.routeOutcomes.length!==2||
       convergence.routeOutcomes.some(o=>!exact(o,['routeTrace','npcRelation'])))
      return fail('outcome_invalid');
    for(let i=0;i<2;i++){
      const matched=convergence.routeOutcomes.filter(o=>obj(o)&&
        o.routeTrace===events[i].effect.value&&o.npcRelation===relations[i]);
      if(matched.length!==1)return fail('outcome_invalid');
    }
    if(!unique(convergence.routeOutcomes.map(o=>o.routeTrace)))return fail('outcome_invalid');
    if(!Array.isArray(convergence.preserve)||
       !equalSet(convergence.preserve,['route_trace','npc_relation','committed_event_ids']))
      return fail('memory_erased');
    const learning=causal.learning;
    if(!exact(learning,['scenes','requiresPlayerConsent','allowsNonAcademicProgress',
       'fabricateMeasurements','narrationMayCommitEffects'])||!Array.isArray(learning.scenes)||
       !equalSet(learning.scenes,events.map(e=>e.to))||
       learning.requiresPlayerConsent!==true||learning.allowsNonAcademicProgress!==true||
       learning.fabricateMeasurements!==false||learning.narrationMayCommitEffects!==false)
      return fail('learning_route_gap');
    // Player projection must not expose IDs, uncommitted outcomes or promoted claims.
    const projection=causal.publicProjection;
    if(!exact(projection,['source','claimTierWithoutDiscovery','exposeInternalIds',
       'exposeUncommittedConsequences'])||
       projection.source!=='committed_state_only'||
       projection.claimTierWithoutDiscovery!=='unverified'||
       projection.exposeInternalIds!==false||projection.exposeUncommittedConsequences!==false)
      return fail('projection_invalid');
    // Published acceptance paths are executable mechanical examples, not
    // unchecked prose that can drift away from the committed route graph.
    if(world.acceptance!==undefined){
      const items=world.acceptance;
      if(!Array.isArray(items)||items.length>16||
         items.some(x=>!obj(x)||!id(x.id)||
           (!exact(x,['id','route'])&&!exact(x,['id','require'])))||
         !unique(items.map(x=>x.id))||
         items.some(x=>'require' in x&&
           (typeof x.require!=='string'||x.require.length<1||
            x.require.length>240||x.require.trim()!==x.require||
            [...x.require].some(c=>c.charCodeAt(0)<32))))
        return fail('acceptance_invalid');
      const routes=items.filter(x=>Object.prototype.hasOwnProperty.call(x,'route'));
      if(routes.length!==2||!unique(routes.map(x=>x.id)))
        return fail('acceptance_invalid');
      const covered=[];
      for(const item of routes){
        const path=item.route;
        if(!exact(item,['id','route'])||!id(item.id)||!Array.isArray(path)||
           path.length<4||path.length>nodes.size||!path.every(x=>id(x)&&nodes.has(x))||
           !unique(path)||path[0]!==entry||nodes.get(path[path.length-1]).next.length!==0)
          return fail('acceptance_invalid');
        const forkAt=path.indexOf(fork.id),joinAt=path.indexOf(convergence.scene);
        if(forkAt<1||joinAt<=forkAt+1||
           path.some((x,i)=>i>0&&!nodes.get(path[i-1]).next.includes(x)))
          return fail('acceptance_invalid');
        const branch=path[forkAt+1];
        if(!events.some(e=>e.to===branch)||events.some(e=>e.to!==branch&&path.includes(e.to)))
          return fail('acceptance_invalid');
        covered.push(branch);
      }
      if(!equalSet(covered,events.map(e=>e.to)))return fail('acceptance_invalid');
    }
    return {ok:true,validatedRoutes:2};
  }catch{return fail('input_invalid');}
}
