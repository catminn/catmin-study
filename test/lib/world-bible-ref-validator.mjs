export const WORLD_ID=/^[a-z][a-z0-9_-]{1,63}$/;
export const LOCAL_ID=/^[a-z0-9][a-z0-9._-]{0,79}$/;
export function qualify(worldId,localId){
 if(!WORLD_ID.test(worldId)||!LOCAL_ID.test(localId))throw new Error("invalid_world_reference");
 return worldId+":"+localId;
}
export function resolveInWorld(worldId,ref){
 if(!WORLD_ID.test(worldId)||typeof ref!=="string")return {ok:false,error:"invalid_world_reference"};
 const i=ref.indexOf(":");
 if(i<=0||i!==ref.lastIndexOf(":"))return {ok:false,error:"unqualified_reference"};
 const owner=ref.slice(0,i),localId=ref.slice(i+1);
 if(owner!==worldId)return {ok:false,error:"cross_world_reference"};
 if(!LOCAL_ID.test(localId))return {ok:false,error:"invalid_local_id"};
 return {ok:true,worldId,localId};
}
export function validateWorldManifest(manifest){
 const errors=[];
 if(!manifest||!WORLD_ID.test(manifest.worldId||""))return ["invalid_world_id"];
 if(!Number.isSafeInteger(manifest.revision)||manifest.revision<1)errors.push("invalid_revision");
 if(!manifest.globalRulesVersion)errors.push("missing_global_rules_version");
 const keys=["startSceneRef"],lists=["scenes","npcs","events","endings"];
 for(const key of keys)if(!resolveInWorld(manifest.worldId,manifest[key]).ok)errors.push("invalid_"+key);
 for(const key of lists){
  if(!Array.isArray(manifest[key])){errors.push("invalid_"+key);continue;}
  const refs=new Set();
  for(const ref of manifest[key]){
   const resolved=resolveInWorld(manifest.worldId,ref);
   if(!resolved.ok)errors.push("invalid_"+key+"_ref");
   if(refs.has(ref))errors.push("duplicate_"+key+"_ref");
   refs.add(ref);
  }
 }
 if(Array.isArray(manifest.scenes)&&!manifest.scenes.includes(manifest.startSceneRef))errors.push("missing_start_scene");
 return [...new Set(errors)];
}
export function checkRunBinding(run,worldManifest){
 if(!run||!worldManifest||run.worldId!==worldManifest.worldId)return {ok:false,error:"world_mismatch"};
 if(run.canonicalRevision!==worldManifest.revision)return {ok:false,error:"revision_mismatch"};
 if(!run.sessionId)return {ok:false,error:"missing_session"};
 return {ok:true};
}
export function validateMigration(fromRun,fromManifest,toManifest,explicitAuthorization){
 if(!explicitAuthorization)return {ok:false,error:"migration_not_authorized"};
 if(!checkRunBinding(fromRun,fromManifest).ok)return {ok:false,error:"invalid_source"};
 if(fromManifest.worldId!==toManifest.worldId)return {ok:false,error:"cross_world_migration_disallowed"};
 if(validateWorldManifest(toManifest).length)return {ok:false,error:"invalid_target_manifest"};
 return {ok:true,requiresStateMappingAndRollback:true};
}
