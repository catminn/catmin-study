import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Synthetic reference only. DUNGEON_PROJECTOR_MODULE may point to a real module.
function referenceProjectDungeon(d, verified) {
  const done = (ch, i) => (ch.practice ?? []).every((q,j) => verified.has(i + '|' + (q.id ?? 'c' + (j+1))));
  let n = 0; while (n < d.ch.length && done(d.ch[n], n)) n++;
  const current = Math.min(n, d.ch.length - 1);
  const cast = (d.cast ?? []).filter(x => {
    if (!Array.isArray(x) || x.length !== 4 || typeof x[0] !== 'string' || typeof x[1] !== 'string' || typeof x[2] !== 'string' || !Number.isInteger(x[3]) || x[3] < 0 || x[3] >= d.ch.length) throw Error('invalid cast');
    return x[3] <= current;
  }).map(x => [x[0], x[1], null, x[3]]);
  const ch = d.ch.map((x,i) => i > current ? {t:x.t} : {
    t:x.t, k:x.k,
    practice:(x.practice ?? []).map((q,j) => ({id:q.id ?? 'c'+(j+1),q:q.q})),
    ...(x.skill ? {skill:{id:x.skill.id,name:x.skill.name,effect:x.skill.effect}} : {})
  });
  const fork = d.fork?.ch === current ? {ch:d.fork.ch,t:d.fork.t,q:d.fork.q,price:d.fork.price} : null;
  return {id:d.id,name:d.name,desc:d.desc,cast,ch,fork};
}
const path = process.env.DUNGEON_PROJECTOR_MODULE;
const projectDungeon = path ? (await import(pathToFileURL(resolve(path)).href)).projectDungeon : referenceProjectDungeon;
if (typeof projectDungeon !== 'function') throw Error('projectDungeon export required');
const make = () => ({
  id:'synthetic',name:'Public title',desc:'Public description',
  pre:'PRIVATE_PRE',recap:'PRIVATE_RECAP',zero:'PRIVATE_ZERO',clear:'PRIVATE_CLEAR',hidden:'PRIVATE_HIDDEN',
  cast:[['Guide','Public role','PRIVATE_CAST_SECRET',0],['Late visitor','Public role','PRIVATE_LATE_SECRET',2]],
  fork:{ch:1,t:'Public fork prompt',q:'Public fork question',b:'PRIVATE_ALTERNATE',price:1},
  ch:[
    {t:'Chapter 0',k:'Topic 0',s:'PRIVATE_SCRIPT_0',sb:'PRIVATE_BRANCH_0',tn:'PRIVATE_THREAT_0',skill:{id:'skill0',name:'Skill 0',effect:'Public effect'},practice:[{id:'q0',q:'Question 0',a:'PRIVATE_ANSWER_0',hint:'PRIVATE_HINT_0'}]},
    {t:'Chapter 1',k:'PRIVATE_FUTURE_TOPIC',s:'PRIVATE_SCRIPT_1',sb:'PRIVATE_BRANCH_1',tn:'PRIVATE_THREAT_1',skill:{id:'skill1',name:'PRIVATE_FUTURE_SKILL',effect:'PRIVATE_FUTURE_EFFECT'},practice:[{id:'q1',q:'PRIVATE_FUTURE_QUESTION',a:'PRIVATE_ANSWER_1',hint:'PRIVATE_HINT_1'}]},
    {t:'Chapter 2',k:'Topic 2',s:'PRIVATE_SCRIPT_2',sb:'PRIVATE_BRANCH_2',tn:'PRIVATE_THREAT_2',practice:[{id:'q2',q:'Question 2',a:'PRIVATE_ANSWER_2',hint:'PRIVATE_HINT_2'}]}
  ]
});
const show = (v=new Set(),d=make()) => projectDungeon(d,v);
const raw = x => JSON.stringify(x);
test('cast tuple public name/role and zero-based reveal',()=>{const c=show().cast;assert.equal(c.length,1);assert.equal(c[0][0],'Guide');assert.equal(c[0][1],'Public role');assert.equal(c[0][3],0)});
test('revealed NPC secret excluded',()=>assert.doesNotMatch(raw(show()),/PRIVATE_CAST_SECRET/));
test('future NPC name and secret excluded',()=>assert.doesNotMatch(raw(show()),/Late visitor|PRIVATE_LATE_SECRET/));
test('current author scripts and threats excluded',()=>assert.doesNotMatch(raw(show()),/PRIVATE_SCRIPT_0|PRIVATE_BRANCH_0|PRIVATE_THREAT_0/));
test('future author text, topic, question and skill excluded',()=>assert.doesNotMatch(raw(show()),/PRIVATE_SCRIPT_1|PRIVATE_FUTURE_/));
test('current question present, answer and hint absent',()=>{const s=raw(show());assert.match(s,/Question 0/);assert.doesNotMatch(s,/PRIVATE_ANSWER_0|PRIVATE_HINT_0/)});
test('director-only top fields excluded',()=>assert.doesNotMatch(raw(show()),/PRIVATE_PRE|PRIVATE_RECAP|PRIVATE_ZERO|PRIVATE_CLEAR|PRIVATE_HIDDEN/));
test('alternate fork ending excluded even when fork offered',()=>assert.doesNotMatch(raw(show(new Set(['0|q0']))),/PRIVATE_ALTERNATE/));
test('chapter 1 unlock exposes question but no answer, hint or script',()=>{const s=raw(show(new Set(['0|q0'])));assert.match(s,/PRIVATE_FUTURE_QUESTION/);assert.doesNotMatch(s,/PRIVATE_ANSWER_1|PRIVATE_HINT_1|PRIVATE_SCRIPT_1/)});
test('later NPC appears only at chapter 2, never with secret',()=>{const s=raw(show(new Set(['0|q0','1|q1'])));assert.match(s,/Late visitor/);assert.doesNotMatch(s,/PRIVATE_LATE_SECRET/)});
test('completion never dumps director fields',()=>assert.doesNotMatch(raw(show(new Set(['0|q0','1|q1','2|q2']))),/PRIVATE_(PRE|RECAP|ZERO|CLEAR|HIDDEN|SCRIPT|BRANCH|THREAT|ANSWER|HINT|CAST_SECRET|LATE_SECRET)/));
test('projection does not mutate author record',()=>{const d=make(),before=raw(d);show(new Set(['0|q0']),d);assert.equal(raw(d),before)});
test('invalid cast tuple fails closed',()=>{const d=make();d.cast[0][3]='0';assert.throws(()=>show(new Set(),d))});
