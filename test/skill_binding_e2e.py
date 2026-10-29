# skill.id 持久化（占位内容）：显式 id 落库、缺省用章位置 ID、重命名不丢、旧行回填、GET 不暴露 skill_id
import json,sys,os,subprocess,urllib.request
B="http://localhost:8800";PW="test-pass-123";DB=os.environ["DBDIR"]
CK=[""];op=urllib.request.build_opener()
def call(m,p,b=None,h=None):
    r=urllib.request.Request(B+p,data=json.dumps(b).encode() if b is not None else None,method=m,headers={"content-type":"application/json","Origin":B,"Cookie":CK[0],**(h or {})})
    try:
        x=op.open(r);sc=x.headers.get('Set-Cookie')
        if sc: CK[0]=sc.split(';')[0]
        return x.status,json.loads(x.read())
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b"{}")
fails=0
def ck(n,c):
    global fails
    print(("ok  " if c else "FAIL"),n)
    if not c: fails+=1
def q(sql):
    o=subprocess.run(["npx","wrangler","d1","execute","catmin-study","--local","--persist-to",DB,"-c","test/wrangler.site.jsonc","--json","--command",sql],capture_output=True,text=True).stdout
    return json.loads(o)[0].get("results",[])
call("POST","/api/login",{"password":PW})
A={"X-Owner-Password":PW}
D={"subject":"math","dungeon":{"id":"sb1","name":"n","desc":"d","mission":"m","rule":"r","pen":"p","hidden":"hd","fork":{"ch":0,"t":"ft","q":"fq","b":"fb","price":1},"cast":[["G","r","sec",0]],
 "ch":[{"t":"t0","k":"k0","s":"s0","sb":"b0","tn":"n0","skill":{"name":"SK","effect":"E","id":"sk.a"},"practice":[{"id":"q1","q":"Q1","a":"7","hint":"h"}]}]}}
ck("put dungeon",call("PUT","/api/adventure/content",{"kind":"dungeon","id":"dsb","content":D},A)[0]==200)
def put(kind,id,content):
    return call("PUT","/api/adventure/content",{"kind":kind,"id":id,"content":dict(content,id=id,kind=kind)},A)[0]==200
ck("put world",all([put("world","w",{"startSceneId":"s-a"}),put("scene","s-a",{"choices":["s-b","s-c"]}),put("scene","s-b",{"choices":[]}),put("scene","s-c",{"choices":[]})]))
bind=lambda k,**o:call("PUT","/api/adventure/admin/skill-binding",dict({"actionKey":k,"worldId":"w","dungeonId":"sb1","manifestRevision":1,"chapter":0,"skillId":"sk.a","from":"s-a","to":"s-b","advantage":"evidence_option"},**o),A)
ck("player cannot register",call("PUT","/api/adventure/admin/skill-binding",{"actionKey":"x","worldId":"w","dungeonId":"sb1","manifestRevision":1,"chapter":0,"skillId":"sk.a","from":"s-a","to":"s-b","advantage":"risk_context"})[0] in (401,403))
ck("register ok",bind("ak-ok")[0]==200)
ck("duplicate rejected",bind("ak-ok")[0]==409)
ck("bad advantage rejected",bind("ak-bad",advantage="auto_win")[0]==400)
ck("register wrong-rev",bind("ak-rev",manifestRevision=99)[0]==200)
ck("register wrong-skill",bind("ak-skill",skillId="other")[0]==200)
ck("register other-exit",bind("ak-exit",to="s-c")[0]==200)
def start(s):
    call("POST","/api/adventure/session",{"sessionId":s,"op":"start"})
def notes(s): return q("SELECT commit_id,action_key,skill_id,advantage FROM adventure_action_notes WHERE session_id='%s'"%s)
def trav(s,c,t,ak=None,**x):
    b={"sessionId":s,"commitId":c,"target":t};
    if ak: b["actionKey"]=ak
    b.update(x);return call("POST","/api/adventure/travel",b)
# 1) 章节未核验：增强不生效，但普通出口照常
start("S1");r=trav("S1","c1","s-b","ak-ok")
ck("unverified: travel still works as base",r[0]==200 and notes("S1")==[])
call("POST","/api/dungeons/check",{"dungeon":"sb1","ch":0,"challenge":"q1","answer":"7"})
# 2) 核验后：正向
start("S2");r=trav("S2","c1","s-b","ak-ok")
ck("verified: advantage recorded privately",r[0]==200 and len(notes("S2"))==1 and notes("S2")[0]["skill_id"]=="sk.a")
ck("player-visible body unchanged (no skill/key/evidence)",set(r[1].keys())=={"ok","replay","worldEvents"} and "ak-ok" not in json.dumps(r[1]) and "sk.a" not in json.dumps(r[1]))
r2=trav("S2","c1","s-b","ak-ok")
ck("replay idempotent, no second note",r2[0]==200 and r2[1].get("replay") is True and len(notes("S2"))==1)
ck("same commitId different actionKey -> 409",trav("S2","c1","s-b","ak-exit")[0]==409)
# 3) 不符合的绑定都只当普通出口
for n,ak,tgt in [("wrong revision","ak-rev","s-b"),("different skill (not unlocked)","ak-skill","s-b"),("exit mismatch","ak-ok","s-c"),("unknown key","nope","s-b"),("binding for other exit","ak-exit","s-b")]:
    s="S3"+n.replace(" ","")[:6];start(s);r=trav(s,"c1",tgt,ak)
    ck("fail closed -> base travel only: "+n,r[0]==200 and notes(s)==[])
ck("malformed actionKey rejected",trav("S2x","c9","s-b","bad key!")[0] in (400,404))
# 4) 不带 actionKey：普通出口，无注记
start("S4");r=trav("S4","c1","s-b")
ck("base travel without key",r[0]==200 and notes("S4")==[])
# 5) 基础规则不被绕过：不可达出口即使有 actionKey 也不行
start("S5");r=trav("S5","c1","s-zzz","ak-ok")
ck("illegal target still refused",r[0]==422 and notes("S5")==[])
# 6) 跨世界：另一会话 pin 到别的世界
ck("no HTTP read path for bindings/notes",call("GET","/api/adventure/admin/skill-binding")[0] in (401,403,404,405) and "ak-ok" not in json.dumps(call("GET","/api/dungeons")[1]))
print("fails",fails);sys.exit(1 if fails else 0)
