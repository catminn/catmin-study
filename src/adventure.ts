// 冒险引擎切片（MATH 1920 sandbox_math）：学习会话 + 行动提交。数值全部来自 CONFIG（带版本号）。
//   POST /api/adventure/action   {actionId, basisEventId?}  幂等：同 actionId 重试返回原结果，不重掷
//   POST /api/adventure/session  {sessionId, op:"start"|"pause"|"resume"|"progress", segment?}
//   GET  /api/adventure/session?id=
// 规则：知识加成只来自 verification=confirmed 且 correct+valid 的事件，且每个事件只能被一次行动消费。
import type { SiteEnv } from "./site";
import { pinWorldForSession } from "./world";

export const CONFIG = {
  version: "slice-1.0.0",
  die: 20,
  baseDc: 12,
  knowledgeBonus: 3, // 已确认的正确且推理有效的事件
  hintPenaltyAssistance: new Set(["major_hint", "worked_solution"]), // 重度提示：加成减半（向下取整）
};

type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, code: string, message: string): Result => ({ status, body: { code, message } });
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const idOk = (x: unknown): x is string => typeof x === "string" && /^[\w.:-]{1,120}$/.test(x);

let ready: Promise<unknown> | null = null;
function ensureSchema(env: SiteEnv) {
  ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_actions (action_id TEXT PRIMARY KEY, basis_event_id TEXT UNIQUE, config_version TEXT NOT NULL, roll INTEGER NOT NULL, bonus INTEGER NOT NULL, dc INTEGER NOT NULL, success INTEGER NOT NULL, created_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_evidence_concept (event_id TEXT PRIMARY KEY, concept_id TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_cursor (session_id TEXT PRIMARY KEY, lesson_open INTEGER NOT NULL, lesson_segment INTEGER NOT NULL, nested_depth INTEGER NOT NULL DEFAULT 0, resume_asked INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, segment INTEGER NOT NULL, world_seq INTEGER NOT NULL, updated_at REAL NOT NULL)`),
  ]).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

// 服务器可信的行动模板：知识加成只来自 requiredConcepts 匹配的已确认证据（见 ChatGPT 信箱 #18）。同一个课程主题不等于能给任何行动加成。
export const CONCEPTS = ["math1920.derivative-basics", "math1920.partial-derivative", "math1920.gradient", "math1920.directional-derivative", "math1920.chain-rule-multivariable"];
type Req = { conceptId: string; application: string; effectType: "one-knowledge-bonus" };
const R = (conceptId: string, application: string): Req[] => [{ conceptId, application, effectType: "one-knowledge-bonus" }];
// 内容包里的旧模板名 → 引擎模板名（仅用于世界事件匹配）
export const ACTION_ALIASES: Record<string, string> = { "apply-gradient-method": "determine-local-steepest-ascent" };
export const ACTIONS: Record<string, { requiredConcepts: Req[] }> = {
  "apply-derivative-method": { requiredConcepts: R("math1920.derivative-basics", "compute-rate-by-differentiating") },
  "estimate-change-in-one-variable": { requiredConcepts: R("math1920.partial-derivative", "estimate-change-in-one-variable") },
  "determine-local-steepest-ascent": { requiredConcepts: R("math1920.gradient", "determine-local-steepest-ascent") },
  "predict-change-along-chosen-direction": { requiredConcepts: R("math1920.directional-derivative", "predict-change-along-chosen-direction") },
  "derive-rate-along-parametric-path": { requiredConcepts: R("math1920.chain-rule-multivariable", "derive-rate-along-parametric-path") },
  "propose-safety-plan": { requiredConcepts: [] }, // 非数学行动（内容包里的行动模板），不吃数学加成
  "plain-action": { requiredConcepts: [] }, // 例如纯体力行动，任何数学证据都不能加成
};

const view = (r: any) => ({ actionId: r.action_id, basisEventId: r.basis_event_id, configVersion: r.config_version, roll: r.roll, bonus: r.bonus, dc: r.dc, success: !!r.success });

export async function postAction(env: SiteEnv, body: unknown): Promise<Result> {
  if (!isObj(body) || !idOk(body.actionId)) return fail(400, "bad_request", "actionId 不合法");
  const basis = body.basisEventId;
  if (basis !== undefined && basis !== null && !idOk(basis)) return fail(400, "bad_request", "basisEventId 不合法");
  await ensureSchema(env);
  const old = await env.DB.prepare("SELECT * FROM adventure_actions WHERE action_id=?").bind(body.actionId).first<any>();
  if (old) {
    if ((old.basis_event_id ?? null) !== (basis ?? null)) return fail(409, "action_conflict", "这个 actionId 已用于另一次行动");
    return { status: 200, body: { ok: true, replay: true, outcome: view(old) } };
  }
  let bonus = 0;
  if (basis) {
    // 最终写入点的权威检查：不依赖调用方（turn 引擎或直接调 API）是否先过了 pickBasis。
    const tpl = body.actionTemplate;
    if (typeof tpl !== "string" || !ACTIONS[tpl]) return fail(400, "bad_request", "使用知识依据时必须提供合法的 actionTemplate");
    if (!idOk(body.sessionId)) return fail(400, "bad_request", "使用知识依据时必须提供 sessionId");
    const need = ACTIONS[tpl].requiredConcepts.map((c) => c.conceptId);
    if (!need.length) return fail(422, "basis_not_applicable", "这个行动不需要也不吃知识加成");
    const own = await env.DB.prepare("SELECT 1 FROM adventure_turns WHERE session_id=? AND ?=('turn:'||turn_id||':eval')").bind(body.sessionId, basis).first().catch(() => null);
    if (!own) return fail(422, "basis_wrong_session", "这条依据不属于这个会话");
    const cm = await env.DB.prepare("SELECT concept_id FROM adventure_evidence_concept WHERE event_id=?").bind(basis).first<{ concept_id: string }>();
    if (!cm || !need.includes(cm.concept_id)) return fail(422, "basis_concept_mismatch", "这条依据的知识点和这个行动不匹配");
    const ev = await env.DB.prepare("SELECT correctness, reasoning, assistance, verification FROM learning_events WHERE id=?").bind(basis).first<any>();
    if (!ev) return fail(422, "basis_not_found", "依据的学习事件不存在");
    if (ev.verification !== "confirmed") return fail(422, "basis_not_confirmed", "依据的事件还没有确认，不能提供知识加成");
    if (ev.assistance === "worked_solution") return fail(422, "basis_not_independent", "看过完整解答后的作答不能作为知识加成依据");
    if (ev.correctness === "correct" && ev.reasoning === "valid") {
      bonus = CONFIG.knowledgeBonus;
      if (CONFIG.hintPenaltyAssistance.has(ev.assistance)) bonus = Math.floor(bonus / 2);
    }
  }
  const roll = 1 + (crypto.getRandomValues(new Uint32Array(1))[0] % CONFIG.die);
  const success = roll + bonus >= CONFIG.baseDc ? 1 : 0;
  // basis_event_id UNIQUE：同一个依据只能被消费一次；并发时第二个插入会被忽略
  const r = await env.DB.prepare(
    "INSERT OR IGNORE INTO adventure_actions (action_id,basis_event_id,config_version,roll,bonus,dc,success,created_at) VALUES (?,?,?,?,?,?,?,?)",
  ).bind(body.actionId, basis ?? null, CONFIG.version, roll, bonus, CONFIG.baseDc, success, Date.now() / 1000).run();
  const cur = await env.DB.prepare("SELECT * FROM adventure_actions WHERE action_id=?").bind(body.actionId).first<any>();
  if (r.meta.changes === 1 && cur) return { status: 200, body: { ok: true, replay: false, outcome: view(cur) } };
  if (cur) return { status: 200, body: { ok: true, replay: true, outcome: view(cur) } }; // 并发同 ID
  return fail(409, "basis_already_used", "这个依据事件已经被另一次行动使用，知识优势不能重复叠加");
}

export async function sessionOp(env: SiteEnv, body: unknown): Promise<Result> {
  if (!isObj(body) || !idOk(body.sessionId)) return fail(400, "bad_request", "sessionId 不合法");
  const op = body.op;
  if (!["start", "pause", "resume", "progress"].includes(op as string)) return fail(400, "bad_request", "op 不合法");
  await ensureSchema(env);
  const id = body.sessionId;
  const now = Date.now() / 1000;
  if (op === "start") {
    await env.DB.prepare("INSERT OR IGNORE INTO adventure_sessions (id,status,segment,world_seq,updated_at) VALUES (?,?,?,?,?)").bind(id, "active", 0, 0, now).run();
    // 可选：显式选择世界（固定 worldId 与各内容修订）；世界不存在/不唯一或会话已固定到别的世界 → 400，不猜
    if (body.worldId !== undefined) {
      if (typeof body.worldId !== "string" || !(await pinWorldForSession(env, id, body.worldId))) return fail(400, "bad_world", "worldId 不存在或会话已固定到别的世界");
    }
  } else {
    const s = await env.DB.prepare("SELECT 1 FROM adventure_sessions WHERE id=?").bind(id).first();
    if (!s) return fail(404, "not_found", "会话不存在");
    if (op === "pause") {
      await env.DB.prepare("UPDATE adventure_sessions SET status='paused', updated_at=? WHERE id=?").bind(now, id).run();
      // 暂停时在当前学习进度处留下课程游标（不动世界序号）
      await env.DB.prepare("INSERT INTO adventure_cursor (session_id,lesson_open,lesson_segment,nested_depth,resume_asked,updated_at) SELECT id,1,segment,0,0,? FROM adventure_sessions WHERE id=? ON CONFLICT(session_id) DO UPDATE SET lesson_open=1, lesson_segment=MAX(lesson_segment, excluded.lesson_segment), updated_at=excluded.updated_at").bind(now, id).run();
    }
    if (op === "resume") await env.DB.prepare("UPDATE adventure_sessions SET status='active', updated_at=? WHERE id=?").bind(now, id).run();
    if (op === "progress") {
      const seg = body.segment;
      if (!Number.isSafeInteger(seg) || (seg as number) < 0 || (seg as number) > 10000) return fail(400, "bad_request", "segment 不合法");
      // 只增不减：重试/乱序不会让进度倒退；世界事件序号不受学习进度影响
      await env.DB.prepare("UPDATE adventure_sessions SET segment=MAX(segment,?), updated_at=? WHERE id=?").bind(seg, now, id).run();
      await env.DB.prepare("UPDATE adventure_cursor SET lesson_segment=MAX(lesson_segment,?), updated_at=? WHERE session_id=? AND lesson_open=1").bind(seg, now, id).run();
    }
  }
  return getSession(env, id);
}

export async function getSession(env: SiteEnv, id: string): Promise<Result> {
  await ensureSchema(env);
  const s = await env.DB.prepare("SELECT id,status,segment,world_seq FROM adventure_sessions WHERE id=?").bind(id).first<any>();
  if (!s) return fail(404, "not_found", "会话不存在");
  return { status: 200, body: { id: s.id, status: s.status, segment: s.segment, worldSeq: s.world_seq } };
}
