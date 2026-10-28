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
s,r=call("GET","/api/dungeons");ck("list hides answers","\"a\"" not in json.dumps(r) and r["dungeons"][0]["dungeon"]["ch"][0]["practice"][0]["id"]=="p1")
c=lambda cid,a:call("POST","/api/dungeons/check",{"dungeon":"tdx","ch":0,"challenge":cid,"answer":a})[1]
r=c("p1","3");ck("wrong",r["correct"]==False and r["hint"]=="hi" and not r["chapterDone"] and r["skill"] is None)
r=c("p1"," 2 ");ck("right",r["correct"] and r["next"]=="p2" and not r["chapterDone"])
r=c("p2","3*X^2");ck("alt answer + chapter done + skill",r["correct"] and r["chapterDone"] and r["skill"]["name"]=="S")
r=c("p1","999");ck("verified stays",r["verified"] and not r["correct"])
ck("unknown challenge 404",call("POST","/api/dungeons/check",{"dungeon":"tdx","ch":0,"challenge":"zz","answer":"1"})[0]==404)
s,r=call("GET","/api/dungeons/progress");ck("progress",len(r["verified"])==2 and len(r["skills"])==1)
print("fails",fails);sys.exit(1 if fails else 0)
