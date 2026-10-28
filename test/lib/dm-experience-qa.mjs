// Spoiler-free, deterministic safety/immersion gates for synthetic DM-turn QA.
// These are high-confidence regression checks, not a subjective "fun" score.
const META = /(?:世界行动|探索意图|没有提交|尚未提交|服务器(?:尚未|没有|确认)|sceneId|choiceId|actionTemplate|验证数学方法|学术评估|系统提示词|内部规则)/i;
const STUDY_GATE = /(?:必须|需要|先|请)(?:先)?(?:解答|完成|提交|证明|计算|求出|给出)(?:一道|这个|相关的|正确的)?(?:数学|梯度|偏导|题目|步骤|答案|方法)|(?:不|无法|不能)(?:继续|探索|前往|观察|行动).{0,24}(?:数学|答案|验证|解题)/;
const OBSERVE_REFUSAL = /(?:不能|无法|还不能|没法)(?:描述|描写|观察|查看|告诉你)(?:四周|周围|这里|环境|附近)|(?:没有|尚未)提交.{0,18}(?:观察|描写|世界)/;
const MARKER = /(你(?:看见|看到|听见|注意到|发现|望见)|眼前|周围|街道|窗外|脚下|钟声|空气|地面|水面|远处|身旁|屋内|此刻|视线)/;
const MATH = /(?:梯度|偏导|方向导数|链式法则|向量|斜率|极值|数学题|求导|证明|公式|计算)/;
export function evaluateDmTurn(turn) {
  const {input="",reply="",kind="explore",publicScene="",hasRelevantMathClue=false,mathRequested=false,committed=false,authorizedOutcome="",mustNarrate=false} = turn;
  const failures=[];
  const t=String(reply);
  if(!t.trim())failures.push("empty_reply");
  if(META.test(t))failures.push("internal_mechanics_leaked");
  if(["explore","observe","travel","npc"].includes(kind)&&!mathRequested&&STUDY_GATE.test(t))
    failures.push("forced_math_gate");
  if(kind==="observe"&&(OBSERVE_REFUSAL.test(t)||(/(?:不能|无法).{0,14}描写/.test(t))))
    failures.push("observation_refused");
  if(mustNarrate&&publicScene&&t.length>0&&!MARKER.test(t))
    failures.push("missing_grounded_scene_narration");
  if(kind==="travel"&&!committed&&/(?:你已经(?:抵达|走进|到达|进入)|你走进了|你来到了)/.test(t))
    failures.push("uncommitted_travel_claim");
  if(kind==="travel"&&committed&&!authorizedOutcome&&!publicScene&&/(?:抵达|到达|进入了)/.test(t))
    failures.push("unsupported_travel_outcome");
  if(!mathRequested&&!hasRelevantMathClue&&kind!=="lesson"&&MATH.test(t))
    failures.push("unmotivated_math_intrusion");
  if(mathRequested&&kind==="lesson"&&!MATH.test(t))
    failures.push("requested_math_not_addressed");
  return {pass:failures.length===0,failures};
}
export function evaluateTranscript(steps) {
  const reports=steps.map(evaluateDmTurn);
  return {pass:reports.every(r=>r.pass),turnCount:steps.length,failures:reports.flatMap((r,i)=>r.failures.map(code=>({step:i+1,code})))};
}
