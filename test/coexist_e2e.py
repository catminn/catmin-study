# 新旧世界并存（模拟线上：已有无前缀旧世界 + 旧存档）。占位内容。
import requests, json, subprocess, tempfile, os
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); ck = r.headers["Set-Cookie"].split(";")[0]; s.headers["Cookie"] = ck
adm = {"Cookie": ck, "X-Owner-Password": "test-pass-123"}
ENV = dict(os.environ, SITE=B, PASS="test-pass-123")
def imp(f, *a): return subprocess.run(["python3", "scripts/import-bundle.py", f, *a], capture_output=True, text=True, env=ENV)
def start(sid, **k): return s.post(B + "/api/adventure/session", json=dict({"sessionId": sid, "op": "start"}, **k))
def world(sid): return s.get(B + "/api/adventure/world", params={"id": sid}).json()
def turn(text, sid, tid): return s.post(B + "/api/adventure/turn", json={"sessionId": sid, "turnId": tid, "inputText": text}).json()
def outs(o): return [w["publicOutcome"] for w in o.get("worldEvents", [])]
def sql(q): return subprocess.run(["npx", "wrangler", "d1", "execute", "catmin-study", "--local", "--persist-to", os.environ["D"], "-c", "test/wrangler.site.jsonc", "--command", q], capture_output=True, text=True)
def admin(m, p, b=None, h=adm): return getattr(requests, m)(B + p, json=b, headers=h)
LEG = "test/fixtures/placeholder-legacy-bundle.json"
d = tempfile.mkdtemp(); NS = os.path.join(d, "ns.json")
subprocess.run(["node", "scripts/namespace-bundle.mjs", LEG, NS, "world01", "global-story-bible-v1"], capture_output=True, text=True)
n = json.load(open(NS)); [x["content"].update(publicText="PH-PA-NS") for x in n["records"] if x["id"] == "world01:p-a"]; json.dump(n, open(NS, "w"))

check("X0 管理员通道：没有主口令 → 403", admin("post", "/api/adventure/admin/compare", {"records": []}, {"Cookie": ck}).status_code == 403 and admin("get", "/api/adventure/admin/default-world", None, {"Cookie": ck}).status_code == 403)
# 线上现状：旧版世界已导入，两条旧存档（一条有进度）
check("X1 旧版包导入", imp(LEG).returncode == 0)
start("OLD1"); o = turn("现在执行", "OLD1", "o1"); start("OLD2"); world("OLD2")
check("X2 旧存档可玩", outs(o) == ["PH-PE1"], outs(o))
# 模拟更早版本代码留下的“未固定”旧存档
r = sql("DELETE FROM adventure_world_pin; DELETE FROM adventure_world_pin_rev;")
check("X3 （测试准备）清掉固定记录，模拟旧存档", r.returncode == 0, r.stderr[-300:])

c = imp(LEG, "--compare"); c2 = imp(NS, "--compare")
check("X4 只读比对：旧包与线上逐条一致；命名空间包全部是新增；线上没有被包遗漏的记录", "'identical': 6" in c.stdout and "'missing': 6" in c2.stdout and "'onlineNotInBundle': 0" in c2.stdout, [c.stdout, c2.stdout])
lst = admin("get", "/api/adventure/content").json()["items"]
check("X5 比对不写入（修订不变）", all(i["rev"] == 1 for i in lst) and len(lst) == 6, lst)

p = admin("post", "/api/adventure/admin/pin-legacy", {}).json()
check("X6 固定旧存档：预演只给计数", p.get("dryRun") and p["sessions"] == 2 and p["wouldPin"] == 2, p)
p = admin("post", "/api/adventure/admin/pin-legacy", {"confirm": True}).json(); p2 = admin("post", "/api/adventure/admin/pin-legacy", {"confirm": True}).json()
check("X7 显式固定旧存档到旧版世界；重复执行幂等", p["pinned"] == 2 and p2["pinned"] == 0 and p2["alreadyPinned"] == 2, [p, p2])
check("X8 响应不含会话 id", "OLD1" not in json.dumps([p, p2]))

im = imp(NS)
check("X9 导入命名空间世界（新增，不改旧记录）", im.returncode == 0 and "已校验通过" in im.stdout and all(i["rev"] == 1 for i in admin("get", "/api/adventure/content").json()["items"] if ":" not in i["id"]), im.stdout[-300:])
o = turn("继续", "OLD1", "o2")
check("X10 旧存档继续读旧版世界", world("OLD1").get("active") and world("OLD2").get("publicText") == "PH-PA", [world("OLD1"), world("OLD2")])
start("NEW0")
check("X11 两个世界、未设默认：新会话失败关闭（不猜）", not world("NEW0").get("active"))
dw = admin("put", "/api/adventure/admin/default-world", {"worldId": "world01"}).json()
start("NEW1")
check("X12 设默认世界 world01：之后的新会话固定到 world01", dw.get("defaultWorldId") == "world01" and world("NEW1").get("publicText") == "PH-PA-NS", [dw, world("NEW1")])
check("X13 默认世界不影响已固定会话（旧存档、NEW0 之前的状态）", world("OLD2").get("publicText") == "PH-PA")
check("X14 默认世界必须存在；可清除，清除后新会话又失败关闭", admin("put", "/api/adventure/admin/default-world", {"worldId": "nope"}).status_code == 404 and admin("put", "/api/adventure/admin/default-world", {"worldId": None}).json()["defaultWorldId"] is None and (start("NEW2") and not world("NEW2").get("active")))
check("X15 NEW1 清除默认后仍在 world01（固定不变）", world("NEW1").get("publicText") == "PH-PA-NS")
g = admin("get", "/api/adventure/admin/default-world").json()
check("X16 世界概览：两个世界（一个旧版、一个命名空间）", sorted((w["namespaced"]) for w in g["worlds"]) == [False, True], g)
a = subprocess.run(["python3", "scripts/import-bundle.py", "--world-status"], capture_output=True, text=True, env=ENV)
b2 = subprocess.run(["python3", "scripts/import-bundle.py", "--set-default", "world01"], capture_output=True, text=True, env=ENV)
c3 = subprocess.run(["python3", "scripts/import-bundle.py", "--pin-legacy"], capture_output=True, text=True, env=ENV)
check("X17 脚本管理命令：世界状态/设默认/固定预演可用", a.returncode == 0 and b2.returncode == 0 and "world01" in b2.stdout and c3.returncode == 0 and "dryRun" in c3.stdout, [a.stdout, b2.stdout, c3.stdout, a.stderr[-200:]])
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
