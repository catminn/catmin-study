#!/usr/bin/env python3
"""用 GPT 的行为用例（test/fixtures/dm-intent-cases.json）跑真实模型，查看意图识别与“不提交行动”的约束。
用法：SITE=https://study.catmin.io PASS=<登录口令> python3 scripts/run-fixtures.py
会真实调用模型（每个用例约 2 次廉价调用，总共几美分以内），不碰线上存档以外的东西；每个用例用独立的新会话。
"""
import json, os, sys, uuid, requests
B = os.environ.get("SITE", "http://localhost:8800"); PW = os.environ.get("PASS", "test-pass-123")
s = requests.Session(); s.trust_env = False
r = s.post(B + "/api/login", json={"password": PW}); r.raise_for_status()
c = r.headers["Set-Cookie"].split(";")[0]; s.headers["Cookie"] = c
FIX = os.environ.get("FIXTURE", "dm-intent-cases.json")  # 例：FIXTURE=claude-edge-cases.json
cases = json.load(open(os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", FIX)))["cases"]
bad = 0
for c in cases:
    sid = "fx-" + uuid.uuid4().hex[:12]
    s.post(B + "/api/adventure/session", json={"sessionId": sid, "op": "start"})
    o = s.post(B + "/api/adventure/turn", json={"sessionId": sid, "turnId": "t-" + uuid.uuid4().hex[:12], "inputText": c["input"]}).json()
    got = o.get("intentSegments") or []
    want = [i for i in c["intent"] if i != "MIXED"]
    intent_ok = (len(got) >= 2) if c["intent"] == ["MIXED"] else set(want) <= set(got)
    commit = o.get("gameCommit")
    commit_ok = (commit is None) if c.get("worldCommit") is False else True
    ok = intent_ok and commit_ok and not o.get("uncertainty")
    bad += not ok
    print(("PASS " if ok else "FAIL ") + c["id"], "" if ok else f"got={got} want={c['intent']} commit={'yes' if commit else 'no'} msg={o.get('message') or o.get('visibleFeedback')}")
print(f"\n{len(cases)-bad}/{len(cases)} 通过"); sys.exit(1 if bad else 0)
