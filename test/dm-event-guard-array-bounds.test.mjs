import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateDmEventGuards} from '../scripts/validate-dm-event-guards.mjs';
// All identifiers below are synthetic. No formal-world content.
const fixture=JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/dm-event-guards-synthetic-v1.json',import.meta.url)),'utf8'));
const fresh=()=>structuredClone(fixture);
const verify=(v,ok,code)=>{
  const before=JSON.stringify(v),result=validateDmEventGuards(v);
  assert.equal(result.ok,ok,JSON.stringify(result));
  if(code)assert.ok(result.codes.includes(code),JSON.stringify(result));
  assert.deepEqual(Object.keys(result).sort(),['codes','errorCount','ok']);
  assert.equal(JSON.stringify(v),before);
  assert.equal(JSON.stringify(result).includes('demo.extra-'),false);
};
const append=(v,n,field,prefix)=>{for(let i=0;i<n;i++)v[field].push(prefix+i);};
test('normal guard sheet remains valid',()=>verify(fresh(),true));
test('128 copy slots remain within budget',()=>{const v=fresh();append(v,123,'publicCopySlots','demo.extra-');verify(v,true);});
test('129 copy slots fail closed',()=>{const v=fresh();append(v,124,'publicCopySlots','demo.extra-');verify(v,false,'invalid_registry');});
test('17 scenes fail closed',()=>{const v=fresh();append(v,13,'scenes','demo.scene-');verify(v,false,'invalid_registry');});
test('13 flags fail closed',()=>{const v=fresh();append(v,9,'flags','demo.flag-');verify(v,false,'invalid_registry');});
for(const [group,field] of [['guard','all'],['guard','none'],['effects','set'],['effects','clear']]){
  test('oversized '+group+'.'+field+' fails closed without echo',()=>{
    const v=fresh();
    v.transitions[1][group][field]=Array.from({length:30000},(_,i)=>'demo.extra-'+i);
    verify(v,false,'invalid_transition');
  });
}
