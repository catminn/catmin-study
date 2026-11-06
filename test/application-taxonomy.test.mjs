import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
const t=JSON.parse(readFileSync(new URL('../content/contracts/application-taxonomy-v1.json',import.meta.url),'utf8'));
const ids=new Set(t.tags);
test('tag IDs unique and namespaced',()=>{
 assert.equal(ids.size,t.tags.length);
 assert.equal(t.tags.length,25);
 for(const id of ids)assert.match(id,/^[a-z]+\.[a-z][a-z0-9-]+$/);
});
test('old application tags map to stable IDs',()=>{
 for(const value of Object.values(t.legacyAliases))assert.ok(ids.has(value));
});
test('course packs only use registered applications',()=>{
 for(const [id,apps] of Object.entries(t.courseExamples)){
 assert.match(id,/^[a-z0-9]+$/);
 for(const app of apps)assert.ok(ids.has(app));
 }
});
test('tags are course-independent: multiple courses can reuse one narrative application',()=>{
 assert.ok(t.courseExamples.cs2800.includes('networks.trace-reachability'));
 assert.ok(t.courseExamples.cs2110.includes('networks.trace-reachability'));
});
test('gameplay gates disallow forced math and invented evidence',()=>{
 assert.ok(t.gates.some(x=>x.includes('visibly authorized')));
 assert.ok(t.gates.some(x=>x.includes('not declined')));
 assert.ok(t.gates.some(x=>x.includes('invented measurement')));
});
