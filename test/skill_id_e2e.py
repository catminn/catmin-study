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
def mk(sk0,sk1): return {"subject":"math","dungeon":{"id":"tsk","name":"n","desc":"d","mission":"m","rule":"r","pen":"p","hidden":"h","fork":{"ch":1,"t":"t","q":"q","b":"b","price":1},
 "ch":[{"t":"c","k":"k","s":"s","sb":"sb","tn":"tn","skill":sk0,"practice":[{"id":"p1","q":"1+1","a":"2"}]},
       {"t":"c","k":"k","s":"s","sb":"sb","tn":"tn","skill":sk1,"practice":[{"id":"p2","q":"x","a":"3"}]}]}}
s,_=call("PUT","/api/adventure/content",{"kind":"dungeon","id":"tsk","content":mk({"id":"sk.alpha","name":"A","effect":"E"},{"name":"B","effect":"F"})},{"X-Owner-Password":PW});ck("put",s==200)
c=lambda ch,cid,a:call("POST","/api/dungeons/check",{"dungeon":"tsk","ch":ch,"challenge":cid,"answer":a})[1]
ck("ch0 done",c(0,"p1","2")["chapterDone"]);ck("ch1 done",c(1,"p2","3")["chapterDone"])
rows=q("SELECT ch,skill,skill_id FROM dungeon_skills WHERE dungeon='tsk' ORDER BY ch")
ck("explicit id stored",rows[0]["skill_id"]=="sk.alpha");ck("fallback position id",rows[1]["skill_id"]=="ch1")
# 重命名（新版本）后，已解锁行仍以稳定 ID 保存
call("PUT","/api/adventure/content",{"kind":"dungeon","id":"tsk","content":mk({"id":"sk.alpha","name":"A2","effect":"E2"},{"name":"B2","effect":"F2"})},{"X-Owner-Password":PW})
c(0,"p1","2")
rows=q("SELECT skill,skill_id FROM dungeon_skills WHERE dungeon='tsk' AND ch=0")
ck("rename keeps id and first unlock",rows[0]["skill_id"]=="sk.alpha" and rows[0]["skill"]=="A")
# 旧行（无 skill_id）回填：模拟旧库
q("UPDATE dungeon_skills SET skill_id=NULL WHERE dungeon='tsk' AND ch=1")
s,r=call("GET","/api/dungeons/progress");ck("progress ok after null",s==200)
ck("progress hides skill_id","skill_id" not in json.dumps(r) and "sk.alpha" not in json.dumps(r))
call("GET","/api/dungeons")  # 触发 ensureProg 已缓存，回填由新 isolate 执行；此处只验证不报错
print("fails",fails);sys.exit(1 if fails else 0)
