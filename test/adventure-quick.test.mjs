import test from "node:test";import assert from "node:assert/strict";import {suggestSceneActions} from "../public/adventure-quick.mjs";
test("map and flood clues generate contextual suggestions",()=>{const a=suggestSceneActions("两张地图标的坡向相反；积水流入石板缝。");assert.deepEqual(a.map(x=>x.label),["对照地图","查看水流","判断地势"]);});
test("later dialogue updates the quick options",()=>{const a=suggestSceneActions("街道很安静。","委托书的收件时间有问题，钟楼仍未鸣响。");assert.deepEqual(a.map(x=>x.label),["检查委托书","观察钟楼"]);});
test("suggestions are editorial and do not contain execution commands",()=>{const a=suggestSceneActions("两张地图，钟楼，委托书，积水，人群");assert.equal(a.length,5);assert.ok(a.every(x=>!x.prompt.includes("现在执行")&&x.prompt.length>0));});
test("no scene information means no fabricated options",()=>assert.deepEqual(suggestSceneActions("",""),[]));

test("latest discovered evidence appears ahead of old scene cues",()=>{const a=suggestSceneActions("两张地图和积水","委托书刚刚出现");assert.equal(a[0].label,"检查委托书");});
