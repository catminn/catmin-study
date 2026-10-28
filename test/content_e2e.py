import requests
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
u = requests.Session(); u.trust_env = False
check("未登录不能写", u.put(B + "/api/adventure/content", json={"kind": "npc", "id": "a", "content": {}}).status_code == 401)
check("未登录不能读", u.get(B + "/api/adventure/content").status_code == 401)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
player = requests.Session(); player.trust_env = False; player.headers["Cookie"] = s.headers["Cookie"]
check("玩家会话不能写", player.put(B + "/api/adventure/content", json={"kind": "npc", "id": "a", "content": {}}).status_code == 403)
check("玩家会话不能读列表", player.get(B + "/api/adventure/content").status_code == 403)
check("玩家会话不能读详情", player.get(B + "/api/adventure/content?kind=npc&id=test-npc").status_code == 403)
check("错误口令拒绝", requests.put(B + "/api/adventure/content", json={}, headers={"Cookie": s.headers["Cookie"], "X-Owner-Password": "bad"}).status_code == 403)
s.headers["X-Owner-Password"] = "test-pass-123"
put = lambda b: s.put(B + "/api/adventure/content", json=b)
check("写入 rev1", put({"kind": "npc", "id": "test-npc", "content": {"name": "SECRET-PLACEHOLDER"}}).json().get("rev") == 1)
check("相同内容不新增版本", put({"kind": "npc", "id": "test-npc", "content": {"name": "SECRET-PLACEHOLDER"}}).json().get("unchanged") is True)
check("改动 → rev2", put({"kind": "npc", "id": "test-npc", "content": {"name": "x2"}}).json().get("rev") == 2)
check("坏 kind 拒绝", put({"kind": "bogus", "id": "a", "content": {}}).status_code == 400)
check("坏 id 拒绝", put({"kind": "npc", "id": "Bad Id", "content": {}}).status_code == 400)
check("content 非对象拒绝", put({"kind": "npc", "id": "a", "content": "str"}).status_code == 400)
check("超大拒绝", put({"kind": "npc", "id": "big", "content": {"t": "x" * 70000}}).status_code == 413)
l = s.get(B + "/api/adventure/content").json()
check("列表只含元数据、不含正文", "x2" not in str(l) and l["items"][0]["rev"] == 2, l)
g = s.get(B + "/api/adventure/content?kind=npc&id=test-npc")
check("管理员通道也不返回正文", "x2" not in g.text and "content" not in g.json(), g.text[:200])
ex = player.get(B + "/api/export"); check("导出不含内容库", "x2" not in ex.text and "test-npc" not in ex.text)
print("ALL PASS" if ok else "SOME FAILED")
