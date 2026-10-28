import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const scriptPath=fileURLToPath(new URL('../scripts/audit-legacy-save.mjs',import.meta.url));
import {auditExport} from '../scripts/audit-legacy-save.mjs';
test('audit export preserves original, full ledger and prohibits overwrite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zhushen-audit-'));
 try{
 const source=join(dir,'original.json'),backup=join(dir,'backup.json');
 const old={v:2,points:34,ledger:Array.from({length:525},(_,i)=>({at:i,d:1,t:'test'})),mistakes:[],resetTag:'r1',chatReset:'c1',sagaTag:'s1'};
 const raw=JSON.stringify(old);await writeFile(source,raw);
 const report=await auditExport(source,backup);
 assert.equal(report.verified,true);
 assert.equal(report.inspection.ledgerEntries,525);
 assert.deepEqual(JSON.parse((await readFile(backup,'utf8'))).original,old);
 assert.equal(await readFile(source,'utf8'),raw);
 assert.equal((await stat(backup)).mode&0o077,0);
 await assert.rejects(()=>auditExport(source,backup),/EEXIST/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('audit refuses overwriting the original source path',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zhushen-audit-'));
 try{const source=join(dir,'source.json');await writeFile(source,'{}');await assert.rejects(()=>auditExport(source,source),/distinct/)}
 finally{await rm(dir,{recursive:true,force:true})}
});

test('audit CLI writes a backup when executed directly',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zhushen-audit-cli-'));
 try{
  const source=join(dir,'source.json'),backup=join(dir,'backup.json');
  await writeFile(source,JSON.stringify({v:2,points:0,ledger:[],mistakes:[],resetTag:'r1',chatReset:'c1',sagaTag:'s1'}));
  const result=spawnSync(process.execPath,[scriptPath,source,backup],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(result.stdout).verified,true);
  assert.equal(JSON.parse(await readFile(backup,'utf8')).original.points,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});
