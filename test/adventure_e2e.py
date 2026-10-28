import requests, concurrent.futures as cf
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
def post(p, b): r = s.post(B + p, json=b); return r.status_code, r.json()
def ev(i, **k):
    e = dict(id=i, type="knowledge_attempt", topicId="math1920.gradient", at=1, correctness="correct", reasoning="valid", assistance="none", verification="confirmed", context="adventure", transfer=False); e.update(k); return e
for e in [ev("a1"), ev("a2", reasoning="invalid"), ev("a3", verification="pending"), ev("a4", assistance="major_hint"), ev("a5")]: post("/api/events", e)
c, o = post("/api/adventure/action", {"actionId": "x1", "basisEventId": "a1"})
check("有效依据：加成 3", c == 200 and o["outcome"]["bonus"] == 3 and not o["replay"], o)
c2, o2 = post("/api/adventure/action", {"actionId": "x1", "basisEventId": "a1"})
check("断线重试返回原结果，不重掷", c2 == 200 and o2["replay"] and o2["outcome"] == o["outcome"], o2)
check("同 actionId 换依据 → 409", post("/api/adventure/action", {"actionId": "x1", "basisEventId": "a5"})[0] == 409)
c, o = post("/api/adventure/action", {"actionId": "x2", "basisEventId": "a1"})
check("同依据不能再用（不叠加知识优势）", c == 409 and o["code"] == "basis_already_used", o)
c, o = post("/api/adventure/action", {"actionId": "x3", "basisEventId": "a2"})
check("答案对但理由无效：无加成", c == 200 and o["outcome"]["bonus"] == 0, o)
check("待验证依据被拒", post("/api/adventure/action", {"actionId": "x4", "basisEventId": "a3"})[0] == 422)
c, o = post("/api/adventure/action", {"actionId": "x5", "basisEventId": "a4"})
check("重度提示：加成减半", c == 200 and o["outcome"]["bonus"] == 1, o)
check("依据不存在被拒", post("/api/adventure/action", {"actionId": "x6", "basisEventId": "ghost"})[0] == 422)
c, o = post("/api/adventure/action", {"actionId": "x7"})
check("无依据也能行动（骰子失败不影响学术记录）", c == 200 and o["outcome"]["bonus"] == 0 and o["outcome"]["dc"] == 12 and 1 <= o["outcome"]["roll"] <= 20, o)
check("客户端不能指定 DC/加成", post("/api/adventure/action", {"actionId": "x8", "dc": 1, "bonus": 99})[1]["outcome"]["dc"] == 12)
with cf.ThreadPoolExecutor(10) as ex: res = list(ex.map(lambda i: post("/api/adventure/action", {"actionId": "race", "basisEventId": "a5"}), range(10)))
check("并发同 actionId：结果一致", len({str(o.get("outcome")) for c, o in res if c == 200}) == 1 and all(c == 200 for c, o in res), res[:2])
check("坏 actionId 被拒", post("/api/adventure/action", {"actionId": "a b"})[0] == 400)
# 会话
check("开始会话", post("/api/adventure/session", {"sessionId": "s1", "op": "start"})[1]["status"] == "active")
post("/api/adventure/session", {"sessionId": "s1", "op": "progress", "segment": 3})
check("暂停", post("/api/adventure/session", {"sessionId": "s1", "op": "pause"})[1]["status"] == "paused")
post("/api/adventure/session", {"sessionId": "s1", "op": "progress", "segment": 1})
c, o = post("/api/adventure/session", {"sessionId": "s1", "op": "resume"})
check("恢复在第 3 段，进度不倒退，世界序号不变", o["segment"] == 3 and o["status"] == "active" and o["worldSeq"] == 0, o)
check("不存在的会话", post("/api/adventure/session", {"sessionId": "nope", "op": "pause"})[0] == 404)
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
