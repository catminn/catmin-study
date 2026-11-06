import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {validateDmNpcRouteBridge} from '../scripts/validate-dm-npc-route-bridge.mjs';
import {policy} from '../scripts/npc-testimony-reference.mjs';

const flow = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/dm-npc-route-synthetic-v1.json',import.meta.url)),'utf8'));
const p=structuredClone(policy);
p.routes['demo-a'].trace='demo.trace-a';
p.routes['demo-b'].trace='demo.trace-b';
const binding={schemaVersion:'dm-npc-route-bridge-v1',synthetic:true,worldId:'demo-world',manifestRevision:'demo-r1',choiceBeatId:'demo-fork',convergenceBeatId:'demo-join',routeBindings:[
  {routeBeatId:'demo-route-a',npcRouteKey:'demo-a',traceRef:'demo.trace-a',callbackCopySlot:'demo.callback-a',dialogueCopyId:'demo-guarded'},
  {routeBeatId:'demo-route-b',npcRouteKey:'demo-b',traceRef:'demo.trace-b',callbackCopySlot:'demo.callback-b',dialogueCopyId:'demo-open'}
]};
const run=(f=flow,n=p,b=binding)=>validateDmNpcRouteBridge(f,n,b);
const clone=x=>structuredClone(x);
const change=(which,fn)=>{const f=clone(flow),n=clone(p),b=clone(binding);fn({f,n,b});return run(f,n,b);};
const expectFail=(name,fn,code)=>test(name,()=>{const r=change(name,fn);assert.equal(r.ok,false);assert.ok(r.codes.includes(code),JSON.stringify(r));assert.deepEqual(Object.keys(r).sort(),['codes','errorCount','ok']);});

test('both synthetic routes survive convergence and render distinct reviewed dialogue',()=>assert.deepEqual(run(),{ok:true,codes:[],errorCount:0}));
test('validator does not mutate source fixtures',()=>{const before=JSON.stringify([flow,p,binding]);run();assert.equal(JSON.stringify([flow,p,binding]),before);});
expectFail('rejects untrusted bridge field',({b})=>b.secret='forbidden','invalid_bridge');
expectFail('rejects missing mapping',({b})=>b.routeBindings.pop(),'invalid_bridge');
expectFail('rejects non-synthetic bridge',({b})=>b.synthetic=false,'invalid_bridge');
expectFail('rejects scope mismatch',({b})=>b.manifestRevision='demo-r2','scope_mismatch');
expectFail('rejects npc scope mismatch',({n})=>n.scope.worldId='demo-other','scope_mismatch');
expectFail('rejects missing session',({n})=>n.scope.sessionId='','invalid_npc_policy');
expectFail('rejects unreviewed copy',({n})=>n.publicCopies['demo-guarded'].approved=false,'dialogue_unapproved');
expectFail('rejects relation/copy mismatch',({n})=>n.publicCopies['demo-guarded'].relation='open','dialogue_unapproved');
expectFail('rejects identical public dialogue across routes',({n})=>n.publicCopies['demo-open'].text=n.publicCopies['demo-guarded'].text,'route_consequence_erased');
expectFail('rejects identical NPC relation across routes',({n})=>{n.routes['demo-b'].relation='guarded';n.publicCopies['demo-open'].relation='guarded';},'route_consequence_erased');
expectFail('rejects wrong trace',({b})=>b.routeBindings[0].traceRef='demo.trace-b','route_mismatch');
expectFail('rejects missing callback binding',({b})=>b.routeBindings[0].callbackCopySlot='demo.missing','callback_mismatch');
expectFail('rejects duplicated callback slot',({b})=>b.routeBindings[0].callbackCopySlot=b.routeBindings[1].callbackCopySlot,'binding_alias');
expectFail('rejects duplicate npc route',({b})=>b.routeBindings[1].npcRouteKey='demo-a','binding_alias');
expectFail('rejects route swapped across branch',({b})=>b.routeBindings[0].routeBeatId='demo-route-b','route_mismatch');
expectFail('rejects npc route with wrong origin',({n})=>n.routes['demo-a'].from='demo-elsewhere','route_mismatch');
expectFail('rejects npc route with wrong destination',({n})=>n.routes['demo-a'].to='demo-other','route_mismatch');
expectFail('rejects convergence that omits a route',({n})=>n.convergence.from=['demo-route-a','demo-route-a'],'incomplete_mapping');
expectFail('rejects wrong convergence scene',({n})=>n.convergence.to='demo-other','scene_mismatch');
expectFail('rejects incorrect choice scene',({b})=>b.choiceBeatId='demo-entry','scene_mismatch');
expectFail('rejects invalid beat flow',({f})=>f.beats.find(x=>x.id==='demo-offer').requiresPass=true,'invalid_beat_contract');
expectFail('rejects uncommitted route beat',({f})=>f.beats.find(x=>x.id==='demo-route-a').requiresCommit=false,'invalid_beat_contract');
expectFail('rejects empty approved copy',({n})=>n.publicCopies['demo-open'].text='  ','dialogue_unapproved');
expectFail('rejects unknown dialogue copy',({b})=>b.routeBindings[0].dialogueCopyId='demo-unknown','dialogue_unapproved');
expectFail('rejects malformed route binding',({b})=>b.routeBindings[0].traceRef=42,'invalid_bridge');
expectFail('rejects wrong npc trace',({n})=>n.routes['demo-a'].trace='demo.trace-other','route_mismatch');
expectFail('rejects duplicate trace mapping',({b})=>b.routeBindings[1].traceRef=b.routeBindings[0].traceRef,'binding_alias');
expectFail('rejects malformed npc policy',({n})=>delete n.publicCopies,'invalid_npc_policy');
expectFail('rejects flow with extra secret field',({f})=>f.beats[0].hidden='forbidden','invalid_beat_contract');
test('diagnostics do not echo arbitrary secret markers',()=>{const r=change('',({b})=>{b.routeBindings[0].traceRef='secret-marker-123';});assert.equal(JSON.stringify(r).includes('secret-marker-123'),false);});
test('rejects malformed roots with only fixed diagnostic codes',()=>{for(const x of [null,{},[],42]){const r=run(x,p,binding);assert.equal(r.ok,false);assert.ok(r.codes.includes('invalid_beat_contract'));}});
