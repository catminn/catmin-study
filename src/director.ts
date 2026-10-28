// 导演提示冷却：只有数据结构和判定函数（不接入 DM 回复）。
// 规则：同主题提示间隔 ≥ 20 分钟；同一天被拒绝 2 次后当天不再提示；玩家说“我想继续探索”后抑制到指定时间。
import type { SiteEnv } from "./site";

export const DIRECTOR_CONFIG = {
  version: "director-1.0.0",
  sameTopicCooldownMs: 20 * 60 * 1000,
  maxRefusalsPerDay: 2,
  exploreSuppressMs: 30 * 60 * 1000,
};

let ready: Promise<unknown> | null = null;
function ensure(env: SiteEnv) {
  return (ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_director_prompts (session_id TEXT NOT NULL, topic_id TEXT NOT NULL, at INTEGER NOT NULL, day TEXT NOT NULL, refused INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (session_id,topic_id,at))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_director_state (session_id TEXT PRIMARY KEY, suppress_until INTEGER NOT NULL DEFAULT 0)`),
  ]).catch((e) => { ready = null; throw e; }));
}
// “当天”按 UTC 日期切分；以后接入用户时区时只需改这里。
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type Decision = { allow: boolean; reason: "ok" | "cooldown" | "refused_today" | "suppressed" };

export async function canPrompt(env: SiteEnv, sid: string, topic: string, now = Date.now()): Promise<Decision> {
  await ensure(env);
  const st = await env.DB.prepare("SELECT suppress_until FROM adventure_director_state WHERE session_id=?").bind(sid).first<{ suppress_until: number }>();
  if (st && st.suppress_until > now) return { allow: false, reason: "suppressed" };
  const ref = await env.DB.prepare("SELECT COUNT(*) AS n FROM adventure_director_prompts WHERE session_id=? AND day=? AND refused=1").bind(sid, dayOf(now)).first<{ n: number }>();
  if ((ref?.n ?? 0) >= DIRECTOR_CONFIG.maxRefusalsPerDay) return { allow: false, reason: "refused_today" };
  const last = await env.DB.prepare("SELECT MAX(at) AS at FROM adventure_director_prompts WHERE session_id=? AND topic_id=?").bind(sid, topic).first<{ at: number | null }>();
  if (last?.at != null && now - last.at < DIRECTOR_CONFIG.sameTopicCooldownMs) return { allow: false, reason: "cooldown" };
  return { allow: true, reason: "ok" };
}
export async function recordPrompt(env: SiteEnv, sid: string, topic: string, now = Date.now()) {
  await ensure(env);
  await env.DB.prepare("INSERT OR IGNORE INTO adventure_director_prompts (session_id,topic_id,at,day,refused) VALUES (?,?,?,?,0)").bind(sid, topic, now, dayOf(now)).run();
}
// 玩家拒绝了某个主题的最近一次提示（重复调用不重复计数：同一条提示只记一次）
export async function recordRefusal(env: SiteEnv, sid: string, topic: string) {
  await ensure(env);
  await env.DB.prepare("UPDATE adventure_director_prompts SET refused=1 WHERE session_id=? AND topic_id=? AND at=(SELECT MAX(at) FROM adventure_director_prompts WHERE session_id=? AND topic_id=?)").bind(sid, topic, sid, topic).run();
}
export async function suppressExplore(env: SiteEnv, sid: string, now = Date.now()) {
  await ensure(env);
  await env.DB.prepare("INSERT INTO adventure_director_state (session_id,suppress_until) VALUES (?,?) ON CONFLICT(session_id) DO UPDATE SET suppress_until=MAX(suppress_until,excluded.suppress_until)").bind(sid, now + DIRECTOR_CONFIG.exploreSuppressMs).run();
}
