// 冒险回合：意图识别 → 学术评估记录 → （仅 ACT）行动提交 → 回复。
// 服务器规则优先于模型输出：模型不能自己提交行动、不能指定依据事件、不能把待验证说成已确认。
//   POST /api/adventure/turn {sessionId, turnId, inputText}   同 turnId 重试返回原回复，不重复调用模型/不重复提交
import type { SiteEnv } from "./site";
import { applyTrigger, availableChoices, availableMoves, commitChoice, commitTravel, publicSceneInfo, replayPublicOutcomes, type PublicEvent } from "./world";
import { ACTIONS, CONCEPTS, CONFIG, postAction } from "./adventure";
import { postEvent } from "./events";

export const ROUTING = {
  version: "routing-1.0.0",
  classify: { tier: "quick", provider: "anthropic" },
  verify: { tier: "quick", provider: "openai" }, // 与判题不同的厂商，降低同源误判
  reply: { LEARN: { tier: "default", provider: "anthropic" }, ASK: { tier: "quick", provider: "anthropic" }, PRACTICE: { tier: "quick", provider: "anthropic" }, EXPLORE: { tier: "quick", provider: "anthropic" }, ACT: { tier: "quick", provider: "anthropic" } } as Record<string, { tier: string; provider: string }>,
  crossCheckCorrect: true, // 模型认为“正确且推理有效”时，必须由第二个模型独立确认才算 confirmed
  topicId: "math1920.sandbox",
  maxInput: 4000,
  planSoftTtlMs: 30 * 60 * 1000, // 超过这个时间的方案不会被删除，只是执行前要重新确认
};

export interface Deps {
  budgetOk(): Promise<{ ok: true } | { ok: false; reason: string }>;
  complete(tier: string, provider: string, text: string, maxTok: number): Promise<string>;
}
type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, code: string, message: string): Result => ({ status, body: { code, message } });
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const idOk = (x: unknown): x is string => typeof x === "string" && /^[\w.:-]{1,100}$/.test(x);
const INTENTS = new Set(["ASK", "LEARN", "PRACTICE", "EXPLORE", "ACT"]);
const CORRECT = new Set(["correct", "incorrect", "partial", "unknown"]);
const REASON = new Set(["valid", "partial", "invalid", "not_assessed"]);
const ASSIST = new Set(["none", "minor_hint", "major_hint", "worked_solution", "unknown"]);

let ready: Promise<unknown> | null = null;
function ensureSchema(env: SiteEnv) {
  ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_turns (turn_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, response TEXT, created_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_plans (plan_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, text TEXT NOT NULL, created_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_plan_reconfirm (plan_id TEXT PRIMARY KEY, world_seq INTEGER NOT NULL, at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_plan_meta (plan_id TEXT PRIMARY KEY, world_seq INTEGER NOT NULL, reconfirm INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_help (session_id TEXT PRIMARY KEY, worked INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_evidence_concept (event_id TEXT PRIMARY KEY, concept_id TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_action_meta (action_id TEXT PRIMARY KEY, template TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_insight_use (event_id TEXT PRIMARY KEY, insight_key TEXT NOT NULL, is_first INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_flags (session_id TEXT PRIMARY KEY, quiet INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_cursor (session_id TEXT PRIMARY KEY, lesson_open INTEGER NOT NULL, lesson_segment INTEGER NOT NULL, nested_depth INTEGER NOT NULL DEFAULT 0, resume_asked INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_insight_first ON adventure_insight_use(insight_key) WHERE is_first=1`),
  ])
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

export function parseJson(text: string): unknown {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (m ? m[1] : text).trim();
  const a = s.indexOf("{");
  if (a < 0) return null;
  // 取第一个括号配平的对象（模型有时在 JSON 后面附带解释，里面可能还有花括号）
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(s.slice(a, i + 1)); } catch { return null; }
    }
  }
  return null;
}

export interface Classification {
  intents: string[];
  explicitCommit: boolean;
  storyResume: boolean;
  resumeTarget: "lesson" | "story" | "unspecified";
  pauseStory: boolean;
  insightKey: string | null;
  planRef: "none" | "previous" | "inline";
  planIndex: number | null;
  tutorSolution: boolean;
  newTask: boolean;
  choiceId: string | null;
  moveTo: string | null;
  conceptId: string | null;
  actionTemplate: string;
  quiet: "on" | "off" | "none";
  evaluation: null | { correctness: string; reasoning: string; assistance: string };
}
export function validateClassification(x: unknown): { ok: true; value: Classification } | { ok: false; why: string } {
  if (!isObj(x)) return { ok: false, why: "不是对象" };
  // 对模型的小偏差宽容：未知意图丢掉（如 MIXED），拿不到任何有效意图时按 EXPLORE 处理；缺少 explicitCommit 当作 false（更安全）
  const rawIt = Array.isArray(x.intents) ? x.intents : typeof x.intents === "string" ? [x.intents] : null;
  if (!rawIt) return { ok: false, why: "intents 缺失" };
  const it = rawIt.filter((v) => typeof v === "string" && INTENTS.has(v)).slice(0, 5);
  if (!it.length) it.push("EXPLORE");
  if (x.explicitCommit !== undefined && typeof x.explicitCommit !== "boolean") return { ok: false, why: "explicitCommit 必须是布尔" };
  x.explicitCommit = x.explicitCommit === true;
  const resume = x.storyResume === undefined ? false : x.storyResume;
  if (typeof resume !== "boolean") return { ok: false, why: "storyResume 不合法" };
  const rt = x.resumeTarget === undefined || x.resumeTarget === null ? "unspecified" : x.resumeTarget;
  if (rt !== "lesson" && rt !== "story" && rt !== "unspecified") return { ok: false, why: "resumeTarget 不合法" };
  const pause = x.pauseStory === undefined ? false : x.pauseStory;
  if (typeof pause !== "boolean") return { ok: false, why: "pauseStory 不合法" };
  const ik = x.insightKey === undefined || x.insightKey === null ? null : x.insightKey;
  if (ik !== null && (typeof ik !== "string" || !/^[a-z0-9][a-z0-9_.-]{0,59}$/.test(ik))) return { ok: false, why: "insightKey 不合法" };
  const pr = x.planRef === undefined ? "none" : x.planRef;
  if (pr !== "none" && pr !== "previous" && pr !== "inline") return { ok: false, why: "planRef 不合法" };
  const q = x.quiet === undefined ? "none" : x.quiet;
  if (q !== "on" && q !== "off" && q !== "none") return { ok: false, why: "quiet 不合法" };
  const pi = x.planIndex === undefined || x.planIndex === null ? null : x.planIndex;
  if (pi !== null && !(Number.isInteger(pi) && (pi as number) >= 1 && (pi as number) <= 9)) return { ok: false, why: "planIndex 不合法" };
  const cid = x.conceptId === undefined || x.conceptId === null || !CONCEPTS.includes(x.conceptId as string) ? null : (x.conceptId as string);
  const at = typeof x.actionId === "string" && ACTIONS[x.actionId] ? x.actionId : "plain-action";
  let ev: Classification["evaluation"] = null;
  if (x.evaluation !== null && x.evaluation !== undefined) {
    const e = x.evaluation;
    if (!isObj(e) || !CORRECT.has(e.correctness as string) || !REASON.has(e.reasoning as string) || !ASSIST.has(e.assistance as string)) return { ok: false, why: "evaluation 不合法" };
    ev = { correctness: e.correctness as string, reasoning: e.reasoning as string, assistance: e.assistance as string };
  }
  return { ok: true, value: { intents: [...new Set(it as string[])], explicitCommit: x.explicitCommit === true, storyResume: resume, resumeTarget: rt as Classification["resumeTarget"], pauseStory: pause, insightKey: ik as string | null, planRef: pr, planIndex: pi as number | null, tutorSolution: x.tutorSolution === true, newTask: x.newTask === true, moveTo: typeof x.moveTo === "string" && /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(x.moveTo) ? x.moveTo : null, choiceId: typeof x.choiceId === "string" && /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(x.choiceId) ? x.choiceId : null, conceptId: cid, actionTemplate: at, quiet: q as Classification["quiet"], evaluation: ev } };
}

const CLASSIFY_PROMPT = (input: string, paused: boolean, ctx: string, choices: string[] = [], moves: string[] = []) => `[[CLASSIFY]] 你是学习型冒险游戏的意图识别器。只输出一个 JSON，不要解释。
玩家输入：${input}
当前故事${paused ? "已暂停（玩家在刷题）" : "进行中"}。
${ctx}
（面向玩家绝不使用内部措辞，如“探索意图”“具体世界行动”“没有提交”“验证数学方法”“服务器”“场景ID”；玩家想去某处却没成功时，用世界里的阻碍说一句（如“那条路现在走不通”）并提示他还能做什么。玩家说“继续/继续刚才的”且没有待验证的数学内容时，接着当前场景往下描写，不要要求他交数学方法。玩家说“刚才的方法/那个/上一个”时，指上面最近对话里的内容，请据此判断，不要因为指代而判成不确定。）
字段：
- intents：从 ASK(提问) LEARN(要求系统讲解) PRACTICE(刷题/作答) EXPLORE(探索) ACT(要求真实执行行动) 中选 1–5 个；
- 注意：玩家只说“先让我自己想想”这类，intents 用 ["ASK"] 并且 quiet="on"，不要判成 PRACTICE；
- explicitCommit：玩家是否明确要求“现在就执行”。只是计划、设想、“先不要执行”都必须是 false；
- storyResume：玩家是否要求回到刚才的故事/继续；
- resumeTarget：storyResume 为 true 时，玩家说的“继续”指什么："lesson"=继续刚才的课/题，"story"=回到故事，"unspecified"=只说“继续”看不出来；
- pauseStory：玩家是否明确要求离开故事去纯刷题（如“不要剧情”“先刷题”）；故事里顺便作答不算；
- insightKey：这次解答用到的核心思路的稳定短标识（小写英文数字和连字符，如 expand-then-differentiate）；同一个思路换说法重复出现必须用同一个标识，没有评估时为 null；
- planRef：玩家要执行行动时，指令本身是否把行动说清楚了。"inline"=指令自己说明了要做什么；"previous"=指代之前商量/草拟过的方案（如“刚才那个”）；"none"=不涉及执行。指代不清也写 "previous"；
- planIndex：玩家点名方案序号时（“方案 A/第二个/B”分别对应 1/2…），填整数 1–9；否则 null；
- conceptId：这次数学解答主要用到的知识点，只能是 math1920.derivative-basics（一元求导）、math1920.partial-derivative（偏导数）、math1920.gradient（梯度）、math1920.directional-derivative（方向导数）、math1920.chain-rule-multivariable（多元链式法则）之一，不确定或没有解答时 null；
- actionId：玩家要执行的行动属于哪种：apply-derivative-method（用求导方法）、determine-local-steepest-ascent（用梯度找局部最陡上升方向，也包括“应用梯度方法”）、estimate-change-in-one-variable（估计单变量变化，偏导）、predict-change-along-chosen-direction（预测沿选定方向的变化，方向导数）、derive-rate-along-parametric-path（沿参数路径求变化率，多元链式法则）、propose-safety-plan（提出安全方案/计划并要求执行，与数学无关）、plain-action（与数学无关的普通行动或说不清）；
- choiceId：${choices.length ? "玩家明确要做下面某个对话选择时填它的 id，否则 null。可选：" + choices.join("、") : "没有可选的对话选择，一律 null"}；
- moveTo：${moves.length ? "玩家说“前往/去/走向”某处（可用标签文字、或“地点N/第N个”指代）时填它的 id，否则 null。可选（id=玩家看到的标签）：" + moves.join("、") : "没有可前往的地点，一律 null"}；
- tutorSolution：玩家要求导师完整演示/给出带步骤的完整解答（本回合你会给出完整解法）→ true；
- newTask：玩家这次提交的解答针对的是与之前不同的新题 → true；
- quiet：玩家说“让我自己想想/别提示”→"on"；玩家主动求提示、要答案、说“我算出来了/我做完了/我有答案了”（哪怕还没给出答案）、或明确说可以提示了→"off"；否则 "none"；
- evaluation：玩家给出了数学解答时填 {correctness, reasoning, assistance}，否则 null。correctness∈correct/incorrect/partial/unknown；reasoning∈valid/partial/invalid/not_assessed（答案对但理由不成立要写 invalid；独立正确的非标准方法写 valid）；assistance∈none/minor_hint/major_hint/worked_solution/unknown（玩家在得到提示后作答要如实标注）。
格式：{"intents":[...],"explicitCommit":false,"storyResume":false,"resumeTarget":"unspecified","pauseStory":false,"insightKey":null,"planRef":"none","planIndex":null,"choiceId":null,"moveTo":null,"tutorSolution":false,"newTask":false,"conceptId":null,"actionId":"plain-action","quiet":"none","evaluation":null}`;

const VERIFY_PROMPT = (input: string) => `[[VERIFY]] 先不要看玩家的结论，自己独立把题目解出来，再核对玩家的解答：结论是否正确，且推理是否确实成立（不是碰巧对，也不是照抄了提示）。只输出 JSON：{"ownAnswer":"你自己解出的最终结果","agree":true|false}。
玩家输入：${input}`;

export async function handleTurn(env: SiteEnv, body: unknown, deps: Deps): Promise<Result> {
  if (!isObj(body) || !idOk(body.sessionId) || !idOk(body.turnId)) return fail(400, "bad_request", "sessionId / turnId 不合法");
  const input = body.inputText;
  if (typeof input !== "string" || !input.trim() || input.length > ROUTING.maxInput) return fail(400, "bad_request", "inputText 不合法");
  await ensureSchema(env);
  const sessionId = body.sessionId, turnId = body.turnId;

  const prev = await env.DB.prepare("SELECT response FROM adventure_turns WHERE turn_id=?").bind(turnId).first<{ response: string | null }>();
  if (prev) {
    if (prev.response) {
      const stored = JSON.parse(prev.response);
      // 回复模型当时失败：同一个 turnId 重试只补叙述，不重掷骰、不重复提交（#19 P1-3）
      if (stored._retry && !stored.narration) {
        try {
          const n = await deps.complete(stored._retry.tier, stored._retry.provider, stored._retry.prompt, stored._retry.maxTok);
          if (n && n.trim()) {
            stored.narration = n;
            if (stored.visibleFeedback === "回复模型暂时不可用，但记录和进度都已保存。") stored.visibleFeedback = "";
            delete stored._retry;
            await env.DB.prepare("UPDATE adventure_turns SET response=? WHERE turn_id=?").bind(JSON.stringify(stored), turnId).run();
          }
        } catch { /* 仍然失败，保持原样，下次再试 */ }
      }
      const { _retry, ...pub } = stored;
      return { status: 200, body: { ...pub, replay: true } };
    }
    return fail(409, "turn_in_progress", "这一回合正在处理，请稍后重试");
  }
  const sess = await env.DB.prepare("SELECT status, segment, world_seq FROM adventure_sessions WHERE id=?").bind(sessionId).first<any>();
  if (!sess) return fail(404, "not_found", "会话不存在");
  const bud = await deps.budgetOk();
  if (!bud.ok) return { status: 429, body: { code: "budget_exceeded", message: bud.reason, uncertainty: true, gameCommit: null } };

  // 占位：同一个 turnId 只有一个请求能继续（并发/重试安全）
  const claim = await env.DB.prepare("INSERT OR IGNORE INTO adventure_turns (turn_id,session_id,response,created_at) VALUES (?,?,NULL,?)").bind(turnId, sessionId, Date.now() / 1000).run();
  if (claim.meta.changes !== 1) return fail(409, "turn_in_progress", "这一回合正在处理，请稍后重试");
  try {
    const chosen = body.basisEventId === undefined || body.basisEventId === null ? null : body.basisEventId;
    if (chosen !== null && !idOk(chosen)) return fail(400, "bad_request", "basisEventId 不合法");
    const res = await runTurn(env, deps, sessionId, turnId, input, sess, chosen as string | null);
    if (res.status === 200) {
      await env.DB.prepare("UPDATE adventure_turns SET response=? WHERE turn_id=?").bind(JSON.stringify(res.body), turnId).run();
      const { _retry, ...pub } = res.body as Record<string, unknown>;
      return { status: 200, body: pub };
    }
    else await env.DB.prepare("DELETE FROM adventure_turns WHERE turn_id=? AND response IS NULL").bind(turnId).run();
    return res;
  } catch (e) {
    await env.DB.prepare("DELETE FROM adventure_turns WHERE turn_id=? AND response IS NULL").bind(turnId).run().catch(() => {});
    throw e;
  }
}

export type Cursor = { open: boolean; segment: number; nested: number; asked: boolean };
export async function getCursor(env: SiteEnv, sid: string): Promise<Cursor> {
  await ensureSchema(env);
  const r = await env.DB.prepare("SELECT lesson_open, lesson_segment, nested_depth, resume_asked FROM adventure_cursor WHERE session_id=?").bind(sid).first<any>();
  return r ? { open: !!r.lesson_open, segment: r.lesson_segment, nested: r.nested_depth, asked: !!r.resume_asked } : { open: false, segment: 0, nested: 0, asked: false };
}
export async function putCursor(env: SiteEnv, sid: string, c: Cursor) {
  await env.DB.prepare("INSERT INTO adventure_cursor (session_id,lesson_open,lesson_segment,nested_depth,resume_asked,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET lesson_open=excluded.lesson_open, lesson_segment=MAX(adventure_cursor.lesson_segment, excluded.lesson_segment), nested_depth=excluded.nested_depth, resume_asked=excluded.resume_asked, updated_at=excluded.updated_at").bind(sid, c.open ? 1 : 0, c.segment, c.nested, c.asked ? 1 : 0, Date.now() / 1000).run();
}

// 行动的知识依据：默认取本会话里最近一条可用证据；玩家也可以指定一条。服务器检查归属、已确认、答对且推理有效、没被用过、不是重复思路。
async function pickBasis(env: SiteEnv, sessionId: string, chosen: string | null, template: string): Promise<{ ok: true; id: string | null } | { ok: false; message: string }> {
  const need = (ACTIONS[template] ?? ACTIONS["plain-action"]).requiredConcepts.map((c) => c.conceptId);
  if (!need.length) {
    if (chosen) return { ok: false, message: "这个行动不需要也不吃知识加成，所以不能指定依据。没有执行，方案还在。" };
    return { ok: true, id: null };
  }
  const base = `SELECT e.id FROM learning_events e JOIN adventure_turns tt ON e.id = 'turn:' || tt.turn_id || ':eval'
    JOIN adventure_evidence_concept ec ON ec.event_id=e.id AND ec.concept_id IN (${need.map(() => "?").join(",")})
    LEFT JOIN adventure_actions a ON a.basis_event_id=e.id LEFT JOIN adventure_insight_use i ON i.event_id=e.id
    WHERE tt.session_id=? AND (i.event_id IS NULL OR i.is_first=1) AND e.topic_id=? AND e.verification='confirmed' AND e.assistance != 'worked_solution' AND e.correctness='correct' AND e.reasoning='valid' AND a.action_id IS NULL`;
  if (chosen) {
    const ok = await env.DB.prepare(base + " AND e.id=?").bind(...need, sessionId, ROUTING.topicId, chosen).first<{ id: string }>();
    if (!ok) return { ok: false, message: "你指定的依据现在不能用：它可能不是这个会话里已确认的正确推理，已经被用过，或只是重复的思路。没有执行，方案还在。" };
    return { ok: true, id: ok.id };
  }
  const r = await env.DB.prepare(base + " ORDER BY e.at DESC LIMIT 1").bind(...need, sessionId, ROUTING.topicId).first<{ id: string }>();
  return { ok: true, id: r?.id ?? null };
}

// 最近几回合的摘要，让“刚才的方法”“那个方案”这类指代能被理解。只含玩家输入、已确认的评估和 DM 回复的前半段。
async function recentContext(env: SiteEnv, sessionId: string): Promise<string> {
  const rows = (await env.DB.prepare("SELECT response FROM adventure_turns WHERE session_id=? AND response IS NOT NULL ORDER BY created_at DESC LIMIT 6").bind(sessionId).all<{ response: string }>()).results.reverse();
  const lines: string[] = [];
  for (const r of rows) {
    let b: any;
    try { b = JSON.parse(r.response); } catch { continue; }
    if (!b.playerInput) continue;
    let l = "玩家：" + String(b.playerInput).slice(0, 200);
    const a = b.academicEvaluation;
    if (a) l += `［记录：${a.correctness}/${a.reasoning}/${a.verification}${a.insightKey ? "，思路 " + a.insightKey : ""}］`;
    if (b.gameCommit) l += "［已执行一次行动］";
    if (b.narration) l += "\nDM：" + String(b.narration).slice(0, 160).replace(/\n+/g, " ");
    lines.push(l);
  }
  return lines.length ? "最近的对话（旧→新）：\n" + lines.join("\n") : "（这是这个会话的第一句话）";
}

async function runTurn(env: SiteEnv, deps: Deps, sessionId: string, turnId: string, input: string, sess: any, chosen: string | null = null): Promise<Result> {
  const uncertain = (code: string, message: string): Result => ({ status: 200, body: { ok: true, uncertainty: true, code, message, intentSegments: [], academicEvaluation: null, gameCommit: null, narration: "", visibleFeedback: message } });
  // 1. 意图识别
  const ctx = await recentContext(env, sessionId);
  const choiceList = await availableChoices(env, sessionId).catch(() => []);
  const moveList = await availableMoves(env, sessionId).catch(() => []);
  let cls: Classification | null = null;
  let why = "";
  let raw = "";
  try {
    for (let attempt = 0; attempt < 3 && !cls; attempt++) {
      raw = await deps.complete(ROUTING.classify.tier, ROUTING.classify.provider, CLASSIFY_PROMPT(input, sess.status === "paused", ctx, choiceList.map((c) => c.choiceId), moveList.map((m, i) => m.sceneId + "=" + m.label + "（第" + (i + 1) + "个）")), [1500, 3000, 3000][attempt]);
      const v = validateClassification(parseJson(raw));
      if (v.ok) cls = v.value;
      else why = v.why;
    }
  } catch {
    return uncertain("model_unavailable", "模型暂时不可用，没有提交任何行动，进度已保留。");
  }
  if (!cls) {
    const r = uncertain("classification_failed", "这句话我没能可靠地理解，没有提交任何行动。请换个说法再试一次。");
    r.body.detail = why + " | len=" + raw.length + " | " + raw.slice(0, 500) + (raw.length > 500 ? " …… " + raw.slice(-250) : "");
    return r;
  }
  const intents = cls.intents;

  // 2. 学术评估记录（独立于骰子；待验证的不发奖励、不给加成）
  // 导师给过完整解答后，同一题上的“自己算”不是独立证据（#18/多轮契约）：服务器强制标注 worked_solution；换新题才恢复独立，并算迁移证据。
  const hrow = await env.DB.prepare("SELECT worked FROM adventure_help WHERE session_id=?").bind(sessionId).first<{ worked: number }>();
  const helped = !!hrow?.worked;
  let transferEvidence = false;
  if (cls.evaluation) {
    if (helped && !cls.newTask && cls.evaluation.assistance !== "worked_solution") cls.evaluation = { ...cls.evaluation, assistance: "worked_solution" };
    if (helped && cls.newTask) {
      transferEvidence = cls.evaluation.assistance === "none";
      await env.DB.prepare("UPDATE adventure_help SET worked=0 WHERE session_id=?").bind(sessionId).run();
    }
  }
  if (cls.tutorSolution) await env.DB.prepare("INSERT INTO adventure_help (session_id,worked) VALUES (?,1) ON CONFLICT(session_id) DO UPDATE SET worked=1").bind(sessionId).run();
  let academic: Record<string, unknown> | null = null;
  let evalEventId: string | null = null;
  if (cls.evaluation) {
    let verification = "pending";
    const claimsGood = cls.evaluation.correctness === "correct" && cls.evaluation.reasoning === "valid";
    if (claimsGood && ROUTING.crossCheckCorrect) {
      try {
        const v = parseJson(await deps.complete(ROUTING.verify.tier, ROUTING.verify.provider, VERIFY_PROMPT(input), 100));
        if (isObj(v) && v.agree === true && typeof v.ownAnswer === "string" && v.ownAnswer.trim()) verification = "confirmed";
      } catch {
        /* 保持 pending */
      }
    }
    evalEventId = "turn:" + turnId + ":eval";
    const ev = { id: evalEventId, type: "knowledge_attempt", topicId: ROUTING.topicId, at: Date.now(), ...cls.evaluation, verification, context: "adventure", transfer: transferEvidence };
    const pr = await postEvent(env, ev);
    if (pr.status !== 200) return uncertain("event_failed", "学习记录没写进去，没有提交任何行动。");
    if (cls.conceptId) await env.DB.prepare("INSERT OR IGNORE INTO adventure_evidence_concept (event_id,concept_id) VALUES (?,?)").bind(evalEventId, cls.conceptId).run();
    let firstUse = true;
    if (cls.insightKey) {
      const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_insight_use (event_id,insight_key,is_first) VALUES (?,?,1)").bind(evalEventId, sessionId + "|" + cls.insightKey).run();
      if (ins.meta.changes !== 1) {
        firstUse = false;
        await env.DB.prepare("INSERT OR IGNORE INTO adventure_insight_use (event_id,insight_key,is_first) VALUES (?,?,0)").bind(evalEventId, sessionId + "|" + cls.insightKey).run();
      }
    }
    academic = { ...cls.evaluation, verification, eventId: evalEventId, repeatedInsight: !firstUse, insightKey: cls.insightKey, conceptId: cls.conceptId };
  }

  // 3. 行动：只有 ACT 且玩家明确要求执行、故事进行中才可能提交；ASK/LEARN/PRACTICE 一律 null
  let commit: Record<string, unknown> | null = null;
  let worldEvents: PublicEvent[] = [];
  let visible = "";
  const wantsAct = intents.includes("ACT") && cls.explicitCommit;
  if (intents.includes("ACT") && !cls.explicitCommit) {
    visible = "已记下计划，还没有执行。需要执行时直接告诉我。";
    await env.DB.prepare("INSERT OR IGNORE INTO adventure_plans (plan_id,session_id,status,text,created_at) VALUES (?,?,'draft',?,?)").bind("turn:" + turnId, sessionId, input.slice(0, 200), Date.now() / 1000).run();
    await env.DB.prepare("INSERT OR IGNORE INTO adventure_plan_meta (plan_id,world_seq,reconfirm) VALUES (?,?,0)").bind("turn:" + turnId, sess.world_seq).run();
  }
  let planOk = true;
  let planId: string | null = null;
  if (wantsAct && cls.planRef !== "inline") {
    // 指代“刚才的方案”：必须有明确的草案，一次只消费一个。多个候选绝不默认选最近的，要请玩家指明；
    // 世界变了或过了很久的草案不会被删除，但执行前要玩家按当前情况再确认一次。
    const drafts = (await env.DB.prepare("SELECT p.plan_id, p.text, p.created_at, COALESCE(m.world_seq,0) AS ws, COALESCE(m.reconfirm,0) AS rc FROM adventure_plans p LEFT JOIN adventure_plan_meta m ON m.plan_id=p.plan_id WHERE p.session_id=? AND p.status='draft' ORDER BY p.created_at ASC").bind(sessionId).all<any>()).results;
    const letter = (n: number) => String.fromCharCode(65 + n);
    let pick: any = null;
    if (!drafts.length) {
      planOk = false;
      visible = "我没有找到一个待执行的方案。先告诉我你想怎么做，确认之后再说“执行”。";
    } else if (cls.planIndex) {
      pick = drafts[cls.planIndex - 1] ?? null;
      if (!pick) { planOk = false; visible = "没有这个编号的方案。现在有 " + drafts.length + " 个：" + drafts.map((d: any, n: number) => "方案 " + letter(n) + "：" + d.text.slice(0, 40)).join("；") + "。没有执行。"; }
    } else if (drafts.length === 1) pick = drafts[0];
    else {
      planOk = false;
      visible = "现在有 " + drafts.length + " 个待执行的方案，我不会替你选：" + drafts.map((d: any, n: number) => "方案 " + letter(n) + "：" + d.text.slice(0, 40)).join("；") + "。请说“执行方案 A”这样指明。没有执行。";
    }
    if (pick && planOk) {
      // 重新确认绑定到“提示时”的世界序号和时间：之后世界再变或再久，需要再次确认（#19 P0-1）。
      const rcRow = await env.DB.prepare("SELECT world_seq, at FROM adventure_plan_reconfirm WHERE plan_id=?").bind(pick.plan_id).first<{ world_seq: number; at: number }>();
      const baseWs = rcRow ? rcRow.world_seq : pick.ws, baseAt = rcRow ? rcRow.at : pick.created_at;
      const stale = baseWs !== sess.world_seq || Date.now() / 1000 - baseAt > ROUTING.planSoftTtlMs / 1000;
      if (stale) {
        planOk = false;
        await env.DB.prepare("INSERT INTO adventure_plan_reconfirm (plan_id,world_seq,at) VALUES (?,?,?) ON CONFLICT(plan_id) DO UPDATE SET world_seq=excluded.world_seq, at=excluded.at").bind(pick.plan_id, sess.world_seq, Date.now() / 1000).run();
        visible = "这个方案是之前定的（" + (baseWs !== sess.world_seq ? "之后世界已经发生了变化" : "已经过了一段时间") + "），我没有直接执行。要按现在的情况执行吗？确认的话再说一次“执行”。";
      } else planId = pick.plan_id;
    }
  }
  // 对话选择：玩家明确提交一个当前可选的对话选择 → 服务端触发 dialogue_choice_committed 事件（不掷骰）
  let choiceDone = false;
  let moved = false;
  if (cls.choiceId && cls.explicitCommit && sess.status === "active") {
    const pick = choiceList.find((c) => c.choiceId === cls.choiceId);
    if (pick) {
      choiceDone = true;
      try {
        const r = await commitChoice(env, { sessionId, commitId: "t-" + turnId, choiceId: pick.choiceId, npcId: pick.npcId });
        worldEvents = r.status === 200 ? (r.body as any).worldEvents ?? [] : [];
      } catch { worldEvents = []; }
      if (!worldEvents.length) visible = "这个选择现在没有引起任何变化。";
    }
  }
  // 移动：玩家明确前往当前场景允许的地点 → 服务端更新场景并触发 scene_entered 事件链（不掷骰）
  if (!choiceDone && cls.moveTo && sess.status === "active" && moveList.some((m) => m.sceneId === cls.moveTo)) {
    choiceDone = true;
    try {
      const r = await commitTravel(env, { sessionId, commitId: "t-" + turnId, target: cls.moveTo });
      worldEvents = r.status === 200 ? (r.body as any).worldEvents ?? [] : [];
      moved = r.status === 200;
    } catch { worldEvents = []; }
  }
  if (wantsAct && planOk && !choiceDone) {
    if (sess.status !== "active" && !cls.storyResume) visible = "故事现在是暂停状态，没有执行行动。说“继续”就能回到刚才。";
    else {
      if (sess.status !== "active") await env.DB.prepare("UPDATE adventure_sessions SET status='active', updated_at=? WHERE id=?").bind(Date.now() / 1000, sessionId).run();
      const pb = await pickBasis(env, sessionId, chosen, cls.actionTemplate);
      if (!pb.ok) {
        visible = pb.message;
        if (planId) { /* 方案保持 draft，玩家可以改选依据后再执行 */ }
      }
      const basis = pb.ok ? { id: pb.id } : null;
      if (!pb.ok) { /* 不提交 */ } else {
      const r = await postAction(env, { actionId: "turn:" + turnId, basisEventId: basis?.id ?? null, actionTemplate: cls.actionTemplate, sessionId });
      if (r.status === 200) {
        commit = { ...(r.body.outcome as Record<string, unknown>), actionTemplate: cls.actionTemplate };
        await env.DB.prepare("INSERT OR IGNORE INTO adventure_action_meta (action_id,template) VALUES (?,?)").bind("turn:" + turnId, cls.actionTemplate).run();
        if (planId) await env.DB.prepare("UPDATE adventure_plans SET status='consumed' WHERE plan_id=? AND status='draft'").bind(planId).run();
        if (!r.body.replay) await env.DB.prepare("UPDATE adventure_sessions SET world_seq=world_seq+1, updated_at=? WHERE id=?").bind(Date.now() / 1000, sessionId).run();
        // 世界事件：服务端规则确认世界变化；没有内容包时不介入
        try {
          worldEvents = r.body.replay
            ? await replayPublicOutcomes(env, sessionId, "turn:" + turnId)
            : await applyTrigger(env, sessionId, { type: "action_resolved", actionId: "turn:" + turnId, success: !!(commit as any).success, actionTemplate: cls.actionTemplate });
        } catch { worldEvents = []; }
      } else visible = String(r.body.message ?? "行动没有提交");
      }
    }
  }

  // 4. 故事暂停/恢复 + ResumeCursor：课程游标与世界序号互不影响；嵌套提问不丢游标；“继续”有歧义时只问一句，不改状态
  let status = sess.status as string;
  const cur0 = await getCursor(env, sessionId);
  let cursor = cur0;
  if (!commit) {
    if (cls.pauseStory && !wantsAct && status === "active") {
      status = "paused";
      cursor = { open: true, segment: sess.segment, nested: 0, asked: false };
    } else if (cls.storyResume && status === "paused") {
      const t = cls.resumeTarget;
      if (t === "lesson" && cursor.open) {
        visible = visible || `好，回到刚才的课（第 ${cursor.segment} 段），故事先保持暂停。`;
        cursor = { ...cursor, nested: 0, asked: false };
      } else if (t === "unspecified" && cursor.open && !cursor.asked) {
        visible = `你是想继续刚才的课（第 ${cursor.segment} 段），还是回到故事？告诉我一个就行，我现在什么都没改。`;
        cursor = { ...cursor, asked: true };
      } else {
        status = "active";
        cursor = { ...cursor, asked: false };
      }
    } else if (status === "paused" && cursor.open && !cls.storyResume && (intents.includes("ASK") || intents.includes("LEARN"))) {
      cursor = { ...cursor, nested: cursor.nested + 1 }; // 嵌套提问：游标不动
    }
    if (status !== sess.status) await env.DB.prepare("UPDATE adventure_sessions SET status=?, updated_at=? WHERE id=?").bind(status, Date.now() / 1000, sessionId).run();
  } else status = "active";
  if (JSON.stringify(cursor) !== JSON.stringify(cur0)) await putCursor(env, sessionId, cursor);

  // 5. 回复：按主要意图选模型；叙述只能引用已提交的事实
  const main = intents.includes("LEARN") ? "LEARN" : intents.includes("ACT") && commit ? "ACT" : intents[0];
  const qrow = await env.DB.prepare("SELECT quiet FROM adventure_flags WHERE session_id=?").bind(sessionId).first<{ quiet: number }>();
  let quiet = !!qrow?.quiet;
  if (cls.quiet === "on") quiet = true;
  else if (cls.quiet === "off" || cls.evaluation) quiet = false; // 主动求提示或提交了答案，静默结束
  if (quiet !== !!qrow?.quiet) await env.DB.prepare("INSERT INTO adventure_flags (session_id,quiet) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET quiet=excluded.quiet").bind(sessionId, quiet ? 1 : 0).run();
  const route = ROUTING.reply[main] ?? ROUTING.reply.ASK;
  const sceneInfo = sess.status === "active" ? await publicSceneInfo(env, sessionId).catch(() => ({ active: false } as { active: boolean; publicText?: string })) : { active: false } as { active: boolean; publicText?: string };
  const sceneFact = sceneInfo.publicText ? "（玩家当前所在场景的公开描述。玩家观察、张望、探索、问周围有什么，或说“继续”而没有待办数学内容时，直接据此沉浸式描写，不要超出它，不要编造它没写的隐藏事实或人物身份；这是静态环境，不需要任何“提交”。" + sceneInfo.publicText + "）" : "";
  const facts = sceneFact + (commit ? `已提交的事实（只能叙述这些）：判定${commit.success ? "成功" : "失败"}（骰点${commit.roll}+知识加成${commit.bonus}，对 DC${commit.dc}）。${worldEvents.length ? "服务器确认的世界结果（只能据此叙述，可以润色措辞，但不能增加新事实）：" + worldEvents.map((w) => w.publicOutcome).join(" / ") + "。除此之外不要编造别的变化。" : "具体的环境变化、后果和故事推进服务器还没有给出，所以只能说“判定成功/失败，具体后果尚未确定”这类话；绝不能编造门打开、敌人退走、场景切换、目标达成或时间流逝。允许一句不带新事实的过渡，如“你按计划尝试，检定成功”。"}` : moved && !worldEvents.length ? "玩家移动到了新的场景，服务器没有额外的事件结果；只能根据上面给出的场景公开描述叙述。" : worldEvents.length ? "玩家提交了一个选择或移动。服务器确认的世界结果（只能据此叙述，可以润色措辞，但不能增加新事实）：" + worldEvents.map((w) => w.publicOutcome).join(" / ") + "。除此之外不要编造别的变化。" : "本回合没有任何世界行动被提交，不要叙述世界发生了什么。");
  const prompt = `你是学习型冒险游戏里的导师兼 DM。数学内容必须准确，不能因为故事改变数学事实。玩家意图：${intents.join("+")}。${facts}${academic ? `（内部记录，界面会另外显示标签，回复里不要出现这些字段名或英文标签）这位玩家本次解答的判定：${academic.correctness==='correct'?'结论正确':'结论有问题'}，${academic.reasoning==='valid'?'推理成立':'推理有缺陷'}。用自然的话告诉玩家结果和原因，不要写“学术评估”“correct”之类。` : ""}按玩家要的篇幅回答，别用任务菜单打断。玩家答对后，默认用一句话简短补充另一种方法或检查办法，并告诉他想深入可以继续问，不要强制展开；但玩家处于静默状态、或说了“只告诉我对不对”“让我自己想”“不要剧透步骤”时，不要主动给。玩家只是说“先别执行”这类暂缓时，回答“好，先不执行。你可以继续完善方案，或直接问我相关知识”，不要强迫他交步骤；只有他明确让你评估方案时才邀请他写出步骤。要提示只给最小的一条线索，不给完整解答；玩家说“我想自己想想”就极简回应，不主动追加提示；玩家连续表示听不懂就换表示方式（数值/符号/几何）而不是复述；刷题就不要叙事装饰。${quiet ? "现在是静默状态：玩家想自己想，极简回应（一句话），不要泄露任何步骤，不要暗示解法，不要主动给提示。" : ""}${academic && academic.repeatedInsight ? "这是对已记录思路的重复表述，认可即可，不要说它带来了新的优势。" : ""}\n${ctx}\n面向玩家绝不使用内部措辞，如“探索意图”“具体世界行动”“没有提交”“验证数学方法”“服务器”“场景ID”；玩家想去某处却没成功时，用世界里的阻碍说一句（如“那条路现在走不通”）并提示他还能做什么。玩家说“继续/继续刚才的”且没有待验证的数学内容时，接着当前场景往下描写，不要要求他交数学方法。玩家说“刚才的方法/那个/上一个”时，指上面最近对话里的内容，按那个理解，不要反问“你指哪个方法”。\n玩家输入：${input}`;
  let narration = "";
  let retry: { tier: string; provider: string; prompt: string; maxTok: number } | undefined;
  try {
    narration = await deps.complete(route.tier, route.provider, prompt, main === "LEARN" ? 2500 : 1200);
  } catch {
    retry = { tier: route.tier, provider: route.provider, prompt, maxTok: main === "LEARN" ? 2500 : 1200 };
    narration = "";
    visible = visible || "回复模型暂时不可用，但记录和进度都已保存。";
  }
  const cur = await env.DB.prepare("SELECT status, segment, world_seq FROM adventure_sessions WHERE id=?").bind(sessionId).first<any>();
  return {
    status: 200,
    body: {
      ok: true,
      uncertainty: false,
      routingVersion: ROUTING.version,
      configVersion: CONFIG.version,
      playerInput: input.slice(0, 400),
      intentSegments: intents,
      academicEvaluation: academic,
      gameCommit: commit,
      worldEvents,
      ...(sceneInfo.publicText && (worldEvents.length || moved) ? { scene: { publicText: sceneInfo.publicText } } : {}),
      learningSessionDelta: { status: cur.status, segment: cur.segment, worldSeq: cur.world_seq, resumeCursor: { lessonOpen: cursor.open, lessonSegment: cursor.segment, nestedDepth: cursor.nested, resumeAsked: cursor.asked } },
      narration,
      quietMode: quiet,
      visibleFeedback: visible,
      ...(retry ? { _retry: retry } : {}),
    },
  };
}
