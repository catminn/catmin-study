import json,subprocess,urllib.request
B="http://localhost:8800";PW="test-pass-123"
op=urllib.request.build_opener();CK=[""]
def call(m,p,b=None,h=None):
    r=urllib.request.Request(B+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers={"content-type":"application/json","Origin":B,"Cookie":CK[0],**(h or {})})
    try:
        x=op.open(r)
        sc=x.headers.get('Set-Cookie')
        if sc: CK[0]=sc.split(';')[0]
        return x.status,json.loads(x.read())
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read() or b"{}")
fails=0;n_ok=0
def ck(n,c):
    global fails,n_ok
    print(("ok  " if c else "FAIL"),n)
    if c: n_ok+=1
    else: fails+=1
call("POST","/api/login",{"password":PW})
A={"X-Owner-Password":PW}
def D(i,**kw):
    d={"id":i,"name":"Demo","tint":"neutral","st":"practice","desc":"Neutral overview","mission":"Learn","rule":"Try","pen":"0","pre":"SENTINEL_PRE","recap":"SENTINEL_RECAP","zero":"SENTINEL_ZERO","clear":"SENTINEL_CLEAR","hidden":"SENTINEL_HIDDEN",
     "pub":{"open":"PUB_OPEN"},"cast":[["Guide","role0","SENTINEL_CAST",0]],"fork":{"ch":1,"t":"FT","q":"FQ","b":"SENTINEL_FORK_B","price":1},
     "ch":[{"t":"t0","k":"k0","s":"SENTINEL_S0","sb":"SENTINEL_SB0","tn":"SENTINEL_TN0","skill":{"name":"A","effect":"EA","id":"a.id"},"practice":[{"id":"q1","q":"Q1","a":"7","hint":"SENTINEL_H"}]},
           {"t":"Neutral future","k":"k1","s":"SENTINEL_S1","sb":"SENTINEL_SB1","tn":"SENTINEL_TN1","practice":[{"id":"q2","q":"Q2","a":"SENTINEL_ANS"}]}]}
    d.update(kw);return {"subject":"math","dungeon":d}
def side(i,c):
    p=subprocess.run(["node","test/lib/make-sidecar.mjs"],input=json.dumps({"kind":"dungeon","id":i,"content":c}),capture_output=True,text=True)
    assert p.returncode==0,p.stderr
    return json.loads(p.stdout)
PR={"approvedBy":"author-placeholder","approvedAt":"2026-10-29T12:00:00Z"}
def put(i,c,sc=None,pr=None,h=A):
    b={"kind":"dungeon","id":i,"content":c}
    if sc is not None:b["reviewSidecar"]=sc
    if pr is not None:b["reviewApproval"]=pr
    return call("PUT","/api/adventure/content",b,h)
ids=lambda:[x["dungeon"]["id"] for x in call("GET","/api/dungeons")[1]["dungeons"]]

# --- 模式关闭（旧行为）：无侧车可导入；给了错侧车则拒绝
ck("legacy import without sidecar ok (enforce off)",put("dg-old",D("dg-old"))[0]==200)
ck("legacy visible",  "dg-old" in ids())
bad=side("dg-x",D("dg-x"));bad["fields"][0]["digest"]="0"
r=put("dg-x",D("dg-x"),bad,PR);ck("provided-but-invalid sidecar rejected even when off",r[0]==400 and r[1].get("error")=="review_failed")
ck("not stored after rejection","dg-x" not in ids())
# --- 开关只能管理员
ck("player cannot flip mode",call("PUT","/api/adventure/admin/dungeon-review-mode",{"enforce":True},{})[0] in (401,403))
ck("bad mode body 400",call("PUT","/api/adventure/admin/dungeon-review-mode",{"enforce":"yes"},A)[0]==400)
ck("enforce on",call("PUT","/api/adventure/admin/dungeon-review-mode",{"enforce":True},A)[1].get("enforce") is True)
ck("unapproved legacy dungeon omitted from GET (fail closed)","dg-old" not in ids())
# --- 导入门槛
c=D("dg-a");sc=side("dg-a",c)
ck("no sidecar rejected",put("dg-a",c)[0]==400)
r=put("dg-a",c,sc);ck("sidecar without provenance rejected",r[0]==400 and "missing_provenance" in r[1].get("codes",[]))
ck("sidecar with bad provenance rejected",put("dg-a",c,sc,{"approvedBy":"","approvedAt":"x"})[0]==400)
c2=D("dg-a");c2["dungeon"]["review"]={"name":True}
ck("forged inline review is not approval",put("dg-a",c2)[0]==400)
e=D("dg-a");e["dungeon"]["name"]="Demo!"
r=put("dg-a",e,sc,PR);ck("edited text vs old sidecar rejected",r[0]==400 and "stale_content" in r[1]["codes"])
g=side("dg-a",c);[f for f in g["fields"] if f["path"]=="dungeon.ch[1].t"][0]["gate"]="chapter:1"
r=put("dg-a",c,g,PR);ck("future title with chapter gate rejected",r[0]==400 and "wrong_gate" in r[1]["codes"])
m=side("dg-a",c);m["fields"].pop()
ck("missing field approval rejected",put("dg-a",c,m,PR)[0]==400)
u=side("dg-a",c);u["fields"].append({"path":"dungeon.pre","digest":"x","gate":"listing"})
ck("unknown path rejected",put("dg-a",c,u,PR)[0]==400)
ck("player cannot import with sidecar",put("dg-a",c,sc,PR,{})[0] in (401,403))
ck("none of the rejected imports stored","dg-a" not in ids())
# --- 通过
r=put("dg-a",c,sc,PR);ck("valid sidecar + provenance accepted",r[0]==200)
ck("approved dungeon visible","dg-a" in ids())
j=json.dumps(call("GET","/api/dungeons")[1])
ck("GET still has no director fields","SENTINEL" not in j and "approvedBy" not in j and "author-placeholder" not in j)
# --- 错误响应不泄露
r=put("dg-a",e,sc,PR);rj=json.dumps(r[1])
ck("error body only codes (no text/digest/path)","Demo" not in rj and sc["contentDigest"] not in rj and "dungeon." not in rj and "SENTINEL" not in rj)
# --- 改文本后旧审批不继承：新版本无审批则消失；带新侧车才恢复
ck("edit requires fresh sidecar",put("dg-a",e)[0]==400)
ck("edit with fresh sidecar ok",put("dg-a",e,side("dg-a",e),PR)[0]==200 and "dg-a" in ids())
name=[x for x in call("GET","/api/dungeons")[1]["dungeons"] if x["dungeon"]["id"]=="dg-a"][0]["dungeon"]["name"]
ck("new revision shown",name=="Demo!")
# --- 补挂侧车到已入库旧副本
ck("attach: player forbidden",call("PUT","/api/adventure/admin/dungeon-review",{"id":"dg-old","reviewSidecar":side("dg-old",D("dg-old")),"reviewApproval":PR},{})[0] in (401,403))
ck("attach: wrong sidecar rejected",call("PUT","/api/adventure/admin/dungeon-review",{"id":"dg-old","reviewSidecar":side("dg-a",e),"reviewApproval":PR},A)[0]==400)
ck("attach: no provenance rejected",call("PUT","/api/adventure/admin/dungeon-review",{"id":"dg-old","reviewSidecar":side("dg-old",D("dg-old"))},A)[0]==400)
ck("attach: unknown id 404",call("PUT","/api/adventure/admin/dungeon-review",{"id":"nope","reviewSidecar":{},"reviewApproval":PR},A)[0]==404)
ck("attach: valid ok",call("PUT","/api/adventure/admin/dungeon-review",{"id":"dg-old","reviewSidecar":side("dg-old",D("dg-old")),"reviewApproval":PR},A)[0]==200)
ck("attached legacy dungeon visible again","dg-old" in ids())
# --- 关闭开关后恢复旧行为（管理员显式决定）
call("PUT","/api/adventure/admin/dungeon-review-mode",{"enforce":False},A)
ck("mode off: unapproved import allowed again",put("dg-z",D("dg-z"))[0]==200 and "dg-z" in ids())
print("passed",n_ok,"failed",fails)
raise SystemExit(1 if fails else 0)
