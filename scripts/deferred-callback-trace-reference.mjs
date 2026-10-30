// Synthetic, offline author trace reference. Never use as runtime authorization.
// No formal-world text, NPC identity, secret key, or private content belongs here.
import {validateCrossChapterConsequence} from './validate-cross-chapter-consequence.mjs';

const idOK = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => obj(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x,k));
const fail = code => ({ok:false,code});

export function createDeferredCallbackTraceReference(outline) {
  const validated = validateCrossChapterConsequence(outline);
  if (!validated.ok) return fail('outline_invalid'); // Never echo outline data or identifiers.

  // Copy the validated graph so later mutation of caller-owned data cannot change a session.
  const chapters = outline.chapters.map(ch => ({
    id:ch.id, start:ch.start,
    nodes:new Map(ch.nodes.map(n=>[n.id,{
      end:n.end,
      exits:n.exits.map(e=>({to:e.to,impactKey:e.impactKey})),
      acknowledges:[...n.acknowledges]
    }]))
  }));
  const chapterIndex = new Map(chapters.map((ch,i)=>[ch.id,i]));
  const dueByImpact = new Map(outline.deferrals.map(d=>[d.impactKey,chapterIndex.get(d.dueChapterId)]));

  function openSession() {
    let ci=0, cursor=chapters[0].start, finished=false, pending=null;
    const chosen = new Set(), confirmed = new Set(), commits = new Map();

    function commitReplay(id, signature) {
      if (!commits.has(id)) return null;
      return commits.get(id)===signature ? {ok:true,replayed:true} : fail('commit_conflict');
    }
    function snapshot() {
      return {ok:true,chapterOrdinal:ci+1,atTerminal:finished || chapters[ci].nodes.get(cursor).end,
        chosenCount:chosen.size,renderedCount:confirmed.size,finished};
    }
    function preview(request) {
      if(finished) return fail('session_finished');
      if(!exact(request,['to']) || !idOK(request.to)) return fail('request_invalid');
      return chapters[ci].nodes.get(cursor).exits.some(e=>e.to===request.to)
        ? {ok:true} : fail('target_invalid');
    }
    function ask() {return finished ? fail('session_finished') : {ok:true};}
    function step(request) {
      if(!exact(request,['chapterId','fromNodeId','to','commitId','source']) || !idOK(request.chapterId) || !idOK(request.fromNodeId) || !idOK(request.to) || !idOK(request.commitId)) return fail('request_invalid');
      if(request.source!=='server') return fail('untrusted_event');
      const signature=JSON.stringify(['step',request.chapterId,request.fromNodeId,request.to]);
      const replay=commitReplay(request.commitId,signature);
      if(replay) return replay;
      if(finished) return fail('session_finished');
      if(request.chapterId!==chapters[ci].id || request.fromNodeId!==cursor) return fail('stale_cursor');
      const n=chapters[ci].nodes.get(cursor);
      const edge=n.exits.find(e=>e.to===request.to);
      if(!edge) return fail('target_invalid');
      if(n.exits.length>1) chosen.add(edge.impactKey);
      cursor=edge.to;
      pending=null;
      commits.set(request.commitId,signature);
      return {ok:true,replayed:false};
    }
    function render() {
      if(finished) return fail('session_finished');
      const n=chapters[ci].nodes.get(cursor);
      const visible=n.acknowledges.filter(k=>chosen.has(k) && ci<=dueByImpact.get(k) && !confirmed.has(k));
      pending={chapterId:chapters[ci].id,nodeId:cursor,keys:[...visible]};
      return {ok:true,visibleCount:visible.length};
    }
    function acknowledge(request) {
      if(!exact(request,['chapterId','nodeId','commitId','source']) || !idOK(request.chapterId) || !idOK(request.nodeId) || !idOK(request.commitId)) return fail('request_invalid');
      if(request.source!=='server') return fail('untrusted_event');
      const signature=JSON.stringify(['acknowledge',request.chapterId,request.nodeId]);
      const replay=commitReplay(request.commitId,signature);
      if(replay) return replay;
      if(finished) return fail('session_finished');
      if(request.chapterId!==chapters[ci].id || request.nodeId!==cursor) return fail('stale_cursor');
      if(!pending || pending.chapterId!==request.chapterId || pending.nodeId!==request.nodeId || pending.keys.length===0) return fail('callback_not_offered');
      for(const key of pending.keys) confirmed.add(key);
      pending=null;
      commits.set(request.commitId,signature);
      return {ok:true,replayed:false};
    }
    function advance(request) {
      if(!exact(request,['fromChapterId','toChapterId','commitId','source']) || !idOK(request.fromChapterId) ||
         !(request.toChapterId===null || idOK(request.toChapterId)) || !idOK(request.commitId)) return fail('request_invalid');
      if(request.source!=='server') return fail('untrusted_event');
      const signature=JSON.stringify(['advance',request.fromChapterId,request.toChapterId]);
      const replay=commitReplay(request.commitId,signature);
      if(replay) return {...replay,finished};
      if(finished) return fail('session_finished');
      if(request.fromChapterId!==chapters[ci].id) return fail('stale_cursor');
      if(!chapters[ci].nodes.get(cursor).end) return fail('chapter_not_finished');
      const expected=chapters[ci+1]?.id ?? null;
      if(request.toChapterId!==expected) return fail('chapter_order_invalid');
      for(const key of chosen) if(dueByImpact.has(key) && dueByImpact.get(key)<=ci && !confirmed.has(key))
        return fail('callback_not_confirmed');
      pending=null;
      if(expected===null) finished=true;
      else {ci++;cursor=chapters[ci].start;}
      commits.set(request.commitId,signature);
      return {ok:true,replayed:false,finished};
    }
    return Object.freeze({snapshot,preview,ask,step,render,acknowledge,advance});
  }
  return Object.freeze({ok:true,openSession});
}
