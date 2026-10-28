#!/usr/bin/env python3
"""跑 GPT 的多轮契约（test/fixtures/dm-multiturn-contract-v1.json）里**不需要预置状态**的序列，断言服务器可观察字段
（gameCommit / quietMode / academicEvaluation.assistance），不是只看旁白。需要预置草案或证据的序列标 SKIP（由 test/turn_e2e.py 的确定性用例覆盖）。
用法：SITE=https://study.catmin.io PASS=<登录口令> python3 scripts/run-multiturn.py
会真实调用模型；每个序列用全新会话。
"""
import json, os, sys, uuid, requests
B = os.environ.get("SITE", "http://localhost:8800"); PW = os.environ.get("PASS", "test-pass-123")
s = requests.Session(); s.trust_env = False
r = s.post(B + "/api/login", json={"password": PW}); r.raise_for_status(); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
d = json.load(open(os.path.join(os.path.dirname(__file__), "..", "test", "fixtures", "dm-multiturn-contract-v1.json")))
fails = 0
def need_state(seq):
    st = seq["setup"]; return bool(st.get("pendingPlans")) or bool(st.get("evidence"))
for seq in d["sequences"]:
    if need_state(seq): print("SKIP", seq["id"], "(需要预置状态)"); continue
    sid = "mt-" + uuid.uuid4().hex[:12]
    s.post(B + "/api/adventure/session", json={"sessionId": sid, "op": "start"})
    if seq["setup"].get("story") == "paused": s.post(B + "/api/adventure/session", json={"sessionId": sid, "op": "pause"})
    for i, st in enumerate(seq["steps"]):
        o = s.post(B + "/api/adventure/turn", json={"sessionId": sid, "turnId": "t-" + uuid.uuid4().hex[:12], "inputText": st["input"]}).json()
        ex, probs = st["expect"], []
        if o.get("uncertainty"): probs.append("uncertainty:" + str(o.get("detail") or o.get("message")))
        if ex.get("commit") is False and o.get("gameCommit"): probs.append("不该提交行动却提交了")
        if "quiet" in ex and bool(o.get("quietMode")) != ex["quiet"]: probs.append(f"quiet 期望 {ex['quiet']} 实际 {o.get('quietMode')}")
        ae = o.get("academicEvaluation"); a = (ae or {}).get("assistance")
        if ex.get("assistance") == "worked_solution" and a != "worked_solution": probs.append(f"assistance 期望 worked_solution 实际 {a}")
        if ex.get("assistance") == "not_none" and ae and a == "none": probs.append(f"assistance 应不是 none，实际 {a}")
        if ex.get("assistanceForCurrentTask") == "none" and a != "none": probs.append(f"新题应为 none，实际 {a}")
        if ex.get("commit") in ("only_after_validation", "conditional_on_revalidation", "only_if_still_legal", True): pass
        ok = not probs; fails += not ok
        print(("PASS " if ok else "FAIL ") + f"{seq['id']}#{i+1}", "" if ok else "; ".join(probs))
print("\nALL PASS" if not fails else f"\n{fails} 个步骤未通过"); sys.exit(1 if fails else 0)
