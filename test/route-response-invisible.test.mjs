import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteResponseDifferentiation as check} from '../scripts/validate-route-response-differentiation.mjs';
const node=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
const edge=(to,impactKey=null)=>({to,impactKey});
const outline=()=>({start:'demo-entry',nodes:[
  node('demo-entry',[edge('demo-left','demo-left-impact'),edge('demo-right','demo-right-impact')]),
  node('demo-left',[edge('demo-join')]),node('demo-right',[edge('demo-join')]),
  node('demo-join',[edge('demo-end')],['demo-left-impact','demo-right-impact']),
  node('demo-end',[],[],true)
]});
const plan=(a='Alpha',b='Beta')=>({schema:'route-response-differentiation-v1',responses:[
  {impactKey:'demo-left-impact',copy:a,approved:true},
  {impactKey:'demo-right-impact',copy:b,approved:true}
]});
const reject=(p,code)=>assert.deepEqual(check(outline(),p),{ok:false,code});
test('ordinary distinct responses remain valid',()=>assert.deepEqual(check(outline(),plan()),{ok:true,branchCount:1,copyCount:2}));
test('zero width space does not create distinction',()=>reject(plan('Al\u200bpha','Alpha'),'response_indistinct'));
test('soft hyphen does not create distinction',()=>reject(plan('Al\u00adpha','Alpha'),'response_indistinct'));
test('word joiner does not create distinction',()=>reject(plan('Al\u2060pha','Alpha'),'response_indistinct'));
test('zero width joiner does not create distinction',()=>reject(plan('Al\u200dpha','Alpha'),'response_indistinct'));
test('variation selector does not create distinction',()=>reject(plan('Alpha\ufe0f','Alpha'),'response_indistinct'));
test('supplementary variation selector does not create distinction',()=>reject(plan('Alpha\u{e0100}','Alpha'),'response_indistinct'));
test('invisible-only approved response is still blank',()=>reject(plan('\u200b\u00ad','Beta'),'response_unapproved'));
test('bidi override is rejected',()=>reject(plan('Alpha\u202e','Beta'),'response_invalid'));
test('bidi isolate is rejected',()=>reject(plan('Alpha\u2066','Beta'),'response_invalid'));
test('left-to-right mark is rejected',()=>reject(plan('Alpha\u200e','Beta'),'response_invalid'));
test('null byte is rejected',()=>reject(plan('Alpha\0','Beta'),'response_invalid'));
test('C1 control is rejected',()=>reject(plan('Alpha\u0085','Beta'),'response_invalid'));
test('newlines and tabs are allowed for legitimate prose',()=>assert.deepEqual(check(outline(),plan('Alpha\n\tline','Beta')),{ok:true,branchCount:1,copyCount:2}));
test('diagnostics do not echo invisible-bearing author text',()=>{const p=plan('private\u202e-text','Beta');assert.equal(JSON.stringify(check(outline(),p)).includes('private'),false);});
