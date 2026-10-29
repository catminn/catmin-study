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

print(call("POST","/api/login",{"password":PW})[0])
A={"X-Owner-Password":PW}
E={"subject":"math","dungeon":{"id":"tdy","name":"n","desc":"d","mission":"m","rule":"r","pen":"p","pre":"SENTINEL_PRE","recap":"SENTINEL_RECAP","zero":"SENTINEL_ZERO","clear":"SENTINEL_CLEAR","hidden":"SENTINEL_HIDDEN",
 "cast":[["Guide","role0","SENTINEL_CAST_SECRET0",0],["LateGuy","role1","SENTINEL_CAST_SECRET1",1]],
 "fork":{"ch":1,"t":"SENTINEL_FORK_T","q":"SENTINEL_FORK_Q","b":"SENTINEL_FORK_B","price":1},
 "ch":[{"t":"t0","k":"k0","s":"SENTINEL_S0","sb":"SENTINEL_SB0","tn":"SENTINEL_TN0","skill":{"name":"A","effect":"EA","id":"a.id"},"practice":[{"id":"q1","q":"Q1","a":"7","hint":"SENTINEL_H0"}]},
  {"t":"t1","k":"SENTINEL_K1","s":"SENTINEL_S1","sb":"SENTINEL_SB1","tn":"SENTINEL_TN1","skill":{"name":"SENTINEL_SKILL1","effect":"SENTINEL_EFF1"},"practice":[{"id":"q2","q":"SENTINEL_Q2","a":"SENTINEL_ANS2"}]}]}}
G=json.loads(json.dumps(E));G["dungeon"]["id"]="tg1"
G["dungeon"]["pub"]={"open":"PUB_OPEN","clear":"PUB_CLEAR","zero":"PUB_ZERO","hidden":"PUB_HIDDEN"}
ck("put dungeon",call("PUT","/api/adventure/content",{"kind":"dungeon","id":"dg","content":G},A)[0]==200)
def tg():
    return [x for x in call("GET","/api/dungeons")[1]["dungeons"] if x["dungeon"]["id"]=="tg1"][0]["dungeon"]
# 世界：占位内容
def put(kind,id,content):
    return call("PUT","/api/adventure/content",{"kind":kind,"id":id,"content":dict(content,id=id,kind=kind)},A)[0]==200
ck("put world content",all([put("world","w",{"startSceneId":"s-a"}),put("scene","s-a",{"choices":["s-b"]}),put("scene","s-b",{"choices":[]})]))
trg=lambda sc:{"type":"action_resolved","sceneId":sc}
ck("put events",all([put("event","ev-h",{"trigger":trg("s-a"),"effects":[{"type":"set_flag","target":"f1","value":True}],"publicOutcome":"PH-ONE","grantTriggerRef":"tr-hidden"}),
    put("event","ev-badw",{"trigger":trg("s-a"),"effects":[],"publicOutcome":"PH-TWO","grantTriggerRef":"tr-badworld"}),
    put("event","ev-badr",{"trigger":trg("s-a"),"effects":[],"publicOutcome":"PH-THREE","grantTriggerRef":"tr-badrev"}),
    put("event","ev-unk",{"trigger":trg("s-a"),"effects":[],"publicOutcome":"PH-FOUR","grantTriggerRef":"tr-unknown"}),
    put("event","ev-badeff",{"trigger":trg("s-a"),"effects":[{"type":"teleport_player","target":"x"}],"publicOutcome":"PH-FIVE","grantTriggerRef":"tr-zero"})]))
ck("player cannot register triggers",call("PUT","/api/adventure/admin/dungeon-trigger",{"triggerRef":"tr-x","worldId":"w","dungeonId":"tg1","manifestRevision":1,"kind":"zeroUnlocked"})[0] in (401,403))
reg=lambda ref,w,d,rev,k:call("PUT","/api/adventure/admin/dungeon-trigger",{"triggerRef":ref,"worldId":w,"dungeonId":d,"manifestRevision":rev,"kind":k},A)
ck("register hidden trigger",reg("tr-hidden","w","tg1",1,"hiddenUnlocked")[0]==200)
ck("duplicate register rejected",reg("tr-hidden","w","tg1",1,"zeroUnlocked")[0]==409)
ck("bad kind rejected",reg("tr-bk","w","tg1",1,"clearUnlocked")[0]==400)
ck("register wrong-world trigger",reg("tr-badworld","other","tg1",1,"zeroUnlocked")[0]==200)
ck("register wrong-rev trigger",reg("tr-badrev","w","tg1",99,"zeroUnlocked")[0]==200)
ck("register zero trigger (bound to illegal-effect event)",reg("tr-zero","w","tg1",1,"zeroUnlocked")[0]==200)
# 通关所有题：zero/hidden 仍未授权
call("POST","/api/dungeons/check",{"dungeon":"tg1","ch":0,"challenge":"q1","answer":"7"})
call("POST","/api/dungeons/check",{"dungeon":"tg1","ch":1,"challenge":"q2","answer":"SENTINEL_ANS2"})
j=json.dumps(tg());ck("all done, no grants yet",("PUB_CLEAR" in j) and "PUB_ZERO" not in j and "PUB_HIDDEN" not in j)
call("POST","/api/adventure/session",{"sessionId":"G1","op":"start"})
o=call("POST","/api/adventure/turn",{"sessionId":"G1","turnId":"g1t1","inputText":"现在执行"})[1]
ow=[w["publicOutcome"] for w in o.get("worldEvents",[])]
ck("events fired",{"PH-ONE","PH-TWO","PH-THREE","PH-FOUR"}<=set(ow) and "PH-FIVE" not in ow)
j=json.dumps(tg())
ck("hidden granted by committed event","PUB_HIDDEN" in j)
ck("wrong world / wrong revision / unknown ref / rejected event do NOT grant zero","PUB_ZERO" not in j)
ck("GET never exposes trigger metadata","tr-hidden" not in j and "grantTriggerRef" not in j and "ev-h" not in j and "tr-" not in json.dumps(call("GET","/api/dungeons")[1]))
ck("replay idempotent",call("POST","/api/adventure/turn",{"sessionId":"G1","turnId":"g1t1","inputText":"现在执行"})[0]==200 and "PUB_HIDDEN" in json.dumps(tg()))
print("fails",fails);sys.exit(1 if fails else 0)
