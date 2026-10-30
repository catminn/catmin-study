// Spoiler-free author-only proof for explicitly deferred route consequences.
// Never process or publish formal-world text, identities, or private keys here.
const idOK = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => obj(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x,k));
const uniqueIds = (xs, max=200) => Array.isArray(xs) && xs.length <= max && xs.every(idOK) && new Set(xs).size === xs.length;
const fail = code => ({ok:false,code}); // No author-controlled values in errors.

export function validateCrossChapterConsequence(m) {
  if (!exact(m,['chapters','deferrals']) || !Array.isArray(m.chapters) ||
      m.chapters.length < 2 || m.chapters.length > 16 || !Array.isArray(m.deferrals) ||
      m.deferrals.length < 1 || m.deferrals.length > 200) return fail('shape_invalid');
  const chapters = [];
  const chapterIndex = new Map();
  const branchImpacts = new Map();
  let nodeCount = 0;
  for (const ch of m.chapters) {
    if (!exact(ch,['id','start','nodes']) || !idOK(ch.id) || !idOK(ch.start) ||
        chapterIndex.has(ch.id) || !Array.isArray(ch.nodes) ||
        ch.nodes.length < 2 || ch.nodes.length > 200 || nodeCount + ch.nodes.length > 500)
      return fail('chapter_invalid');
    const ci = chapters.length;
    chapterIndex.set(ch.id,ci);
    const nodes = new Map();
    for (const n of ch.nodes) {
      if (!exact(n,['id','end','exits','acknowledges']) || !idOK(n.id) ||
          typeof n.end !== 'boolean' || nodes.has(n.id) ||
          !Array.isArray(n.exits) || n.exits.length > 200 ||
          !uniqueIds(n.acknowledges)) return fail('node_invalid');
      if ((n.end && (n.exits.length !== 0 || n.acknowledges.length !== 0)) ||
          (!n.end && n.exits.length === 0)) return fail('exit_invalid');
      const targets = new Set();
      for (const e of n.exits) {
        if (!exact(e,['to','impactKey']) || !idOK(e.to) ||
            !(e.impactKey === null || idOK(e.impactKey)) || targets.has(e.to))
          return fail('edge_invalid');
        targets.add(e.to);
        if (n.exits.length > 1) {
          if (e.impactKey === null || branchImpacts.has(e.impactKey)) return fail('impact_invalid');
          branchImpacts.set(e.impactKey,{chapter:ci,target:e.to});
        } else if (e.impactKey !== null) return fail('impact_invalid');
      }
      nodes.set(n.id,n);
    }
    if (!nodes.has(ch.start) || ![...nodes.values()].some(n=>n.end)) return fail('endpoint_invalid');
    for (const n of nodes.values()) for (const e of n.exits)
      if (!nodes.has(e.to)) return fail('edge_invalid');
    const indegree = new Map([...nodes.keys()].map(k=>[k,0]));
    for (const n of nodes.values()) for (const e of n.exits)
      indegree.set(e.to,indegree.get(e.to)+1);
    const ready = [...nodes.keys()].filter(k=>indegree.get(k)===0);
    const order=[];
    for(let i=0;i<ready.length;i++) {
      const id=ready[i];order.push(id);
      for(const e of nodes.get(id).exits) {
        indegree.set(e.to,indegree.get(e.to)-1);
        if(indegree.get(e.to)===0) ready.push(e.to);
      }
    }
    if(order.length!==nodes.size) return fail('cycle_invalid');
    const reached=new Set([ch.start]);
    for(const id of order) if(reached.has(id))
      for(const e of nodes.get(id).exits) reached.add(e.to);
    if(reached.size!==nodes.size) return fail('unreachable_node');
    chapters.push({nodes,order,start:ch.start});
    nodeCount+=nodes.size;
  }
  const obligations=new Map();
  for(const d of m.deferrals) {
    if(!exact(d,['impactKey','dueChapterId']) || !idOK(d.impactKey) ||
       !idOK(d.dueChapterId) || obligations.has(d.impactKey)) return fail('deferral_invalid');
    const origin=branchImpacts.get(d.impactKey);
    const due=chapterIndex.get(d.dueChapterId);
    if(!origin || due===undefined || due<=origin.chapter) return fail('deferral_invalid');
    obligations.set(d.impactKey,{...origin,due});
  }
  for(let ci=0;ci<chapters.length;ci++) {
    for(const n of chapters[ci].nodes.values()) for(const key of n.acknowledges) {
      const d=obligations.get(key);
      if(!d || ci<=d.chapter || ci>d.due) return fail('acknowledgement_invalid');
    }
  }
  // Every path from the selected branch exit through the due chapter must
  // contain a conditional acknowledgement in a *later* nonterminal chapter.
  // A chapter's terminal beats connect to the next chapter's entry for proof
  // only; this does not implement runtime transitions or persistent memory.
  for(const [key,d] of obligations) {
    const guaranteed=[];
    for(let ci=d.due;ci>=d.chapter;ci--) {
      const ch=chapters[ci];
      const values=new Map();
      for(const id of [...ch.order].reverse()) {
        const n=ch.nodes.get(id);
        if(n.end) values.set(id,ci<d.due && guaranteed[ci+1].get(chapters[ci+1].start));
        else values.set(id,(ci>d.chapter && n.acknowledges.includes(key)) ||
          n.exits.every(e=>values.get(e.to)===true));
      }
      guaranteed[ci]=values;
    }
    if(guaranteed[d.chapter].get(d.target)!==true) return fail('deferred_callback_missing');
  }
  return {ok:true,chapterCount:chapters.length,nodeCount,deferredOutcomeCount:obligations.size};
}
