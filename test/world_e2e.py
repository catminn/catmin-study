import requests, json
B = "http://localhost:8800"
s = requests.Session(); s.trust_env = False
ok = True
def check(n, c, x=""):
    global ok; print(("PASS " if c else "FAIL ") + n, x if not c else ""); ok = ok and bool(c)
r = s.post(B + "/api/login", json={"password": "test-pass-123"}); s.headers["Cookie"] = r.headers["Set-Cookie"].split(";")[0]
adm = {"Cookie": s.headers["Cookie"], "X-Owner-Password": "test-pass-123"}
def put(kind, id, content):
    content = dict(content, id=id, kind=kind)
    return requests.put(B + "/api/adventure/content", json={"kind": kind, "id": id, "content": content}, headers=adm).status_code == 200
def turn(text, sid, tid):
    return s.post(B + "/api/adventure/turn", json={"sessionId": sid, "turnId": tid, "inputText": text}).json()
def outs(o): return [w["publicOutcome"] for w in o.get("worldEvents", [])]
# 没有内容包：引擎不介入
s.post(B + "/api/adventure/session", json={"sessionId": "W0", "op": "start"})
o = turn("现在执行", "W0", "w0t1"); check("没有内容包时不产生世界事件", o["gameCommit"] and outs(o) == [], o)
# 占位内容（无剧情）
put("world", "w", {"startSceneId": "s-a"})
put("scene", "s-a", {"choices": ["s-b", "s-c"]}); put("scene", "s-b", {"choices": ["s-c"]}); put("scene", "s-c", {"choices": []})
put("npc", "n1", {"initial": {"locationId": "s-a"}})
put("event", "e1", {"trigger": {"type": "action_resolved", "sceneId": "s-a"}, "effects": [{"type": "set_flag", "target": "f1", "value": True}, {"type": "advance_scene", "target": "s-b"}], "publicOutcome": "PLACEHOLDER-ONE", "repeatPolicy": "once_per_world"})
put("event", "e2", {"trigger": {"type": "scene_entered", "sceneId": "s-b"}, "effects": [{"type": "set_flag", "target": "f2", "value": True}], "publicOutcome": "PLACEHOLDER-TWO"})
put("event", "e3", {"trigger": {"type": "action_resolved", "sceneId": "s-b"}, "preconditions": [{"flag": "f2", "equals": True}], "effects": [{"type": "change_npc_relation", "target": "n1", "value": "friendly"}, {"type": "advance_scene", "target": "s-c"}], "publicOutcome": "PLACEHOLDER-THREE"})
put("event", "e4", {"trigger": {"type": "action_resolved", "sceneId": "s-c"}, "effects": [{"type": "set_flag", "target": "g", "value": True}, {"type": "advance_scene", "target": "nowhere"}], "publicOutcome": "SHOULD-NOT-APPEAR", "priority": 5})
put("event", "e5", {"trigger": {"type": "action_resolved", "sceneId": "s-c"}, "preconditions": [{"flag": "g"}], "effects": [], "publicOutcome": "LEAK-FROM-PARTIAL"})
put("event", "e6", {"trigger": {"type": "action_resolved", "sceneId": "s-c"}, "preconditions": [{"npcRelation": {"npc": "n1", "band": "friendly"}}], "effects": [], "publicOutcome": "PLACEHOLDER-SIX"})
put("event", "e7", {"trigger": {"type": "action_resolved", "sceneId": "s-a"}, "preconditions": [{"unknownLeaf": 1}], "effects": [], "publicOutcome": "UNKNOWN-COND"})
put("event", "e8", {"trigger": {"type": "action_resolved", "sceneId": "s-a"}, "effects": [{"type": "grant_item", "target": "x"}], "publicOutcome": "UNSUPPORTED-EFFECT"})
s.post(B + "/api/adventure/session", json={"sessionId": "W1", "op": "start"})
o1 = turn("现在执行", "W1", "w1t1")
check("事件链：行动 → 切场景 → scene_entered 事件，按序给出公开结果", outs(o1) == ["PLACEHOLDER-ONE", "PLACEHOLDER-TWO"], o1)
txt = json.dumps(o1, ensure_ascii=False)
check("玩家响应不泄露 id/effects/flag", all(k not in txt for k in ["e1", "f1", "s-b", "advance_scene", "set_flag", "effects"]), txt)
o2 = turn("现在执行", "W1", "w1t2"); check("前置条件满足（f2）才触发下一事件，关系变化", outs(o2) == ["PLACEHOLDER-THREE"], o2)
o3 = turn("现在执行", "W1", "w1t3")
check("非法 effect 的事件整条拒绝（无部分应用，依赖它的事件也不触发），未知条件/不支持的 effect 不触发；合法事件触发", outs(o3) == ["PLACEHOLDER-SIX"], o3)
o4 = turn("现在执行", "W1", "w1t4"); check("once_per_world 不重复", outs(o4) == [], o4)
o1b = turn("现在执行", "W1", "w1t1"); check("同 turnId 重放：同样的结果，不重复应用", outs(o1b) == outs(o1) and o1b.get("replay"), o1b)
s.post(B + "/api/adventure/session", json={"sessionId": "W2", "op": "start"})
o = turn("现在执行", "W2", "w2t1"); check("另一个会话有自己的世界状态", outs(o) == ["PLACEHOLDER-ONE", "PLACEHOLDER-TWO"], o)
print("\nALL PASS" if ok else "\nSOME FAILED"); raise SystemExit(0 if ok else 1)
