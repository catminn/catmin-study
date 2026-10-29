/** Synthetic, spoiler-free author-side causal guard preflight. Never import into a live world. */
import {readFileSync} from 'node:fs';
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,ks)=>object(x)&&Object.keys(x).length===ks.length&&ks.every(k=>own(x,k));
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9._-]{0,79}$/.test(x);
const ids=x=>Array.isArray(x)&&x.every(id)&&new Set(x).size===x.length;
const done=e=>({ok:e.size===0,codes:[...e].sort(),errorCount:e.size});
const ROOT=['schemaVersion','synthetic','worldId','manifestRevision','startScene','forkScene','mergeScene','endScene','scenes','flags','transitions','routes','publicCopySlots'];
const TRANS=['id','from','to','mode','guard','effects','eventRef','copySlot'];
const ROUTE=['choiceTransitionId','routeFlag','callbackTransitionId','callbackFlag'];
const GUARD=['all','none'];
const EFFECT=['set','clear'];
const MAX_STATES=128;
const key=s=>`${s.scene}|${[...s.flags].sort().join(',')}`;
const enabled=(s,t)=>t.guard.all.every(x=>s.flags.has(x))&&t.guard.none.every(x=>!s.flags.has(x));
const move=(s,t)=>({scene:t.to,flags:new Set([...s.flags].filter(x=>!t.effects.clear.includes(x)).concat(t.effects.set))});

export function validateDmEventGuards(v){
 const e=new Set(),fail=x=>e.add(x);
 if(!exact(v,ROOT))return done(new Set(['invalid_root']));
 if(v.schemaVersion!=='dm-event-guards-v1'||v.synthetic!==true||![v.worldId,v.manifestRevision,v.startScene,v.forkScene,v.mergeScene,v.endScene].every(id))fail('invalid_schema');
 if(!ids(v.scenes)||v.scenes.length<4||v.scenes.length>16||!ids(v.flags)||v.flags.length>12||!ids(v.publicCopySlots))fail('invalid_registry');
 if(!Array.isArray(v.transitions)||v.transitions.length<5||v.transitions.length>48||!Array.isArray(v.routes)||v.routes.length!==2)return done(new Set([...e,'invalid_structure']));
 if(e.size)return done(e);
 const order=new Map(v.scenes.map((s,i)=>[s,i])),flags=new Set(v.flags),copies=new Set(v.publicCopySlots);
 if(new Set([v.startScene,v.forkScene,v.mergeScene,v.endScene]).size!==4||![v.startScene,v.forkScene,v.mergeScene,v.endScene].every(s=>order.has(s))||!(order.get(v.startScene)<order.get(v.forkScene)&&order.get(v.forkScene)<order.get(v.mergeScene)&&order.get(v.mergeScene)<order.get(v.endScene)))fail('invalid_scene_order');
 const transitions=new Map(),events=new Set(),slots=new Set();
 for(const t of v.transitions){
  if(!exact(t,TRANS)||!id(t.id)||!id(t.from)||!id(t.to)||!['commit','ask','preview'].includes(t.mode)||!exact(t.guard,GUARD)||!exact(t.effects,EFFECT)||!ids(t.guard.all)||!ids(t.guard.none)||!ids(t.effects.set)||!ids(t.effects.clear)){fail('invalid_transition');continue;}
  if(transitions.has(t.id))fail('duplicate_transition');
  transitions.set(t.id,t);
  if(![...t.guard.all,...t.guard.none,...t.effects.set,...t.effects.clear].every(x=>flags.has(x))||t.guard.all.some(x=>t.guard.none.includes(x))||t.effects.set.some(x=>t.effects.clear.includes(x)))fail('invalid_flag_logic');
  if(!order.has(t.from)||!order.has(t.to))fail('unknown_scene');
  if(t.mode==='commit'){
   if(!id(t.eventRef)||!id(t.copySlot))fail('invalid_commit_metadata');
   else{
    if(events.has(t.eventRef)||slots.has(t.copySlot))fail('event_or_copy_alias');
    events.add(t.eventRef);slots.add(t.copySlot);
    if(!copies.has(t.copySlot))fail('unregistered_public_copy');
   }
   if(order.has(t.from)&&order.has(t.to)&&order.get(t.from)>=order.get(t.to))fail('nonprogressing_commit');
  }else if(t.from!==t.to||t.eventRef!==null||t.copySlot!==null||t.effects.set.length||t.effects.clear.length)fail('preview_side_effect');
 }
 if(e.size)return done(e);
 const routeFlags=new Set(),callbackFlags=new Set(),choices=new Set(),callbacks=new Set();
 for(const r of v.routes){
  if(!exact(r,ROUTE)||!Object.values(r).every(id)){fail('invalid_route');continue;}
  if(routeFlags.has(r.routeFlag)||callbackFlags.has(r.callbackFlag)||choices.has(r.choiceTransitionId)||callbacks.has(r.callbackTransitionId))fail('route_alias');
  routeFlags.add(r.routeFlag);callbackFlags.add(r.callbackFlag);choices.add(r.choiceTransitionId);callbacks.add(r.callbackTransitionId);
 }
 if(e.size)return done(e);
 if([...routeFlags,...callbackFlags].some(x=>!flags.has(x))||new Set([...routeFlags,...callbackFlags]).size!==4)fail('invalid_route_flags');
 for(const r of v.routes){
  const a=transitions.get(r.choiceTransitionId),b=transitions.get(r.callbackTransitionId),other=v.routes.find(x=>x!==r);
  if(!a||a.mode!=='commit'||a.from!==v.forkScene||a.to!==v.mergeScene||!a.effects.set.includes(r.routeFlag)||a.guard.none.some(x=>!routeFlags.has(x))||!([...routeFlags].every(x=>a.guard.none.includes(x))))fail('invalid_choice_guard');
  if(!b||b.mode!=='commit'||b.from!==v.mergeScene||b.to!==v.endScene||!b.guard.all.includes(r.routeFlag)||!b.guard.none.includes(other.routeFlag)||!b.effects.set.includes(r.callbackFlag))fail('invalid_callback_guard');
 }
 for(const t of transitions.values()){
  if(t.mode==='commit'&&((t.from===v.forkScene&&!choices.has(t.id))||(t.from===v.mergeScene&&!callbacks.has(t.id))))fail('unmapped_branch_action');
  if([...routeFlags].some(x=>t.effects.clear.includes(x))||[...callbackFlags].some(x=>t.effects.clear.includes(x)))fail('route_memory_erased');
  if([...routeFlags].some(x=>t.effects.set.includes(x))&&!choices.has(t.id))fail('route_flag_forged');
  if([...callbackFlags].some(x=>t.effects.set.includes(x))&&!callbacks.has(t.id))fail('callback_flag_forged');
 }
 if(e.size)return done(e);
 const states=new Map(),edges=new Map(),queue=[],usedTransitions=new Set();
 const initial={scene:v.startScene,flags:new Set()};states.set(key(initial),initial);queue.push(initial);
 while(queue.length&&states.size<=MAX_STATES){
  const s=queue.shift(),k=key(s),out=[];
  for(const t of transitions.values()){
   if(t.mode!=='commit'||t.from!==s.scene||!enabled(s,t))continue;
   usedTransitions.add(t.id);
   const next=move(s,t),nk=key(next);out.push(nk);
   if(!states.has(nk)){states.set(nk,next);queue.push(next);}
  }
  edges.set(k,out);
  if(s.scene!==v.endScene&&!out.length)fail('reachable_softlock');
  if(s.scene===v.endScene&&out.length)fail('terminal_not_terminal');
 }
 if(states.size>MAX_STATES)fail('state_explosion');
 if([...transitions.values()].some(t=>t.mode==='commit'&&!usedTransitions.has(t.id)))fail('unreachable_action');
 for(const scene of v.scenes)if(![...states.values()].some(s=>s.scene===scene))fail('unreachable_scene');
 const endKeys=[...states].filter(([k,s])=>s.scene===v.endScene).map(([k])=>k),canFinish=new Set(endKeys);
 let changed=true;
 while(changed){changed=false;for(const [k,outs] of edges)if(!canFinish.has(k)&&outs.some(x=>canFinish.has(x))){canFinish.add(k);changed=true;}}
 if([...states.keys()].some(k=>!canFinish.has(k)))fail('no_terminal_path');
 const joinStates=[...states.values()].filter(s=>s.scene===v.mergeScene);
 if(joinStates.length!==2||v.routes.some(r=>!joinStates.some(s=>s.flags.has(r.routeFlag)&&!s.flags.has(v.routes.find(x=>x!==r).routeFlag))))fail('route_not_preserved');
 if(endKeys.length!==2||v.routes.some(r=>!endKeys.some(k=>{const s=states.get(k),other=v.routes.find(x=>x!==r);return s.flags.has(r.routeFlag)&&s.flags.has(r.callbackFlag)&&!s.flags.has(other.routeFlag)&&!s.flags.has(other.callbackFlag);})))fail('callback_cross_route');
 return done(e);
}

/** Isolated author reference only. No authentication, persistence, or runtime effect. */
export function applySyntheticGuardAction(state,t,request){
 const no=(code)=>({ok:false,code,state});
 if(!object(state)||!(state.flags instanceof Set)||!object(t)||!object(request))return no('invalid_request');
 if(request.mode==='ask'||request.mode==='preview')return {ok:true,committed:false,replay:false,state};
 if(request.mode!=='commit'||request.source!=='server'||!id(request.commitId))return no('untrusted_request');
 if(!object(state.applied)||!exact(t,TRANS)||!exact(t.guard,GUARD)||!exact(t.effects,EFFECT)||!ids(t.guard.all)||!ids(t.guard.none)||!ids(t.effects.set)||!ids(t.effects.clear))return no('invalid_request');
 if(own(state.applied,request.commitId))return state.applied[request.commitId]===t.id?{ok:true,committed:false,replay:true,state}:no('commit_conflict');
 if(!Number.isSafeInteger(state.version)||request.expectedVersion!==state.version)return no('stale_version');
 if(t.mode!=='commit'||t.from!==state.scene||!enabled(state,t))return no('guard_denied');
 const next=move(state,t);
 return {ok:true,committed:true,replay:false,state:{...next,version:state.version+1,applied:{...state.applied,[request.commitId]:t.id}}};
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
 try{const v=JSON.parse(readFileSync(process.argv[2],'utf8'));const r=validateDmEventGuards(v);process.stdout.write(JSON.stringify(r)+'\n');if(!r.ok)process.exitCode=1;}
 catch{process.stdout.write('{"ok":false,"codes":["invalid_input"],"errorCount":1}\n');process.exitCode=1;}
}
