// 学习事件与奖励事件接口（只追加、幂等）。规则出处：docs/rules-spec-v1.md、public/study-core.mjs（PR #1）
//   POST /api/events          提交一条学习事件；同一 id 同一内容 → inserted:false；同一 id 不同内容 → 409
//   GET  /api/events          ?topic=&limit=  读取事件
//   POST /api/rewards         {rewardId, sourceEventId, points, at}；来源事件必须 verification=confirmed；一个来源最多一次
//   GET  /api/rewards/balance 服务端汇总余额
// 这些表独立于旧的 state 文档，旧页面完全不会碰到它们。
import type { SiteEnv } from "./site";

const TYPES = new Set(["knowledge_attempt", "study_session_completed", "daily_checkin_completed", "course_task_completed", "mastery_reviewed"]);
const CORRECT = new Set(["correct", "incorrect", "partial", "unknown"]);
const REASON = new Set(["valid", "partial", "invalid", "not_assessed"]);
const ASSIST = new Set(["none", "minor_hint", "major_hint", "worked_solution", "unknown"]);
const VERIFY = new Set(["confirmed", "pending", "rejected"]);
const CONTEXT = new Set(["adventure", "tutor", "daily", "practice", "offline", "other"]);

type Result = { status: number; body: Record<string, unknown> };
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const label = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 180;
const nonNegInt = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const fail = (status: number, code: string, message: string): Result => ({ status, body: { code, message } });

// 键排序后的 JSON，用来判断“内容是否相同”
function canon(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (isObj(v)) return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

let ready: Promise<unknown> | null = null;
function ensureSchema(env: SiteEnv) {
  ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS learning_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, topic_id TEXT NOT NULL, at INTEGER NOT NULL, correctness TEXT NOT NULL, reasoning TEXT NOT NULL, assistance TEXT NOT NULL, verification TEXT NOT NULL, context TEXT NOT NULL, transfer INTEGER NOT NULL, payload TEXT NOT NULL, created_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_le_topic ON learning_events(topic_id, at)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reward_events (id TEXT PRIMARY KEY, source_event_id TEXT NOT NULL UNIQUE, points INTEGER NOT NULL CHECK (points >= 0 AND points <= 10000), at INTEGER NOT NULL, created_at REAL NOT NULL)`),
  ]).catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}

export function validateEvent(e: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; why: string } {
  if (!isObj(e)) return { ok: false, why: "事件必须是对象" };
  if (!label(e.id)) return { ok: false, why: "id 不合法（1–180 个字符）" };
  if (typeof e.type !== "string" || !TYPES.has(e.type)) return { ok: false, why: "type 不合法" };
  if (!label(e.topicId)) return { ok: false, why: "topicId 不合法" };
  if (!nonNegInt(e.at)) return { ok: false, why: "at 必须是非负整数（毫秒）" };
  if (typeof e.correctness !== "string" || !CORRECT.has(e.correctness)) return { ok: false, why: "correctness 不合法" };
  if (typeof e.reasoning !== "string" || !REASON.has(e.reasoning)) return { ok: false, why: "reasoning 不合法" };
  if (typeof e.assistance !== "string" || !ASSIST.has(e.assistance)) return { ok: false, why: "assistance 不合法" };
  if (typeof e.verification !== "string" || !VERIFY.has(e.verification)) return { ok: false, why: "verification 不合法" };
  if (typeof e.context !== "string" || !CONTEXT.has(e.context)) return { ok: false, why: "context 不合法" };
  if (typeof e.transfer !== "boolean") return { ok: false, why: "transfer 必须是 true/false" };
  const keep = ["id", "type", "topicId", "at", "correctness", "reasoning", "assistance", "verification", "context", "transfer"];
  // 只保留约定的字段，多余字段拒绝，避免把隐藏信息悄悄存进事件
  const extra = Object.keys(e).filter((k) => !keep.includes(k));
  if (extra.length) return { ok: false, why: "不允许的字段：" + extra.join(",") };
  return { ok: true, value: Object.fromEntries(keep.map((k) => [k, e[k]])) };
}

export async function postEvent(env: SiteEnv, body: unknown): Promise<Result> {
  const v = validateEvent(isObj(body) && "event" in body ? body.event : body);
  if (!v.ok) return fail(400, "bad_request", v.why);
  await ensureSchema(env);
  const e = v.value as any;
  const payload = canon(e);
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO learning_events (id,type,topic_id,at,correctness,reasoning,assistance,verification,context,transfer,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(e.id, e.type, e.topicId, e.at, e.correctness, e.reasoning, e.assistance, e.verification, e.context, e.transfer ? 1 : 0, payload, Date.now() / 1000)
    .run();
  if (r.meta.changes === 1) return { status: 200, body: { ok: true, inserted: true, id: e.id } };
  const old = await env.DB.prepare("SELECT payload FROM learning_events WHERE id=?").bind(e.id).first<{ payload: string }>();
  if (old && old.payload === payload) return { status: 200, body: { ok: true, inserted: false, id: e.id } };
  return fail(409, "id_conflict", "同一个 id 已经存在，但内容不同（事件不可修改，请使用新的 id）");
}

export async function listEvents(env: SiteEnv, url: URL): Promise<Result> {
  await ensureSchema(env);
  const topic = url.searchParams.get("topic");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 500);
  const rows = topic
    ? await env.DB.prepare("SELECT payload FROM learning_events WHERE topic_id=? ORDER BY at DESC, id LIMIT ?").bind(topic, limit).all<{ payload: string }>()
    : await env.DB.prepare("SELECT payload FROM learning_events ORDER BY at DESC, id LIMIT ?").bind(limit).all<{ payload: string }>();
  return { status: 200, body: { events: rows.results.map((r) => JSON.parse(r.payload)) } };
}

export async function postReward(env: SiteEnv, body: unknown): Promise<Result> {
  if (!isObj(body)) return fail(400, "bad_request", "请求体必须是对象");
  const { rewardId, sourceEventId, points, at } = body;
  if (!label(rewardId) || !label(sourceEventId)) return fail(400, "bad_request", "rewardId / sourceEventId 不合法");
  if (!Number.isSafeInteger(points) || (points as number) < 0 || (points as number) > 10000) return fail(400, "bad_request", "points 必须是 0–10000 的整数");
  if (!nonNegInt(at)) return fail(400, "bad_request", "at 必须是非负整数（毫秒）");
  await ensureSchema(env);
  // 一条语句里同时检查“来源存在且已确认”和插入，避免并发下的检查与写入之间被钻空子
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO reward_events (id,source_event_id,points,at,created_at)
     SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM learning_events WHERE id=? AND verification='confirmed')`,
  )
    .bind(rewardId, sourceEventId, points, at, Date.now() / 1000, sourceEventId)
    .run();
  if (r.meta.changes === 1) return { status: 200, body: { ok: true, inserted: true, balance: await balance(env) } };
  const old = await env.DB.prepare("SELECT id, source_event_id, points FROM reward_events WHERE id=? OR source_event_id=?")
    .bind(rewardId, sourceEventId)
    .first<{ id: string; source_event_id: string; points: number }>();
  if (old) {
    if (old.id === rewardId && old.source_event_id === sourceEventId && old.points === points) return { status: 200, body: { ok: true, inserted: false, balance: await balance(env) } };
    return fail(409, "reward_conflict", "这个来源事件已经发过奖励，或 rewardId 已被使用且内容不同");
  }
  return fail(422, "source_not_confirmed", "来源事件不存在，或还没有 verification=confirmed，不能发奖励");
}

async function balance(env: SiteEnv) {
  const b = await env.DB.prepare("SELECT COALESCE(SUM(points),0) AS total, COUNT(*) AS n FROM reward_events").first<{ total: number; n: number }>();
  return { points: b?.total ?? 0, rewards: b?.n ?? 0 };
}

export async function getBalance(env: SiteEnv): Promise<Result> {
  await ensureSchema(env);
  return { status: 200, body: await balance(env) };
}
