# Spoiler-free integration regression for World Engine v1 compatibility patch.
# Uses only synthetic events and never loads the author's private story package.
import requests
B="http://localhost:8800"
s=requests.Session(); s.trust_env=False
assert s.post(B+"/api/login",json={"password":"test-pass-123"}).status_code==200
admin={"X-Owner-Password":"test-pass-123"}
def put(kind,id,c):
    c={"kind":kind,"id":id,**c}
    r=s.put(B+"/api/adventure/content",json={"kind":kind,"id":id,"content":c},headers=admin)
    assert r.status_code==200,(kind,r.status_code)
def choice(sid,aid,kind,target,npc=None):
    return s.post(B+"/api/adventure/world/choice",json={"sessionId":sid,"actionId":aid,"kind":kind,"choiceId":target,"npcId":npc}).json()
def outs(r):return [x["publicOutcome"] for x in r.get("worldEvents",[])]
put("world","w",{"startSceneId":"s-a"})
put("scene","s-a",{"choices":["s-b"]})
put("scene","s-b",{"choices":[]})
put("npc","n",{"initial":{"locationId":"s-b"},"dialogueCards":[{"id":"q-1"}]})
put("event","entry",{"trigger":{"type":"scene_entered","sceneId":"s-b"},"effects":[{"type":"set_flag","target":"ready","value":True}],"publicOutcome":"ENTRY"})
put("event","flag",{"trigger":{"type":"world_flag_changed","flagKey":"ready"},"effects":[],"revealsFacts":["fact-1"],"publicOutcome":"FLAG"})
put("event","fact",{"trigger":{"type":"fact_discovered","factId":"fact-1"},"effects":[],"publicOutcome":"FACT"})
put("event","dialogue",{"trigger":{"type":"dialogue_choice_committed","npcId":"n","choiceId":"q-1"},"effects":[],"publicOutcome":"DIALOGUE"})
sid="V1CHOICE"
assert s.post(B+"/api/adventure/session",json={"sessionId":sid,"op":"start"}).status_code==200
bad=choice(sid,"a-bad","scene","not-in-menu")
assert bad.get("ok") is False,bad
first=choice(sid,"a1","scene","s-b")
assert first.get("ok") is True,first
assert outs(first)==["ENTRY","FLAG","FACT"],first
again=choice(sid,"a1","scene","s-b")
assert again.get("replay") and sorted(outs(again))==sorted(outs(first)),again
dialogue=choice(sid,"a2","dialogue","q-1","n")
assert outs(dialogue)==["DIALOGUE"],dialogue
wrong=choice(sid,"a3","dialogue","not-a-choice","n")
assert wrong.get("ok") is False,wrong
print("WORLD CHOICE COMPAT PASS")
