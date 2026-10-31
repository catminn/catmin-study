import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const cli=new URL('../scripts/check-dm-authoring-json.mjs',import.meta.url);
const run=(input,args=[])=>{
  const p=spawnSync(process.execPath,[cli.pathname,...args],{
    input,encoding:'utf8',maxBuffer:2*1024*1024
  });
  assert.equal(p.error,undefined);
  assert.equal(p.stderr,'');
  const lines=p.stdout.trim().split('\n');
  assert.equal(lines.length,1);
  const result=JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(result).sort(),['code','ok']);
  assert.equal(result.ok,false);
  assert.equal(p.status,1);
  assert.doesNotMatch(p.stdout,/secret|private|demo|trace|story/i);
  return result.code;
};

test('malformed JSON returns only a fixed code',()=>{
  assert.equal(run('{"secret":"private",'),'json_invalid');
});
test('empty stdin fails closed',()=>{
  assert.equal(run(''),'json_invalid');
});
test('invalid UTF-8 fails closed',()=>{
  const p=spawnSync(process.execPath,[cli.pathname],{
    input:Buffer.from([0xff,0xfe]),encoding:'utf8'
  });
  assert.equal(p.status,1);
  assert.equal(p.stderr,'');
  assert.deepEqual(JSON.parse(p.stdout),{ok:false,code:'json_invalid'});
});
test('unreviewed CLI arguments are rejected',()=>{
  assert.equal(run('{}',['--verbose']),'arguments_invalid');
});
test('real-shaped input without synthetic markers is rejected',()=>{
  assert.equal(run(JSON.stringify({flow:{secret:'private'}})),'synthetic_required');
});
test('missing a synthetic marker is rejected',()=>{
  const x={flow:{synthetic:true},guards:{synthetic:true},
    bridge:{synthetic:true},alignment:{synthetic:true},
    proof:{synthetic:true},actions:{scope:'synthetic-mechanics-only'},
    links:[{synthetic:true},{synthetic:false}]};
  assert.equal(run(JSON.stringify(x)),'synthetic_required');
});
test('synthetic-shaped but incomplete authoring data reaches the validator',()=>{
  const x={flow:{synthetic:true},guards:{synthetic:true},
    bridge:{synthetic:true},alignment:{synthetic:true},
    proof:{synthetic:true},actions:{scope:'synthetic-mechanics-only'},
    links:[{synthetic:true},{synthetic:true}]};
  assert.equal(run(JSON.stringify(x)),'input_invalid');
});
test('oversized JSON is rejected without echo',()=>{
  assert.equal(run(JSON.stringify({secret:'private'.repeat(160000)})),'input_too_large');
});
test('JSON with prototype-looking keys is not treated as approval',()=>{
  assert.equal(run('{"__proto__":{"synthetic":true}}'),'synthetic_required');
});
