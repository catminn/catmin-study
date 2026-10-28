// 冒险引擎切片（MATH 1920 sandbox_math）：学习会话 + 行动提交。数值全部来自 CONFIG（带版本号）。
//   POST /api/adventure/action   {actionId, basisEventId?}  幂等：同 actionId 重试返回原结果，不重掷
//   POST /api/adventure/session  {sessionId, op:"start"|"pause"|"resume"|"progress", segment?}
//   GET  /api/adventure/session?id=
// 规则：知识加成只来自 verification=confirmed 且 correct+valid 的事件，且每个事件只能被一次行动消费。
import type { SiteEnv } from "./site";

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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, segment INTEGER NOT NULL, world_seq INTEGER NOT NULL, updated_at REAL NOT NULL)`),
  ]).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

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
    const ev = await env.DB.prepare("SELECT correctness, reasoning, assistance, verification FROM learning_events WHERE id=?").bind(basis).first<any>();
    if (!ev) return fail(422, "basis_not_found", "依据的学习事件不存在");
    if (ev.verification !== "confirmed") return fail(422, "basis_not_confirmed", "依据的事件还没有确认，不能提供知识加成");
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
  } else {
    const s = await env.DB.prepare("SELECT 1 FROM adventure_sessions WHERE id=?").bind(id).first();
    if (!s) return fail(404, "not_found", "会话不存在");
    if (op === "pause") await env.DB.prepare("UPDATE adventure_sessions SET status='paused', updated_at=? WHERE id=?").bind(now, id).run();
    if (op === "resume") await env.DB.prepare("UPDATE adventure_sessions SET status='active', updated_at=? WHERE id=?").bind(now, id).run();
    if (op === "progress") {
      const seg = body.segment;
      if (!Number.isSafeInteger(seg) || (seg as number) < 0 || (seg as number) > 10000) return fail(400, "bad_request", "segment 不合法");
      // 只增不减：重试/乱序不会让进度倒退；世界事件序号不受学习进度影响
      await env.DB.prepare("UPDATE adventure_sessions SET segment=MAX(segment,?), updated_at=? WHERE id=?").bind(seg, now, id).run();
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
