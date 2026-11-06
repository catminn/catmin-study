import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRouteConsequenceOutline as check} from '../scripts/validate-route-consequence-outline.mjs';

// Invented branches and impact keys only; no official world, NPC, or secret.
const edge=(to,impactKey=null)=>({to,impactKey});
const node=(id,exits=[],acknowledges=[],end=false)=>({id,end,exits,acknowledges});
const impacts=[['demo-impact-left','demo-left'],['demo-impact-right','demo-right'],['demo-impact-a','demo-left-a'],['demo-impact-b','demo-left-b']];
const sites=['demo-entry','demo-left','demo-right','demo-left-a','demo-left-b','demo-join'];
const fixture=()=>({start:'demo-entry',nodes:[
 node('demo-entry',[edge('demo-left','demo-impact-left'),edge('demo-right','demo-impact-right')]),
 node('demo-left',[edge('demo-left-a','demo-impact-a'),edge('demo-left-b','demo-impact-b')]),
 node('demo-right',[edge('demo-join')]),node('demo-left-a',[edge('demo-join')]),
 node('demo-left-b',[edge('demo-join')]),node('demo-join',[edge('demo-end')],impacts.map(([key])=>key)),
 node('demo-end',[],[],true)
]});
function oracle(graph,key,destination){
 const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
 const suffix=new Set();
 const walk=(id,path)=>{
   suffix.add(id);const n=nodes.get(id);
   if(n.end)return [path.concat(id)];
   return n.exits.flatMap(e=>walk(e.to,path.concat(id)));
 };
 const paths=walk(destination,[]);
 if(graph.nodes.some(n=>n.acknowledges.includes(key)&&!suffix.has(n.id)))
   return {ok:false,code:'callback_off_route'};
 if(paths.some(path=>!path.some(id=>!nodes.get(id).end&&nodes.get(id).acknowledges.includes(key))))
   return {ok:false,code:'callback_missing'};
 return {ok:true,nodeCount:graph.nodes.length,branchOutcomeCount:impacts.length};
}
const withMask=(key,mask)=>{
 const g=fixture();
 for(const n of g.nodes)n.acknowledges=n.acknowledges.filter(k=>k!==key);
 sites.forEach((id,i)=>{if(mask&(1<<i))g.nodes.find(n=>n.id===id).acknowledges.push(key);});
 return g;
};
test('nested decisions: exhaustive callback placement agrees with independent suffix enumeration',()=>{
 let accepted=0,offRoute=0,missing=0,checked=0;
 for(const [key,destination] of impacts)
   for(let mask=0;mask<(1<<sites.length);mask++){
     const graph=withMask(key,mask);
     const expected=oracle(graph,key,destination),actual=check(graph);
     assert.deepEqual(actual,expected,'key='+key+' mask='+mask);
     assert.equal(JSON.stringify(actual).includes(key),false);
     if(expected.ok)accepted++;
     else if(expected.code==='callback_off_route')offRoute++;
     else missing++;
     checked++;
   }
 assert.equal(checked,256);
 assert.ok(accepted>0&&offRoute>0&&missing>0);
});
test('node order and sibling branch order cannot change nested callback coverage',()=>{
 let checked=0;
 for(const [key] of impacts)
   for(let mask=0;mask<(1<<sites.length);mask++){
     const graph=withMask(key,mask),shuffled=structuredClone(graph);
     shuffled.nodes.reverse();
     for(const n of shuffled.nodes)n.exits.reverse();
     assert.deepEqual(check(shuffled),check(graph),'key='+key+' mask='+mask);
     checked++;
   }
 assert.equal(checked,256);
});
