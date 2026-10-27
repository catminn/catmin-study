import json,base64,hashlib,os,re,urllib.parse,requests
B="http://localhost:8799"; s=requests.Session(); s.trust_env=False
reg=s.post(B+"/register",json={"redirect_uris":["http://localhost:9999/cb"],"client_name":"t","token_endpoint_auth_method":"none"}).json()
ver=base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode(); ch=base64.urlsafe_b64encode(hashlib.sha256(ver.encode()).digest()).rstrip(b"=").decode()
r=s.get(B+"/authorize",params=dict(response_type="code",client_id=reg["client_id"],redirect_uri="http://localhost:9999/cb",code_challenge=ch,code_challenge_method="S256",state="x",resource=B+"/mcp"),allow_redirects=False)
h=re.search(r'name="handle" value="([^"]+)"',r.text).group(1)
r=s.post(B+"/authorize",data={"handle":h,"password":"test-pass-123","decision":"approve"},headers={"Cookie":r.headers["Set-Cookie"].split(";")[0]},allow_redirects=False)
code=urllib.parse.parse_qs(urllib.parse.urlparse(r.headers["Location"]).query)["code"][0]
tok=s.post(B+"/token",data=dict(grant_type="authorization_code",code=code,redirect_uri="http://localhost:9999/cb",client_id=reg["client_id"],code_verifier=ver,resource=B+"/mcp")).json()["access_token"]
def call(n,a):
    r=s.post(B+"/mcp",json={"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":n,"arguments":a}},headers={"Authorization":"Bearer "+tok}).json()["result"]
    return r["content"][0]["text"],r.get("isError")
print("tools:",[t["name"] for t in s.post(B+"/mcp",json={"jsonrpc":"2.0","id":1,"method":"tools/list"},headers={"Authorization":"Bearer "+tok}).json()["result"]["tools"]][-5:])
print("get empty:",call("study_state_get",{"key":"state"})[0])
print("put new:",call("study_state_put",{"key":"state","value":{"pts":10,"中文":"好"},"base_version":0,"source":"artifact"})[0])
print("put ok v1->2:",call("study_state_put",{"key":"state","value":{"pts":20},"base_version":1,"source":"artifact"})[0])
print("put stale:",call("study_state_put",{"key":"state","value":{"pts":99},"base_version":1,"source":"site"})[0])
print("get:",call("study_state_get",{"key":"state"})[0])
print("force:",call("study_state_put",{"key":"state","value":{"pts":30},"base_version":1,"force":True,"source":"site"})[0])
print("bad key:",call("study_state_get",{"key":"../x"}))
print("list:",call("study_state_list",{})[0][:200])
print("sum add:",call("chat_summary_add",{"subject":"math","summary":"复习了链式法则","source":"artifact"})[0])
print("sum list:",call("chat_summary_list",{"subject":"math"})[0][:200])
print("memory still ok:",call("memory_health",{})[0][:80])
