/**
 * Local-only, synthetic DM authoring preflight CLI.
 * Read one JSON object from stdin; emit only a fixed, non-spoiler result.
 * Never reads private story files, writes state, or authorizes import.
 */
import {TextDecoder} from 'node:util';
import {validateDmAuthoringPreflight} from './validate-dm-authoring-preflight.mjs';

const MAX_BYTES=1024*1024;
const SAFE_CODES=new Set([
  'input_invalid','event_guard_invalid','learning_payoff_invalid',
  'route_crosswalk_invalid','invalid_input'
]);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=code=>({ok:false,code});
function output(result){
  process.stdout.write(JSON.stringify(result)+'\n');
  if(result.ok!==true)process.exitCode=1;
}
function isSynthetic(input){
  return object(input)&&object(input.flow)&&input.flow.synthetic===true&&
    object(input.guards)&&input.guards.synthetic===true&&
    object(input.bridge)&&input.bridge.synthetic===true&&
    object(input.alignment)&&input.alignment.synthetic===true&&
    object(input.proof)&&input.proof.synthetic===true&&
    object(input.actions)&&input.actions.scope==='synthetic-mechanics-only'&&
    Array.isArray(input.links)&&input.links.length===2&&
    input.links.every(x=>object(x)&&x.synthetic===true);
}
async function main(){
  if(process.argv.length!==2){output(fail('arguments_invalid'));return;}
  const chunks=[];
  let bytes=0;
  try{
    for await(const chunk of process.stdin){
      bytes+=chunk.length;
      if(bytes>MAX_BYTES){output(fail('input_too_large'));return;}
      chunks.push(chunk);
    }
  }catch{output(fail('input_unreadable'));return;}
  let input;
  try{
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    input=JSON.parse(raw);
  }catch{output(fail('json_invalid'));return;}
  if(!isSynthetic(input)){output(fail('synthetic_required'));return;}
  let result;
  try{result=validateDmAuthoringPreflight(input);}
  catch{output(fail('preflight_failed'));return;}
  if(result?.ok===true&&result.validatedRoutes===2&&result.validatedLinks===2){
    output({ok:true,validatedRoutes:2,validatedLinks:2});
  }else{
    output(fail(SAFE_CODES.has(result?.code)?result.code:'preflight_failed'));
  }
}
await main();
