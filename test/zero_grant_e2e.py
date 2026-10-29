import json,sys,urllib.request,http.cookiejar
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
fails=0
def ck(n,c):
    global fails
    print(("ok  " if c else "FAIL"),n)
    if not c: fails+=1

import threading
print(call("POST","/api/login",{"password":PW})[0])
A={"X-Owner-Password":PW}
def mk(did):
    return {"subject":"math","dungeon":{"id":did,"name":"n","desc":"d","mission":"m","rule":"r","pen":"p","cast":[["G","r","SC0",0]],"fork":{"ch":0,"t":"ft","q":"fq","b":"fb","price":1},"pre":"P","recap":"R","zero":"SZ","clear":"SC","hidden":"SH",
     "pub":{"open":"PUB_OPEN","clear":"PUB_CLEAR","zero":"PUB_ZERO","hidden":"PUB_HIDDEN"},
     "ch":[{"t":"t0","k":"k0","s":"S0","sb":"B0","tn":"T0","skill":{"name":"A","effect":"EA","id":"a.id"},"practice":[{"id":"q1","q":"Q1","a":"7"}]}]}}
for d in ("za","zb"):
    ck("put "+d,call("PUT","/api/adventure/content",{"kind":"dungeon","id":"d-"+d,"content":mk(d)},A)[0]==200)
def put(kind,id,content):
    return call("PUT","/api/adventure/content",{"kind":kind,"id":id,"content":dict(content,id=id,kind=kind)},A)[0]==200
ck("world",all([put("world","wz",{"startSceneId":"s-a"}),put("scene","s-a",{"choices":["s-b"]}),put("scene","s-b",{"choices":[]})]))
trg={"type":"action_resolved","sceneId":"s-a"}
ck("events",all([put("event","ev-za",{"trigger":trg,"effects":[{"type":"set_flag","target":"f","value":True}],"publicOutcome":"PZ-ONE","grantTriggerRef":"tr-za"}),
                 put("event","ev-zb",{"trigger":trg,"effects":[{"type":"set_flag","target":"g","value":True}],"publicOutcome":"PZ-TWO","grantTriggerRef":"tr-zb"})]))
reg=lambda ref,d,k:call("PUT","/api/adventure/admin/dungeon-trigger",{"triggerRef":ref,"worldId":"wz","dungeonId":d,"manifestRevision":1,"kind":k},A)
ck("reg zA zero",reg("tr-za","za","zeroUnlocked")[0]==200)
ck("reg zB zero",reg("tr-zb","zb","zeroUnlocked")[0]==200)
def dg(i):
    return [x for x in call("GET","/api/dungeons")[1]["dungeons"] if x["dungeon"]["id"]==i][0]["dungeon"]
# 并发：两个会话同时触发同一事件
def run(sid,out):
    call("POST","/api/adventure/session",{"sessionId":sid,"op":"start"})
    out.append(call("POST","/api/adventure/turn",{"sessionId":sid,"turnId":sid+"t","inputText":"现在执行"})[0])
res=[];ths=[threading.Thread(target=run,args=(s,res)) for s in ("Z1","Z2","Z3")]
[t.start() for t in ths];[t.join() for t in ths]
ck("concurrent turns all 200",res==[200,200,200])
# zero 已授权但未通关：仍不得显示（pub.zero 需要 allDone）
j=json.dumps(dg("za"));ck("zero granted but not allDone: hidden","PUB_ZERO" not in j)
call("POST","/api/dungeons/check",{"dungeon":"za","ch":0,"challenge":"q1","answer":"7"})
j=json.dumps(dg("za"));ck("positive: allDone + granted zero shows PUB_ZERO","PUB_ZERO" in j and "PUB_CLEAR" in j)
ck("count of PUB_ZERO exactly once",j.count("PUB_ZERO")==1)
j2=json.dumps(dg("zb"));ck("zB not allDone: no zero","PUB_ZERO" not in j2)
call("POST","/api/dungeons/check",{"dungeon":"zb","ch":0,"challenge":"q1","answer":"7"})
ck("zB positive after clear","PUB_ZERO" in json.dumps(dg("zb")))
ck("replay idempotent",call("POST","/api/adventure/turn",{"sessionId":"Z1","turnId":"Z1t","inputText":"现在执行"})[0]==200 and json.dumps(dg("za")).count("PUB_ZERO")==1)
ck("no trigger metadata leak","tr-z" not in json.dumps(call("GET","/api/dungeons")[1]))
print("fails",fails);sys.exit(1 if fails else 0)
