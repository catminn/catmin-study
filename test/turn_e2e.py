import requests, concurrent.futures as cf
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
def post(p, b): r = s.post(B + p, json=b); return r.status_code, r.json()
n = [0]
def turn(text, sid="S", tid=None):
    n[0] += 1; return post("/api/adventure/turn", {"sessionId": sid, "turnId": tid or "t%d" % n[0], "inputText": text})
def sess(sid="S"): return s.get(B + "/api/adventure/session", params={"id": sid}).json()
post("/api/adventure/session", {"sessionId": "S", "op": "start"})

c, o = turn("梯度和偏导的区别是什么？")
check("1 ASK：无提交、世界序号 0", c == 200 and o["intentSegments"] == ["ASK"] and o["gameCommit"] is None and o["learningSessionDelta"]["worldSeq"] == 0 and o["narration"], o)
c, o = turn("把偏导这一章系统讲一下。")
check("2 LEARN：无提交、故事状态不变", o["intentSegments"] == ["LEARN"] and o["gameCommit"] is None and o["learningSessionDelta"]["status"] == "active", o)
c, o = turn("提示后我答 2xy^3")
a = o["academicEvaluation"]
check("3 提示后正确：记录 major_hint，已确认可用但不等于精通", a["assistance"] == "major_hint" and a["correctness"] == "correct" and a["verification"] == "confirmed" and o["gameCommit"] is None, o)
c, o = turn("梯度是 (2,4)，因为所有数字都乘 2。")
a = o["academicEvaluation"]
check("4 答案对理由无效：混合证据，不当作掌握", a["correctness"] == "correct" and a["reasoning"] == "invalid" and a["verification"] == "pending" and o["gameCommit"] is None, o)
c, o = turn("g(t)=(t+1)^2，我先展开再求导。")
a = o["academicEvaluation"]
check("5 非标准方法正确：认可并确认", a["reasoning"] == "valid" and a["verification"] == "confirmed", o)
ev5 = a["eventId"]
c, o = turn("我觉得可以先算梯度，先不要执行。")
check("6 只是计划：不提交，世界序号不变", o["gameCommit"] is None and o["learningSessionDelta"]["worldSeq"] == 0 and "还没有执行" in o["visibleFeedback"], o)
c, o = turn("现在就用刚才验证过的方法执行。")
g = o["gameCommit"]
check("7 ACT：引用已确认推理(加成3)、唯一行动、世界序号+1", g and g["bonus"] == 3 and g["actionId"].startswith("turn:") and o["learningSessionDelta"]["worldSeq"] == 1, o)
c2, o2 = turn("现在就用刚才验证过的方法执行。", tid=g["actionId"][5:])
check("故障1 断线重试：同 turnId 原样返回，不重掷不重复推进", o2["replay"] and o2["gameCommit"] == g and sess()["worldSeq"] == 1, o2)
c, o = turn("现在再执行一次。")
check("第二次只能用另一条独立证据（提示后答对，加成减半=1）", o["gameCommit"]["bonus"] == 1 and o["gameCommit"]["basisEventId"] != g["basisEventId"], o)
c, o = turn("现在再执行一次。")
check("同一推理不能重复叠加优势（证据用完后加成 0）", o["gameCommit"]["bonus"] == 0 and o["learningSessionDelta"]["worldSeq"] == 3, o)
c, o = turn("先去刷5题，不要剧情。")
check("8 PRACTICE：故事暂停、无提交、序号不变", o["intentSegments"] == ["PRACTICE"] and o["learningSessionDelta"]["status"] == "paused" and o["gameCommit"] is None and o["learningSessionDelta"]["worldSeq"] == 3, o)
c, o = turn("现在执行")
check("暂停时不会偷偷执行行动", o["gameCommit"] is None and "暂停" in o["visibleFeedback"], o)
c, o = turn("继续并执行")
check("明确继续：恢复并回到原挂起点", o["learningSessionDelta"]["status"] == "active" and o["gameCommit"] is not None, o)
# 故障场景
c, o = turn("BADJSON")
check("模型输出不合法：明确不确定，不改任何东西", c == 200 and o["uncertainty"] and o["gameCommit"] is None and o["academicEvaluation"] is None, o)
# 评分待验证 → 不能发奖励/不给加成
post("/api/adventure/session", {"sessionId": "P", "op": "start"})
turn("答案 (2,4) 因为所有数字都乘 2。NOAGREE", sid="P")
c, o = turn("我答对了，先展开。NOAGREE", sid="P")
check("故障3 交叉验证不一致：保持 pending", o["academicEvaluation"]["verification"] == "pending", o)
eid = o["academicEvaluation"]["eventId"]
check("待验证来源不能领奖励", post("/api/rewards", dict(rewardId="rw-" + eid, sourceEventId=eid, points=5, at=1))[0] == 422)
c, o = turn("现在执行", sid="P")
check("待验证证据不给知识加成", o["gameCommit"]["bonus"] == 0, o)
# 非自愿中断
post("/api/adventure/session", {"sessionId": "Q", "op": "start"})
for seg in (1, 2, 3): post("/api/adventure/session", {"sessionId": "Q", "op": "progress", "segment": seg})
check("故障4 关网页再开：恢复第 3 段，世界序号不变", sess("Q")["segment"] == 3 and sess("Q")["worldSeq"] == 0)
# 并发同 turnId
with cf.ThreadPoolExecutor(6) as ex: res = list(ex.map(lambda i: turn("现在执行", sid="P", tid="race1"), range(6)))
good = [o for c, o in res if c == 200 and o.get("gameCommit")]
ids = {o["gameCommit"]["actionId"] for o in good}
check("并发同 turnId：最多提交一次行动", len(ids) <= 1 and all(c in (200, 409) for c, o in res), [(c, o.get("code")) for c, o in res])
check("坏请求被拒", turn("")[0] == 400 and post("/api/adventure/turn", {"sessionId": "S"})[0] == 400)
check("不存在的会话", turn("hi", sid="nope")[0] == 404)
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
