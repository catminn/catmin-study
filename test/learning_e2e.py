import requests, json
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
adm = {"Cookie": s.headers["Cookie"], "X-Owner-Password": "test-pass-123"}
def put(kind, id, content):
    content = dict(content, id=id)
    return requests.put(B + "/api/adventure/content", json={"kind": kind, "id": id, "content": content}, headers=adm).status_code
def turn(text, sid, tid): return s.post(B + "/api/adventure/turn", json={"sessionId": sid, "turnId": tid, "inputText": text}).json()
def prof(**k): return s.put(B + "/api/adventure/learning-profile", json=k)
def audit(): return requests.get(B + "/api/adventure/learning-audit", headers=adm).json()["audit"]
def start(sid): s.post(B + "/api/adventure/session", json={"sessionId": sid, "op": "start"}); s.get(B + "/api/adventure/world", params={"id": sid})

# 占位世界：l-a 有公开线索+学习机会声明；l-b 声明了机会但线索缺失；l-c 没有声明
put("world", "lw", {"startSceneId": "l-a", "public_opening": "PH-OPEN"})
AFF = {"id": "aff1", "publicCueIds": ["cue1", "cue2"], "application": "infer-slope", "eligibleConceptIds": ["math1920.gradient"], "prompt": "PH-LEARN-PROMPT"}
put("scene", "l-a", {"choices": ["l-b", "l-c"], "publicText": "PH-A", "publicCues": [{"id": "cue1", "evidence": "PH-E1"}, {"id": "cue2", "evidence": "PH-E2"}], "learningAffordances": [AFF]})
put("scene", "l-b", {"choices": ["l-a"], "publicText": "PH-B", "publicCues": [{"id": "cue1", "evidence": "PH-E1"}], "learningAffordances": [AFF]})
put("scene", "l-c", {"choices": ["l-a"], "publicText": "PH-C"})
start("L0")
o = turn("随便看看", "L0", "l0t1")
check("L1 没有课程包：完全不介入（无 learningOffer，无审计）", "learningOffer" not in o and audit() == {}, [o.get("learningOffer"), audit()])

PACK = {"version": "1", "concepts": [{"id": "math1920.gradient", "courseId": "math1920", "title": "Gradient", "prerequisites": [], "applications": ["infer-slope"]}]}
check("L2 结构非法的课程包被拒（400）", put("course", "math1920", {"version": "1", "concepts": [{"id": "BAD"}]}) == 400)
check("L3 content.id 与记录 id 不一致被拒（400）", requests.put(B + "/api/adventure/content", json={"kind": "course", "id": "math1920", "content": dict(PACK, id="other")}, headers=adm).status_code == 400)
check("L4 合法课程包可写入（版本化）", put("course", "math1920", PACK) == 200)
check("L5 未登录不能读写学习档案", requests.get(B + "/api/adventure/learning-profile").status_code in (401, 403))
check("L6 学习档案不接受客户端写 learnedConceptIds", prof(enrolledCourseIds=["math1920"], learnedConceptIds=["math1920.gradient"]).status_code == 400)

start("L1")
o = turn("随便看看", "L1", "l1t1")
check("L7 没选课：不提示（审计记录 none）", "learningOffer" not in o and audit().get("none") == 1, [o.get("learningOffer"), audit()])
check("L8 选课", prof(enrolledCourseIds=["math1920"]).status_code == 200)
o = turn("随便看看", "L1", "l1t2")
lo = o.get("learningOffer")
check("L9 选课+公开线索齐全：给出一条非强制提示，不改世界/不判定/不发奖", lo and lo["prompt"] == "PH-LEARN-PROMPT" and o["gameCommit"] is None and o["worldEvents"] == [] and o["academicEvaluation"] is None and o["learningSessionDelta"]["worldSeq"] == 0, o)
o = turn("再看看", "L1", "l1t3")
check("L10 同概念冷却：短时间内不重复提示", "learningOffer" not in o and audit().get("withheld") == 1, [o.get("learningOffer"), audit()])
o2 = turn("随便看看", "L1", "l1t2")
check("L11 同 turnId 重放返回同一提示、不重复记录", o2.get("replay") and o2.get("learningOffer") == lo and audit().get("offered") == 1, [o2, audit()])
txt = json.dumps(o, ensure_ascii=False)
check("L12 响应不含概念内部 id 之外的课程包/审计内容", "adventure_learning" not in txt and "PH-E1" not in txt)

# 线索缺失 → 不提示（作者声明了机会但线索没有全部公开）
start("L2"); s.post(B + "/api/adventure/travel", json={"sessionId": "L2", "commitId": "l2m", "target": "l-b"})
o = turn("随便看看", "L2", "l2t1")
check("L13 缺少公开线索：不提示", "learningOffer" not in o, o.get("learningOffer"))
# 玩家不想被提示学习
prof(enrolledCourseIds=["math1920"], avoidLearning=True)
start("L3"); o = turn("随便看看", "L3", "l3t1")
check("L14 玩家选择不被提示学习：不提示", "learningOffer" not in o, o.get("learningOffer"))
o = turn("把偏导这一章系统讲一下。", "L3", "l3t2")
check("L15 玩家明确要学（LEARN）时仍可给提示，不受“不想被提示”约束", "learningOffer" in o and o["intentSegments"] == ["LEARN"], o)
# 退出该课程
prof(enrolledCourseIds=["math1920"], optedOutCourseIds=["math1920"])
start("L4"); o = turn("随便看看", "L4", "l4t1")
check("L16 退出该课程：不提示", "learningOffer" not in o, o.get("learningOffer"))
# 拒绝与审计
d = s.post(B + "/api/adventure/learning-offer/decline", json={"sessionId": "L1", "conceptId": "math1920.gradient"})
check("L17 玩家拒绝提示被记录", d.status_code == 200 and audit().get("declined") == 1, audit())
check("L18 审计只有管理员能看（玩家 403）", requests.get(B + "/api/adventure/learning-audit", headers={"Cookie": s.headers["Cookie"]}).status_code == 403)
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
