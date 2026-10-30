import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteResponseDifferentiation as check} from '../scripts/validate-route-response-differentiation.mjs';

// Synthetic author-only examples; never real NPC dialogue or hidden plot.
const beat=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
const edge=(to,impactKey=null)=>({to,impactKey});
const outline=()=>({start:'demo-entry',nodes:[
  beat('demo-entry',[edge('demo-left','demo-left-impact'),edge('demo-right','demo-right-impact')]),
  beat('demo-left',[edge('demo-join')]),beat('demo-right',[edge('demo-join')]),
  beat('demo-join',[edge('demo-end')],['demo-left-impact','demo-right-impact']),
  beat('demo-end',[],[],true)
]});
const response=(impactKey,copy,approved=true)=>({impactKey,copy,approved});
const plan=()=>({schema:'route-response-differentiation-v1',responses:[
  response('demo-left-impact','The route is acknowledged.'),
  response('demo-right-impact','A different route is acknowledged.')
]});
const reject=(o,p,code)=>assert.deepEqual(check(o,p),{ok:false,code});

test('approved and distinct branch responses pass',()=>assert.deepEqual(check(outline(),plan()),{ok:true,branchCount:1,copyCount:2}));
test('missing response fails closed',()=>{const p=plan();p.responses.pop();reject(outline(),p,'response_missing');});
test('extra response fails closed',()=>{const p=plan();p.responses.push(response('demo-unrelated','No.'));reject(outline(),p,'response_catalog_invalid');});
test('duplicate response key fails closed',()=>{const p=plan();p.responses.push({...p.responses[0]});reject(outline(),p,'response_catalog_invalid');});
test('unapproved copy fails closed',()=>{const p=plan();p.responses[0].approved=false;reject(outline(),p,'response_unapproved');});
test('blank copy fails closed',()=>{const p=plan();p.responses[0].copy=' \n ';reject(outline(),p,'response_unapproved');});
test('identical sibling replies cannot masquerade as consequences',()=>{const p=plan();p.responses[1].copy=p.responses[0].copy;reject(outline(),p,'response_indistinct');});
test('case and whitespace variations do not create a distinct response',()=>{const p=plan();p.responses[1].copy='  THE   ROUTE IS ACKNOWLEDGED.\n';reject(outline(),p,'response_indistinct');});
test('unicode compatibility variants do not create a distinct response',()=>{const p=plan();p.responses[0].copy='Ａ route';p.responses[1].copy='A route';reject(outline(),p,'response_indistinct');});
test('unknown hidden gate field is rejected',()=>{const p=plan();p.responses[0].requiresSecret=true;reject(outline(),p,'response_invalid');});
test('invalid underlying consequence outline fails',()=>{const o=outline();o.nodes[3].acknowledges=[];reject(o,plan(),'outline_invalid');});
test('linear graph is not silently counted as differentiated branching',()=>{const o={start:'demo-a',nodes:[beat('demo-a',[edge('demo-b')]),beat('demo-b',[],[],true)]};reject(o,{schema:'route-response-differentiation-v1',responses:[]},'no_branch_choices');});
test('diagnostics never echo private response text or author IDs',()=>{const p=plan();p.responses[1].copy=p.responses[0].copy='secret-placeholder-never-echo';const out=check(outline(),p);assert.equal(out.ok,false);assert.equal(JSON.stringify(out).includes('secret-placeholder'),false);assert.equal(JSON.stringify(out).includes('demo-left-impact'),false);});
test('distinct branch choices may reuse copy across separate choice groups',()=>{
  const o=outline();o.nodes[3].exits=[edge('demo-next')];o.nodes.splice(4,0,
    beat('demo-next',[edge('demo-third','demo-third-impact'),edge('demo-fourth','demo-fourth-impact')]),
    beat('demo-third',[edge('demo-second-join')]),beat('demo-fourth',[edge('demo-second-join')]),
    beat('demo-second-join',[edge('demo-end')],['demo-third-impact','demo-fourth-impact']));
  const p=plan();p.responses.push(response('demo-third-impact','The route is acknowledged.'),response('demo-fourth-impact','Another outcome.'));
  assert.deepEqual(check(o,p),{ok:true,branchCount:2,copyCount:4});
});
