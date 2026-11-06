import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';

// Isolated author-orchestration unit tests: the three imports are replaced by
// synthetic stubs using Node 22 synchronous module hooks. Real-validator
// integration and full repository CI remain separate checks.
const names = new Map([
  ['./validate-dm-learning-payoff.mjs','validateDmLearningPayoff'],
  ['./validate-dm-payoff-route-reachability.mjs','validateDmPayoffRouteReachability'],
  ['./validate-dm-payoff-dual-route-links.mjs','validateDmPayoffDualRouteLinks'],
]);
registerHooks({resolve(specifier, context, nextResolve) {
  if (!names.has(specifier)) return nextResolve(specifier, context);
  const name = names.get(specifier);
  const code = `export const ${name} = (...args) => globalThis.__dmPayoffStub(${JSON.stringify(name)}, args);`;
  return {url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true};
}});
let sequence = 0;
async function setup(overrides = {}) {
  const calls = [];
  globalThis.__dmPayoffStub = (name, args) => {
    calls.push({name,args});
    return overrides[name] ? overrides[name](...args) : {ok:true};
  };
  const url = new URL('../scripts/validate-dm-payoff-full-preflight.mjs', import.meta.url);
  const mod = await import(url.href+'?unit='+ ++sequence);
  return {check:mod.validateDmPayoffFullPreflight,calls};
}
const sample = () => ({flow:{},chapter:{},alignment:{},actions:{},
  worldGraph:{},links:[{routeBeatId:'demo-a'},{routeBeatId:'demo-b'}],proof:{}});
const fail = (value, code) => {
  assert.deepEqual(value,{ok:false,code});
  assert.doesNotMatch(JSON.stringify(value),/demo|secret|private/i);
};

test('both route links are checked before world reachability',async()=>{
  const {check,calls}=await setup();
  assert.deepEqual(check(sample()),{ok:true,validatedLinks:2,validatedRoutes:2});
  assert.deepEqual(calls.map(x=>x.name),[
    'validateDmPayoffDualRouteLinks','validateDmLearningPayoff',
    'validateDmLearningPayoff','validateDmPayoffRouteReachability']);
  assert.equal(calls[1].args[5].routeBeatId,'demo-a');
  assert.equal(calls[2].args[5].routeBeatId,'demo-b');
});
test('reversing route order still checks each route once',async()=>{
  const {check,calls}=await setup();const input=sample();input.links.reverse();
  assert.equal(check(input).ok,true);
  assert.deepEqual(calls.filter(x=>x.name==='validateDmLearningPayoff')
    .map(x=>x.args[5].routeBeatId),['demo-b','demo-a']);
});
test('a failed cross-route consistency check blocks both single-route checks',async()=>{
  const {check,calls}=await setup({validateDmPayoffDualRouteLinks:()=>({ok:false,code:'secret'})});
  fail(check(sample()),'cross_route_invalid');assert.equal(calls.length,1);
});
test('first failed route stops before second route and world proof',async()=>{
  const {check,calls}=await setup({validateDmLearningPayoff:()=>({ok:false,code:'secret'})});
  fail(check(sample()),'route_link_invalid');assert.equal(calls.length,2);
});
test('a failed second route cannot be hidden by a passing first route',async()=>{
  let count=0;
  const {check,calls}=await setup({validateDmLearningPayoff:()=>({ok:++count===1})});
  fail(check(sample()),'route_link_invalid');assert.equal(calls.length,3);
});
test('a failed world reachability proof blocks approval after both links pass',async()=>{
  const {check,calls}=await setup({validateDmPayoffRouteReachability:()=>({ok:false,code:'secret'})});
  fail(check(sample()),'route_reachability_invalid');assert.equal(calls.length,4);
});
test('only literal ok:true is accepted from any stage',async()=>{
  for (const name of names.values()) {
    const {check}=await setup({[name]:()=>({ok:1})});
    assert.equal(check(sample()).ok,false);
  }
});
test('missing or extra root fields fail closed before invoking validators',async()=>{
  const {check,calls}=await setup();
  for(const input of [null,[],{}, {...sample(),privatePlot:'secret'},
    (()=>{const x=sample();delete x.chapter;return x})()])
    fail(check(input),'input_invalid');
  assert.equal(calls.length,0);
});
test('one link, three links or non-array links cannot silently pass',async()=>{
  const {check,calls}=await setup();
  for(const links of [null,{},[],[{}],[{},{},{}]])
    fail(check({...sample(),links}),'input_invalid');
  assert.equal(calls.length,0);
});
test('malformed getter and thrown validators never leak source values',async()=>{
  const {check}=await setup({validateDmLearningPayoff:()=>{throw Error('secret-identity')}});
  fail(check(sample()),'invalid_input');
  const input=sample();Object.defineProperty(input,'links',{get(){throw Error('private-plot')}});
  fail(check(input),'invalid_input');
});
test('a validator returning undefined fails without throwing',async()=>{
  const {check}=await setup({validateDmPayoffRouteReachability:()=>undefined});
  fail(check(sample()),'invalid_input');
});
