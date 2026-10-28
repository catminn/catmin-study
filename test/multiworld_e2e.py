import requests, json
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
adm = {"Cookie": s.headers["Cookie"], "X-Owner-Password": "test-pass-123"}
def putc(kind, id, content):
    return requests.put(B + "/api/adventure/content", json={"kind": kind, "id": id, "content": dict(content, id=id, kind=kind)}, headers=adm).status_code
def put(kind, id, content): return putc(kind, id, content) == 200
def start(sid, **k): return s.post(B + "/api/adventure/session", json=dict({"sessionId": sid, "op": "start"}, **k))
def world(sid): return s.get(B + "/api/adventure/world", params={"id": sid}).json()
def turn(text, sid, tid): return s.post(B + "/api/adventure/turn", json={"sessionId": sid, "turnId": tid, "inputText": text}).json()
def outs(o): return [w["publicOutcome"] for w in o.get("worldEvents", [])]

# 占位内容：两个世界使用相同的 localId（start/s2），内容互不相同
for w, tag in (("wa", "A"), ("wb", "B")):
    put("world", w + ":world", {"worldId": w, "startSceneRef": w + ":start"})
    put("scene", w + ":start", {"choices": ["s2"], "publicText": "P" + tag + "-START"})
    put("scene", w + ":s2", {"choices": [], "publicText": "P" + tag + "-S2"})
    put("event", w + ":e1", {"trigger": {"type": "action_resolved", "sceneId": "start"}, "effects": [], "publicOutcome": "E" + tag + "-OUT"})
check("M0 命名空间 id 合法写入；课程包不允许带命名空间；非法限定 id 被拒", putc("course", "wa:c1", {"version": "1", "concepts": []}) == 400 and putc("scene", "Bad:x", {}) == 400 and putc("scene", "wa:a:b", {}) == 400)

start("M1")
check("M1 世界不唯一且未显式选择：引擎不介入（不猜世界）", not world("M1").get("active"), world("M1"))
check("M2 显式选择世界 wa / wb：同名 localId 各读各的", start("MA", worldId="wa").status_code == 200 and start("MB", worldId="wb").status_code == 200 and world("MA").get("publicText") == "PA-START" and world("MB").get("publicText") == "PB-START", [world("MA"), world("MB")])
check("M3 未知 worldId → 400；已固定到 wa 的会话不能改选 wb", start("M3", worldId="nope").status_code == 400 and start("MA", worldId="wb").status_code == 400)
oa = turn("现在执行", "MA", "ma1"); ob = turn("现在执行", "MB", "mb1")
check("M4 事件按世界隔离：wa 会话只触发 wa 的事件，wb 同理", outs(oa) == ["EA-OUT"] and outs(ob) == ["EB-OUT"], [outs(oa), outs(ob)])

# 修订固定：发布 wa:start 新修订，旧会话不变，新会话读新修订
put("scene", "wa:start", {"choices": ["s2"], "publicText": "PA-START-2"})
start("MA2", worldId="wa")
check("M5 新修订只对新会话生效；已固定的会话继续读固定修订", world("MA").get("publicText") == "PA-START" and world("MA2").get("publicText") == "PA-START-2", [world("MA"), world("MA2")])

# 跨世界引用：别的世界前缀不被解析
put("scene", "wb:other", {"choices": [], "publicText": "PB-OTHER"})
put("scene", "wa:start", {"choices": ["s2", "wb:other", "wa:s2"], "publicText": "PA-START-3"})
start("MA3", worldId="wa")
labels = world("MA3").get("options", [])
check("M6 别的世界的限定引用被拒（不回落）；本世界的限定引用等同 localId", len(labels) == 2, labels)
check("M7 玩家响应不含 worldId/限定 id", "wb:" not in json.dumps(world("MA3")) and "wa:" not in json.dumps(world("MA3")))
# 内容里写本世界的限定引用（作者规范写法）：与 localId 等价
put("world", "wq:world", {"startSceneRef": "wq:start"})
put("scene", "wq:start", {"choices": ["wq:s2"], "choiceLabels": {"wq:s2": "PH-Q-LABEL"}, "publicText": "PQ-START"})
put("scene", "wq:s2", {"choices": [], "publicText": "PQ-S2"})
put("event", "wq:e1", {"trigger": {"type": "action_resolved", "sceneId": "wq:start"}, "effects": [], "publicOutcome": "EQ-OUT"})
start("MQ", worldId="wq"); oq = turn("现在执行", "MQ", "mq1")
check("M8 本世界限定引用（startSceneRef/choices/choiceLabels 键/触发场景）可用", world("MQ").get("publicText") == "PQ-START" and world("MQ").get("options") == ["PH-Q-LABEL"] and outs(oq) == ["EQ-OUT"], [world("MQ"), outs(oq)])

# 转换+导入流水线（占位旧包）：namespace-bundle → import-bundle（本地站点）→ 世界清单按确切修订校验 → 显式选世界可玩
import subprocess, tempfile, os
d = tempfile.mkdtemp(); nb = os.path.join(d, "ns.json")
cv = subprocess.run(["node", "scripts/namespace-bundle.mjs", "test/fixtures/placeholder-legacy-bundle.json", nb, "world01", "global-v1"], capture_output=True, text=True)
im = subprocess.run(["python3", "scripts/import-bundle.py", nb], capture_output=True, text=True, env=dict(os.environ, SITE=B, PASS="test-pass-123"))
man = json.load(open(nb + ".manifest.json")) if os.path.exists(nb + ".manifest.json") else {}
check("M9 转换+导入成功，清单按服务器返回的确切修订校验通过", cv.returncode == 0 and im.returncode == 0 and "已校验通过" in im.stdout and man.get("worldId") == "world01" and len(man.get("contentRefs", [])) == 6 and all(e["rev"] >= 1 for e in man["contentRefs"]), [cv.stdout, im.stdout[-300:], im.stderr[-300:]])
check("M10 导入不改动已有世界：wa 旧会话仍读固定修订", world("MA").get("publicText") == "PA-START")
start("MW", worldId="world01"); ow = turn("现在执行", "MW", "mw1")
check("M11 导入的世界可显式选择并运行（事件触发）", world("MW").get("publicText") == "PH-PA" and outs(ow) == ["PH-PE1"], [world("MW"), outs(ow)])
im2 = subprocess.run(["python3", "scripts/import-bundle.py", nb], capture_output=True, text=True, env=dict(os.environ, SITE=B, PASS="test-pass-123"))
check("M12 重复导入幂等（全部未变，修订不增）", im2.returncode == 0 and "新写入/更新 0" in im2.stdout and json.load(open(nb + ".manifest.json")) == man, im2.stdout[-200:])
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
