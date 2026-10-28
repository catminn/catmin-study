import requests, concurrent.futures as cf
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
def post(p, b): r = s.post(B + p, json=b); return r.status_code, r.json()
post("/api/adventure/session", {"sessionId": "AS", "op": "start"})
post("/api/adventure/session", {"sessionId": "AO", "op": "start"})
def seed(tid, text, sid="AS"):
    c, o = post("/api/adventure/turn", {"sessionId": sid, "turnId": tid, "inputText": text}); return "turn:" + tid + ":eval"
a1 = seed("sd1", "先展开再求导 A"); a2 = seed("sd2", "乘 2"); a3 = seed("sd3", "先展开再求导 NOAGREE"); a4 = seed("sd4", "提示后我算出来了"); a5 = seed("sd5", "先展开再求导 B")
oth = seed("sdo", "先展开再求导 C", "AO")
T = "apply-derivative-method"
def act(i, b=None, **k):
    d = {"actionId": i}
    if b: d.update(basisEventId=b, sessionId="AS", actionTemplate=T)
    d.update(k); return post("/api/adventure/action", d)
c, o = act("x1", a1)
check("有效依据：加成 3", c == 200 and o["outcome"]["bonus"] == 3 and not o["replay"], o)
c2, o2 = act("x1", a1)
check("断线重试返回原结果，不重掷", c2 == 200 and o2["replay"] and o2["outcome"] == o["outcome"], o2)
check("同 actionId 换依据 → 409", act("x1", a5)[0] == 409)
c, o = act("x2", a1)
check("同依据不能再用（不叠加知识优势）", c == 409 and o["code"] == "basis_already_used", o)
c, o = act("x3", a2)
check("答案对但理由无效：不会被确认，不能当依据", c == 422 and o["code"] == "basis_not_confirmed", o)
check("待验证依据被拒", act("x4", a3)[0] == 422)
c, o = act("x5", a4)
check("重度提示：加成减半", c == 200 and o["outcome"]["bonus"] == 1, o)
check("依据不存在被拒", act("x6", "ghost")[0] == 422)
c, o = act("x7")
check("无依据也能行动（骰子失败不影响学术记录）", c == 200 and o["outcome"]["bonus"] == 0 and o["outcome"]["dc"] == 12 and 1 <= o["outcome"]["roll"] <= 20, o)
check("客户端不能指定 DC/加成", post("/api/adventure/action", {"actionId": "x8", "dc": 1, "bonus": 99})[1]["outcome"]["dc"] == 12)
# 直接调 API 也不能绕过 pickBasis（#19 P0-2）
c, o = post("/api/adventure/action", {"actionId": "b1", "basisEventId": a5}); check("用依据必须带 actionTemplate/sessionId", c == 400, o)
c, o = post("/api/adventure/action", {"actionId": "b2", "basisEventId": a5, "sessionId": "AS", "actionTemplate": "determine-local-steepest-ascent"}); check("知识点不匹配的行动被拒", c == 422 and o["code"] == "basis_concept_mismatch", o)
c, o = post("/api/adventure/action", {"actionId": "b3", "basisEventId": a5, "sessionId": "AS", "actionTemplate": "plain-action"}); check("普通行动不吃加成依据", c == 422 and o["code"] == "basis_not_applicable", o)
c, o = post("/api/adventure/action", {"actionId": "b4", "basisEventId": oth, "sessionId": "AS", "actionTemplate": T}); check("别的会话的依据被拒", c == 422 and o["code"] == "basis_wrong_session", o)
check("坏模板被拒", post("/api/adventure/action", {"actionId": "b5", "basisEventId": a5, "sessionId": "AS", "actionTemplate": "x"})[0] == 400)
with cf.ThreadPoolExecutor(10) as ex: res = list(ex.map(lambda i: act("race", a5), range(10)))
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
