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
D={"subject":"math","dungeon":{"id":"tdx","name":"n","desc":"d","mission":"m","rule":"r","pen":"p","hidden":"h","fork":{"ch":1,"t":"t","q":"q","b":"b","price":1},
 "ch":[{"t":"c","k":"k","s":"s","sb":"sb","tn":"tn","skill":{"name":"S","effect":"E"},"practice":[{"id":"p1","q":"1+1","a":"2","hint":"hi"},{"id":"p2","q":"x","a":["3x^2","3*x^2"]}]}]}}
s,r=call("PUT","/api/adventure/content",{"kind":"dungeon","id":"d1","content":D},{"X-Owner-Password":PW});ck("put",s==200)
bad=json.loads(json.dumps(D));bad["dungeon"]["fork"]=None
ck("reject no fork",call("PUT","/api/adventure/content",{"kind":"dungeon","id":"d2","content":bad},{"X-Owner-Password":PW})[0]==400)
s,r=call("GET","/api/dungeons");ck("list hides answers and hints","\"a\"" not in json.dumps(r) and "\"hint\"" not in json.dumps(r) and r["dungeons"][0]["dungeon"]["ch"][0]["practice"][0]["id"]=="p1")
c=lambda cid,a:call("POST","/api/dungeons/check",{"dungeon":"tdx","ch":0,"challenge":cid,"answer":a})[1]
r=c("p1","3");ck("wrong",r["correct"]==False and r["hint"]=="hi" and not r["chapterDone"] and r["skill"] is None)
r=c("p1"," 2 ");ck("right",r["correct"] and r["next"]=="p2" and not r["chapterDone"])
r=c("p2","3*X^2");ck("alt answer + chapter done + skill",r["correct"] and r["chapterDone"] and r["skill"]["name"]=="S")
r=c("p1","999");ck("verified stays",r["verified"] and not r["correct"])
ck("unknown challenge 404",call("POST","/api/dungeons/check",{"dungeon":"tdx","ch":0,"challenge":"zz","answer":"1"})[0]==404)
s,r=call("GET","/api/dungeons/progress");ck("progress",len(r["verified"])==2 and len(r["skills"])==1)

# ---- 阶段性授权投影（合成负例）：未解锁章节/隐藏任务/岔路文字不下发 ----
E={"subject":"math","dungeon":{"id":"tdy","name":"n","desc":"d","mission":"m","rule":"r","pen":"p","pre":"SENTINEL_PRE","recap":"SENTINEL_RECAP","zero":"SENTINEL_ZERO","clear":"SENTINEL_CLEAR","hidden":"SENTINEL_HIDDEN",
 "cast":[["Guide","role0","SENTINEL_CAST_SECRET0",0],["LateGuy","role1","SENTINEL_CAST_SECRET1",1]],
 "fork":{"ch":1,"t":"SENTINEL_FORK_T","q":"SENTINEL_FORK_Q","b":"SENTINEL_FORK_B","price":1},
 "ch":[{"t":"t0","k":"k0","s":"SENTINEL_S0","sb":"SENTINEL_SB0","tn":"SENTINEL_TN0","skill":{"name":"A","effect":"EA","id":"a.id"},"practice":[{"id":"q1","q":"Q1","a":"7","hint":"SENTINEL_H0"}]},
  {"t":"t1","k":"SENTINEL_K1","s":"SENTINEL_S1","sb":"SENTINEL_SB1","tn":"SENTINEL_TN1","skill":{"name":"SENTINEL_SKILL1","effect":"SENTINEL_EFF1"},"practice":[{"id":"q2","q":"SENTINEL_Q2","a":"SENTINEL_ANS2"}]}]}}
s,r=call("PUT","/api/adventure/content",{"kind":"dungeon","id":"d3","content":E},{"X-Owner-Password":PW});ck("put E",s==200)
badc=json.loads(json.dumps(E));badc["dungeon"]["cast"][0][3]="0"
ck("reject malformed cast",call("PUT","/api/adventure/content",{"kind":"dungeon","id":"d4","content":badc},{"X-Owner-Password":PW})[0]==400)
g=lambda:json.dumps(call("GET","/api/dungeons")[1])
import re
DIR=re.compile(r"SENTINEL_(PRE|RECAP|ZERO|CLEAR|HIDDEN|S0|SB0|TN0|S1|SB1|TN1|CAST_SECRET\d|H0|FORK_B|ANS2)")
t=g()
ck("no director fields in GET (start)",not DIR.search(t))
ck("revealed NPC name present, late NPC absent","Guide" in t and "LateGuy" not in t)
ck("locked ch topic/skill/question hidden","SENTINEL_K1" not in t and "SENTINEL_SKILL1" not in t and "SENTINEL_EFF1" not in t and "SENTINEL_Q2" not in t and "SENTINEL_FORK" not in t)
ck("check on locked chapter refused",call("POST","/api/dungeons/check",{"dungeon":"tdy","ch":1,"challenge":"q2","answer":"SENTINEL_ANS2"})[0]==409)
r=call("POST","/api/dungeons/check",{"dungeon":"tdy","ch":0,"challenge":"q1","answer":"7"})[1];ck("ch0 done",r["chapterDone"])
t=g()
ck("ch1 question visible, still no director fields","SENTINEL_Q2" in t and "SENTINEL_FORK_T" in t and "LateGuy" in t and not DIR.search(t))
r=call("POST","/api/dungeons/check",{"dungeon":"tdy","ch":1,"challenge":"q2","answer":"SENTINEL_ANS2"})[1];ck("ch1 done",r["chapterDone"])
ck("full completion still no director fields",not DIR.search(g()))
print("fails",fails);sys.exit(1 if fails else 0)
