// Test-only adapter for pre-token synthetic regression suites. Never use for runtime authorization.
export function legacyCallbackAdapter(rawMake) {
  return (...args)=>{
    const ref=rawMake(...args);
    if(!ref.ok) return ref;
    return {ok:true,openSession(){
      const raw=ref.openSession();
      let lastOfferId='offer-none';
      return Object.freeze({...raw,
        render(){
          const r=raw.render();
          if(!r.ok) return r;
          if(r.offerId!==null) lastOfferId=r.offerId;
          return {ok:true,visibleCount:r.visibleCount};
        },
        acknowledge(request){return raw.acknowledge({...request,offerId:lastOfferId});}
      });
    }};
  };
}
