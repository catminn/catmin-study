const WORLD=/^[a-z][a-z0-9_-]{1,63}$/;
const LOCAL=/^[a-z0-9][a-z0-9._-]{0,79}$/;
const KINDS=new Set(["world","scene","npc","event","knowledge-link"]);
export function validateManifest(m,available) {
 const errors=[];
 if(!m||!WORLD.test(m.worldId||""))return ["invalid_world_id"];
 if(!Number.isSafeInteger(m.manifestRevision)||m.manifestRevision<1)errors.push("invalid_manifest_revision");
 if(!m.globalRulesVersion)errors.push("missing_global_rules");
 const own=(ref)=>{
  if(typeof ref!=="string")return false;
  const parts=ref.split(":");
  return parts.length===2&&parts[0]===m.worldId&&LOCAL.test(parts[1]);
 };
 if(!own(m.startSceneRef)||m.startSceneRef.split(":")[1]!==m.startSceneId)errors.push("invalid_start_scene");
 if(!Array.isArray(m.contentRefs))return [...errors,"missing_content_refs"];
 const seen=new Set();
 for(const e of m.contentRefs){
  if(!KINDS.has(e?.kind)||!own(e?.ref)||!Number.isSafeInteger(e.rev)||e.rev<1){errors.push("invalid_entry");continue;}
  const key=e.kind+":"+e.ref;
  if(seen.has(key))errors.push("duplicate_entry");
  seen.add(key);
  if(Array.isArray(available)&&!available.some(x=>x.kind===e.kind&&x.ref===e.ref&&x.rev===e.rev))errors.push("missing_exact_revision");
 }
 if(!m.contentRefs.some(e=>e.kind==="world"&&e.ref===m.worldId+":world"))errors.push("missing_world_record");
 if(!m.contentRefs.some(e=>e.kind==="scene"&&e.ref===m.startSceneRef))errors.push("missing_start_scene_record");
 return [...new Set(errors)];
}
export function validateAuthoringLinks(manifest,links){
 const errors=[];
 const ids=new Set(manifest.contentRefs.map(x=>x.kind+":"+x.ref));
 for(const [field,kind] of [["sceneRefs","scene"],["npcRefs","npc"],["eventRefs","event"]]){
  if(!Array.isArray(links[field])){errors.push("invalid_"+field);continue;}
  for(const ref of links[field])if(!ids.has(kind+":"+ref))errors.push("unresolved_"+field);
 }
 return [...new Set(errors)];
}
