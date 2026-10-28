import test from "node:test";
import assert from "node:assert/strict";
import { sceneRequest, narrationViolatesSceneContract } from "../src/scene-intent.ts";
const moves=[{sceneId:"s-b",label:"地点1"},{sceneId:"s-c",label:"钟楼街口"}];
test("observation is read-only exploration",()=>{
  for(const text of ["看看四周","观察周围","环顾一下四周","查看环境"])
    assert.equal(sceneRequest(text,moves).observation,true,text);
});
test("clear travel maps to current legal destination",()=>{
  assert.equal(sceneRequest("前往地点1",moves).moveTo,"s-b");
  assert.equal(sceneRequest("去钟楼街口",moves).moveTo,"s-c");
  assert.equal(sceneRequest("走到未知之地",moves).moveTo,null);
});
test("model refuses grounded observation should be rejected",()=>{
  assert.equal(narrationViolatesSceneContract("这一回合没有提交具体世界行动，所以不能描写四周。"),true);
  assert.equal(narrationViolatesSceneContract("我还不能描述周围，你需要把数学方法发给我"),true);
  assert.equal(narrationViolatesSceneContract("钟楼没有响，街上空无一人。"),false);
});
