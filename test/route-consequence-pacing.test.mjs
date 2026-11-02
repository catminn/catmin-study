import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteConsequenceOutline} from '../scripts/validate-route-consequence-outline.mjs';
import {validateRouteConsequencePacing as check} from '../scripts/validate-route-consequence-pacing.mjs';

// Invented IDs only; none refers to the actual first world or NPCs.
const edge=(to,impactKey=null)=>({to,impactKey});
const node=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
const fixture=()=>({start:'demo-start',nodes:[
  node('demo-start',[edge('demo-left','demo-impact-left'),edge('demo-right','demo-impact-right')]),
  node('demo-left',[edge('demo-left-callback')]),
  node('demo-right',[edge('demo-right-callback')]),
  node('demo-left-callback',[edge('demo-join')],['demo-impact-left']),
  node('demo-right-callback',[edge('demo-join')],['demo-impact-right']),
  node('demo-join',[edge('demo-end')]),node('demo-end',[],[],true)
]});
const expected=(beat)=>({ok:true,branchOutcomeCount:2,latestCallbackBeat:beat});

test('two conditional callbacks arrive within the inclusive author budget',()=>{
  const graph=fixture(),before=JSON.stringify(graph);
  assert.deepEqual(check(graph,{callbackBy:2}),expected(2));
  assert.equal(JSON.stringify(graph),before);
});

test('a valid but late route callback is rejected without changing its graph',()=>{
  const graph=fixture();
  graph.nodes.find(n=>n.id==='demo-right').exits=[edge('demo-right-delay')];
  graph.nodes.push(node('demo-right-delay',[edge('demo-right-callback')]));
  assert.equal(validateRouteConsequenceOutline(graph).ok,true);
  assert.deepEqual(check(graph,{callbackBy:2}),{ok:false,code:'callback_too_late'});
  assert.deepEqual(check(graph,{callbackBy:3}),expected(3));
});

test('a callback absent from one route is a graph error, not merely a timing error',()=>{
  const graph=fixture();graph.nodes.find(n=>n.id==='demo-right-callback').acknowledges=[];
  assert.deepEqual(check(graph),{ok:false,code:'graph_invalid'});
});

test('cross-route acknowledgement is rejected before measuring latency',()=>{
  const graph=fixture();graph.nodes.find(n=>n.id==='demo-right').acknowledges=['demo-impact-left'];
  assert.deepEqual(check(graph),{ok:false,code:'graph_invalid'});
});

test('no branch outcomes is a valid zero-latency chapter',()=>{
  const graph={start:'demo-start',nodes:[node('demo-start',[edge('demo-end')]),node('demo-end',[],[],true)]};
  assert.deepEqual(check(graph,{callbackBy:1}),{ok:true,branchOutcomeCount:0,latestCallbackBeat:0});
});

test('invalid limits and malformed input fail closed with fixed diagnostics',()=>{
  for(const limits of [null,{}, {callbackBy:0},{callbackBy:201},{callbackBy:2.5},
    {callbackBy:2,ignoreLongRoute:true}])
    assert.deepEqual(check(fixture(),limits),{ok:false,code:'limits_invalid'});
  assert.deepEqual(check(null),{ok:false,code:'graph_invalid'});
  const graph=fixture();graph.nodes[0].extra='demo-private-sentinel';
  assert.deepEqual(check(graph),{ok:false,code:'graph_invalid'});
  assert.equal(JSON.stringify(check(graph)).includes('demo-private-sentinel'),false);
});

test('editorial node and edge order does not change callback latency',()=>{
  const graph=fixture();graph.nodes.reverse();
  graph.nodes.find(n=>n.id==='demo-start').exits.reverse();
  assert.deepEqual(check(graph,{callbackBy:2}),expected(2));
});

// Independent oracle: enumerate each complete suffix, stop at its first
// conditional callback, then take the latest first occurrence.
function oracle(graph) {
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
  let latest=0;
  function walk(id,key,depth) {
    const n=nodes.get(id);
    if(n.acknowledges.includes(key)){latest=Math.max(latest,depth);return;}
    assert.equal(n.end,false,'fixture must acknowledge before terminal');
    for(const e of n.exits) walk(e.to,key,depth+1);
  }
  for(const n of graph.nodes) if(n.exits.length>1)
    for(const e of n.exits) walk(e.to,e.impactKey,1);
  return latest;
}
function chainFixture(leftLength,leftAt,rightLength,rightAt) {
  const g={start:'demo-start',nodes:[
    node('demo-start',[edge('demo-left-1','demo-impact-left'),edge('demo-right-1','demo-impact-right')])
  ]};
  for(const [side,length,at] of [['left',leftLength,leftAt],['right',rightLength,rightAt]])
    for(let i=1;i<=length;i++) g.nodes.push(node('demo-'+side+'-'+i,
      [edge(i===length?'demo-join':'demo-'+side+'-'+(i+1))],
      i===at?['demo-impact-'+side]:[]));
  g.nodes.push(node('demo-join',[edge('demo-end')]),node('demo-end',[],[],true));
  return g;
}

test('100 synthetic route placements x 5 limits agree with an independent DFS oracle',()=>{
  let cases=0,accepted=0,rejected=0;
  for(let l=1;l<=4;l++)for(let r=1;r<=4;r++)
    for(let la=1;la<=l;la++)for(let ra=1;ra<=r;ra++) {
      const g=chainFixture(l,la,r,ra);
      assert.equal(validateRouteConsequenceOutline(g).ok,true);
      const latest=oracle(g);
      assert.equal(latest,Math.max(la,ra));
      for(let limit=1;limit<=5;limit++) {
        const actual=check(g,{callbackBy:limit});
        const expectedResult=latest<=limit?expected(latest):{ok:false,code:'callback_too_late'};
        assert.deepEqual(actual,expectedResult,`l=${l},r=${r},la=${la},ra=${ra},limit=${limit}`);
        cases++;if(actual.ok)accepted++;else rejected++;
      }
    }
  assert.equal(cases,500);assert.ok(accepted>0 && rejected>0);
});
