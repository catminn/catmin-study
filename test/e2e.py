import json, base64, hashlib, os, re, urllib.parse, requests
B="http://localhost:8799"
s=requests.Session(); s.trust_env=False
r=s.post(B+"/mcp",json={"jsonrpc":"2.0","id":1,"method":"tools/list"})
print("1 unauth:",r.status_code,r.headers.get("WWW-Authenticate"))
print("2 prm:",s.get(B+"/.well-known/oauth-protected-resource/mcp").json())
asm=s.get(B+"/.well-known/oauth-authorization-server").json(); print("  as:",asm["authorization_endpoint"],asm.get("registration_endpoint"))
reg=s.post(B+"/register",json={"redirect_uris":["http://localhost:9999/cb"],"client_name":"Test Client <script>","token_endpoint_auth_method":"none"}).json()
cid=reg["client_id"]; print("3 registered",cid[:8])
ver=base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode(); ch=base64.urlsafe_b64encode(hashlib.sha256(ver.encode()).digest()).rstrip(b"=").decode()
q=dict(response_type="code",client_id=cid,redirect_uri="http://localhost:9999/cb",code_challenge=ch,code_challenge_method="S256",state="xyz",scope="memory",resource=B+"/mcp")
r=s.get(B+"/authorize",params=q,allow_redirects=False)
print("4 authorize page",r.status_code,"escaped name:", "&#60;script&#62;" in r.text, "cookies:",list(r.cookies.keys()))
handle=re.search(r'name="handle" value="([^"]+)"',r.text).group(1)
cookie=r.headers.get("Set-Cookie","").split(";")[0]
H={"Cookie":cookie}
r=requests.post(B+"/authorize",data={"handle":handle,"password":"wrong","decision":"approve"},headers=H,allow_redirects=False)
print("5 wrong pw:",r.status_code,"口令不对" in r.text)
r=requests.post(B+"/authorize",data={"handle":handle,"password":"test-pass-123","decision":"approve"},headers=H,allow_redirects=False)
loc=r.headers.get("Location",""); print("6 right pw:",r.status_code,loc[:60])
code=urllib.parse.parse_qs(urllib.parse.urlparse(loc).query)["code"][0]
tok=requests.post(B+"/token",data=dict(grant_type="authorization_code",code=code,redirect_uri="http://localhost:9999/cb",client_id=cid,code_verifier=ver,resource=B+"/mcp")).json()
print("7 token:", "access_token" in tok, "refresh" , "refresh_token" in tok)
A={"Authorization":"Bearer "+tok["access_token"]}
def rpc(method,params=None,i=[0]):
    i[0]+=1; r=requests.post(B+"/mcp",json={"jsonrpc":"2.0","id":i[0],"method":method,"params":params or {}},headers=A); r.raise_for_status(); return r.json()
def call(name,args):
    res=rpc("tools/call",{"name":name,"arguments":args})["result"]; return res["content"][0]["text"], res.get("isError")
print("8 init:",rpc("initialize",{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}})["result"]["protocolVersion"])
print("  notif:",requests.post(B+"/mcp",json={"jsonrpc":"2.0","method":"notifications/initialized"},headers=A).status_code)
print("  tools:",[t["name"] for t in rpc("tools/list")["result"]["tools"]])
# admin
AD={"Authorization":"Bearer admin-token-0123456789abcdef"}
print("9 admin no token:",requests.post(B+"/admin/reindex").status_code)
print("  import:",requests.post(B+"/admin/import",data=open("../migration/export_default.json","rb").read(),headers={**AD,"Content-Type":"application/json"}).json())
print("  import again:",requests.post(B+"/admin/import",data=open("../migration/export_default.json","rb").read(),headers={**AD,"Content-Type":"application/json"}).json())
print("  reindex:",requests.post(B+"/admin/reindex",headers=AD).json())
print("10 health:",call("memory_health",{})[0][:300])
t,_=call("memory_search",{"query":"MATH 1920 讲课进度 作业 Prelim 考试","limit":4,"max_response_chars":5000}); print("11 search:",t[:120].replace("\n"," | "), "...hash lines:",t.count("\nHash: "))
t,_=call("memory_search",{"query":"Prelim","mode":"exact","limit":3}); print("12 exact:",t.count("=== Memory"))
t,_=call("memory_search",{"time_expr":"last week","limit":50}); print("13 time last week:",t.split("\n")[0])
t,_=call("memory_search",{"query":"学习","tags":["chem2090"],"limit":20}); print("14 tag filter: found",t.count("=== Memory"))
t,_=call("memory_store",{"content":"测试记忆：这是一条测试","metadata":{"tags":"test,tmp","type":"note"}}); print("15 store:",t); h=json.loads(t)["content_hash"]
print("  dup:",call("memory_store",{"content":"测试记忆：这是一条测试"})[0][:60])
print("16 update:",call("memory_update",{"content_hash":h,"updates":{"tags":["test","x"],"metadata":{"p":1}}})[0])
l=json.loads(call("memory_list",{"tags":["x"]})[0]); print("  list x:",l["total"],l["memories"][0]["metadata"],l["memories"][0]["tags"])
print("17 list page:",{k:v for k,v in json.loads(call("memory_list",{"page_size":5,"page":2})[0]).items() if k!="memories"})
print("18 mistake add:",call("mistake_note_add",{"error_pattern":"测试错题","context_signature":"MATH 1920 · 测试","incorrect_action":"x","correct_action":"y"})[0])
print("   again:",call("mistake_note_add",{"error_pattern":"测试错题","context_signature":"MATH 1920 · 测试","incorrect_action":"x","correct_action":"y"})[0])
m=json.loads(call("mistake_note_search",{"query":"链式法则 方向导数","limit":3})[0]); print("19 mistake search:",m["count"],[ (n["error_pattern"][:20],n["failure_count"]) for n in m["notes"]])
mh=json.loads(call("mistake_note_search",{"query":"测试错题","limit":1})[0])["notes"][0]["content_hash"]
print("20 mistake update:",call("mistake_note_update",{"content_hash":mh,"correct_action":"z"})[0])
nh=json.loads(call("mistake_note_search",{"query":"测试错题","limit":1})[0])["notes"][0]
print("   ->",nh["correct_action"],nh["failure_count"])
print("21 delete no filter:",call("memory_delete",{}))
print("   delete dry:",call("memory_delete",{"tags":["test"],"dry_run":True})[0][:80])
print("   delete:",call("memory_delete",{"tags":["test"]})[0][:60])
print("   mistake delete:",call("mistake_note_delete",{"content_hash":nh["content_hash"]})[0])
print("22 final health:",json.loads(call("memory_health",{})[0])["total_memories"])
print("23 bad token:",requests.post(B+"/mcp",json={"jsonrpc":"2.0","id":1,"method":"tools/list"},headers={"Authorization":"Bearer nope"}).status_code)
