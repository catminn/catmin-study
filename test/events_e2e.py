import requests, concurrent.futures as cf
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(name, cond, extra=""):
    global ok
    print(("PASS " if cond else "FAIL ") + name, extra if not cond else "")
    ok = ok and bool(cond)

check("未登录不能提交事件", s.post(B + "/api/events", json={}).status_code == 401)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]

def ev(i, **kw):
    e = dict(id=i, type="knowledge_attempt", topicId="math1920.gradient", at=1793150000000, correctness="correct", reasoning="valid",
             assistance="none", verification="confirmed", context="adventure", transfer=False)
    e.update(kw); return e
def post(path, body):
    r = s.post(B + path, json=body); return r.status_code, r.json()

c, o = post("/api/events", ev("e1"))
check("新事件写入", c == 200 and o["inserted"] is True, o)
c, o = post("/api/events", ev("e1"))
check("同 id 同内容 → 幂等，不重复", c == 200 and o["inserted"] is False, o)
c, o = post("/api/events", {"event": ev("e1")})
check("支持 {event:…} 包装", c == 200 and o["inserted"] is False, o)
c, o = post("/api/events", ev("e1", correctness="incorrect"))
check("同 id 不同内容 → 409", c == 409 and o["code"] == "id_conflict", o)
check("键顺序不同仍视为同一内容", post("/api/events", dict(reversed(list(ev("e1").items()))))[1].get("inserted") is False)
for bad, why in [(ev("x", type="nope"), "type"), (ev("x", at=-1), "at"), (ev("x", transfer="yes"), "transfer"),
                 (ev(""), "id"), (ev("x", context="dream"), "context"), (dict(ev("x"), secret="隐藏设定"), "多余字段")]:
    c, o = post("/api/events", bad); check("拒绝非法事件：" + why, c == 400 and o["code"] == "bad_request", o)

# 奖励
c, o = post("/api/rewards", dict(rewardId="r1", sourceEventId="e1", points=5, at=1793150000001))
check("已确认来源可以发奖励", c == 200 and o["inserted"] and o["balance"] == {"points": 5, "rewards": 1}, o)
c, o = post("/api/rewards", dict(rewardId="r1", sourceEventId="e1", points=5, at=1793150000001))
check("重复提交不重复发", c == 200 and o["inserted"] is False and o["balance"]["points"] == 5, o)
c, o = post("/api/rewards", dict(rewardId="r2", sourceEventId="e1", points=5, at=1793150000002))
check("同一来源换 rewardId 也不能再发", c == 409 and o["code"] == "reward_conflict", o)
c, o = post("/api/rewards", dict(rewardId="r1", sourceEventId="e1", points=9, at=1793150000001))
check("同 rewardId 不同点数 → 409", c == 409, o)
post("/api/events", ev("e2", verification="pending"))
c, o = post("/api/rewards", dict(rewardId="r3", sourceEventId="e2", points=5, at=1))
check("待验证来源不能发奖励", c == 422 and o["code"] == "source_not_confirmed", o)
post("/api/events", ev("e3", verification="rejected"))
check("被驳回来源不能发奖励", post("/api/rewards", dict(rewardId="r4", sourceEventId="e3", points=5, at=1))[0] == 422)
check("来源不存在不能发奖励", post("/api/rewards", dict(rewardId="r5", sourceEventId="ghost", points=5, at=1))[0] == 422)
check("points 超范围被拒", post("/api/rewards", dict(rewardId="r6", sourceEventId="e1", points=10001, at=1))[0] == 400)
check("points 负数被拒", post("/api/rewards", dict(rewardId="r6", sourceEventId="e1", points=-1, at=1))[0] == 400)

# 并发：同一个来源同时发 20 次，只能成功一次
post("/api/events", ev("e4"))
def go(i):
    return post("/api/rewards", dict(rewardId="race-%d" % i, sourceEventId="e4", points=7, at=1))
with cf.ThreadPoolExecutor(20) as ex: res = list(ex.map(go, range(20)))
ins = sum(1 for c, o in res if c == 200 and o.get("inserted"))
check("并发 20 次只发一次奖励", ins == 1, [(c, o.get("code")) for c, o in res][:5])
b = s.get(B + "/api/rewards/balance").json()
check("余额 = 5 + 7", b == {"points": 12, "rewards": 2}, b)
check("读取事件", len(s.get(B + "/api/events", params={"topic": "math1920.gradient"}).json()["events"]) == 4)
check("导出接口不受影响", s.get(B + "/api/export").status_code == 200)
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
