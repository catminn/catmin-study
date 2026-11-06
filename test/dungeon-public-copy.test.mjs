import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Synthetic reference only. Set DUNGEON_PUBLIC_PROJECTOR_MODULE to a real module
// exporting projectDungeon(dungeon, verifiedSet, grants) for implementation checks.
function referenceProjectDungeon(d, verified, grants = {}) {
  const approved = (obj, keys) => {
    if (obj === undefined) return {};
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error('invalid_pub');
    for (const [key, value] of Object.entries(obj)) {
      if (!keys.includes(key) || typeof value !== 'string' || [...value].length < 1 || [...value].length > 1200 || /[\x00-\x1f\x7f]|⟦DG:/.test(value)) throw Error('invalid_pub');
    }
    return obj;
  };
  const top = approved(d.pub, ['open','clear','zero','hidden']);
  const done = (ch, i) => (ch.practice ?? []).every((q,j) => verified.has(i+'|'+(q.id ?? 'c'+(j+1))));
  let reach = 0; while (reach < d.ch.length && done(d.ch[reach], reach)) reach++;
  const current = Math.min(reach, d.ch.length - 1), allDone = reach === d.ch.length;
  const ownGrant = grants?.dungeonId === d.id;
  const pub = {};
  if (top.open !== undefined) pub.open = top.open;
  if (allDone && top.clear !== undefined) pub.clear = top.clear;
  if (allDone && ownGrant && grants.zeroUnlocked === true && top.zero !== undefined) pub.zero = top.zero;
  if (ownGrant && grants.hiddenUnlocked === true && top.hidden !== undefined) pub.hidden = top.hidden;
  const ch = d.ch.map((x,i) => {
    const p = approved(x.pub, ['intro','recap']);
    const cp = {};
    if (i <= current && p.intro !== undefined) cp.intro = p.intro;
    if (i <= current && done(x,i) && p.recap !== undefined) cp.recap = p.recap;
    return {t:x.t, pub:cp};
  });
  return {id:d.id, pub, ch};
}
const path = process.env.DUNGEON_PUBLIC_PROJECTOR_MODULE;
const projectDungeon = path ? (await import(pathToFileURL(resolve(path)).href)).projectDungeon : referenceProjectDungeon;
if (typeof projectDungeon !== 'function') throw Error('projectDungeon export required');
const make = () => ({
  id:'synthetic-one', pre:'DIRECTOR_PRE', clear:'DIRECTOR_CLEAR', zero:'DIRECTOR_ZERO', hidden:'DIRECTOR_HIDDEN', recap:'DIRECTOR_RECAP',
  pub:{open:'Approved arrival',clear:'Approved finish',zero:'Approved memory',hidden:'Approved hidden reward'},
  ch:[
    {t:'Chapter 0',s:'DIRECTOR_SCRIPT_0',tn:'DIRECTOR_THREAT_0',pub:{intro:'Approved chapter 0',recap:'Approved recap 0'},practice:[{id:'q0',a:'DIRECTOR_ANSWER_0'}]},
    {t:'Chapter 1',s:'DIRECTOR_SCRIPT_1',pub:{intro:'Approved chapter 1',recap:'Approved recap 1'},practice:[{id:'q1',a:'DIRECTOR_ANSWER_1'}]}
  ]
});
const show = (verified = new Set(), grants = {}, d = make()) => projectDungeon(d, verified, grants);
const raw = v => JSON.stringify(v);
const complete = new Set(['0|q0','1|q1']);
test('opening is approved public copy only', () => assert.equal(show().pub.open,'Approved arrival'));
test('raw top director fields never leak', () => assert.doesNotMatch(raw(show()),/DIRECTOR_(PRE|CLEAR|ZERO|HIDDEN|RECAP)/));
test('current chapter intro appears', () => assert.equal(show().ch[0].pub.intro,'Approved chapter 0'));
test('future chapter intro and recap are absent', () => assert.deepEqual(show().ch[1].pub,{}));
test('unverified current chapter recap absent', () => assert.equal(show().ch[0].pub.recap,undefined));
test('verified chapter recap appears', () => assert.equal(show(new Set(['0|q0'])).ch[0].pub.recap,'Approved recap 0'));
test('next chapter intro only after persisted verification', () => assert.equal(show(new Set(['0|q0'])).ch[1].pub.intro,'Approved chapter 1'));
test('clear absent until all chapters verified', () => assert.equal(show(new Set(['0|q0'])).pub.clear,undefined));
test('clear present after completion', () => assert.equal(show(complete).pub.clear,'Approved finish'));
test('zero requires both completion and scoped persisted grant', () => {assert.equal(show(complete).pub.zero,undefined);assert.equal(show(new Set(['0|q0']),{dungeonId:'synthetic-one',zeroUnlocked:true}).pub.zero,undefined);assert.equal(show(complete,{dungeonId:'synthetic-one',zeroUnlocked:true}).pub.zero,'Approved memory')});
test('hidden requires a separate scoped event, not chapter completion', () => {assert.equal(show(complete).pub.hidden,undefined);assert.equal(show(new Set(),{dungeonId:'synthetic-one',hiddenUnlocked:true}).pub.hidden,'Approved hidden reward')});
test('grants for a different dungeon cannot unlock this one', () => {const p=show(complete,{dungeonId:'synthetic-two',zeroUnlocked:true,hiddenUnlocked:true}).pub;assert.equal(p.zero,undefined);assert.equal(p.hidden,undefined)});
test('director fields and unreached scripts absent even at completion', () => assert.doesNotMatch(raw(show(complete,{dungeonId:'synthetic-one',zeroUnlocked:true,hiddenUnlocked:true})),/DIRECTOR_/));
test('no fallback when pub absent', () => {const d=make();delete d.pub;delete d.ch[0].pub;assert.deepEqual(show(new Set(),{},d).pub,{});assert.deepEqual(show(new Set(),{},d).ch[0].pub,{})});
test('unknown pub keys fail closed', () => {const d=make();d.pub.leak='x';assert.throws(()=>show(new Set(),{},d))});
test('invalid pub values and director markers fail closed', () => {for (const bad of ['',12,'⟦DG:pre:synthetic⟧','bad\nline']) {const d=make();d.ch[0].pub.intro=bad;assert.throws(()=>show(new Set(),{},d))}});
test('author object remains immutable', () => {const d=make(),before=raw(d);show(complete,{dungeonId:'synthetic-one',zeroUnlocked:true,hiddenUnlocked:true},d);assert.equal(raw(d),before)});
