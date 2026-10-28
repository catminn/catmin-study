// 私有故事内容库：只有登录后才能读写，内容存在网站自己的 D1 里，不进 GitHub、不进共享记忆。
// 引擎目前不读取内容（沙盒用占位）；这里只提供安全的导入/读取通道，内容字段由 ChatGPT 的内容规格定义。
import type { SiteEnv } from "./site";

export const CONTENT_KINDS = ["world", "npc", "event", "knowledge-link", "scene"] as const;
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const MAX_BYTES = 64 * 1024;

let ready = false;
async function ensure(env: SiteEnv) {
  if (ready) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS adventure_content (kind TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (kind,id,rev))",
  ).run();
  ready = true;
}
type R = { status: number; body: unknown };
const bad = (status: number, error: string, message: string): R => ({ status, body: { ok: false, error, message } });

export async function putContent(env: SiteEnv, b: any): Promise<R> {
  await ensure(env);
  if (!b || typeof b !== "object") return bad(400, "bad_request", "需要 JSON");
  if (!(CONTENT_KINDS as readonly string[]).includes(b.kind)) return bad(400, "bad_kind", `kind 只能是 ${CONTENT_KINDS.join("/")}`);
  if (typeof b.id !== "string" || !ID_RE.test(b.id)) return bad(400, "bad_id", "id 需为小写字母/数字/._-");
  if (b.content === undefined || b.content === null || typeof b.content !== "object") return bad(400, "bad_content", "content 需为 JSON 对象");
  const body = JSON.stringify(b.content);
  if (body.length > MAX_BYTES) return bad(413, "too_large", "单条内容上限 64KB");
  const last = await env.DB.prepare("SELECT rev, body FROM adventure_content WHERE kind=? AND id=? ORDER BY rev DESC LIMIT 1").bind(b.kind, b.id).first<{ rev: number; body: string }>();
  if (last && last.body === body) return { status: 200, body: { ok: true, unchanged: true, rev: last.rev } };
  const rev = (last?.rev ?? 0) + 1;
  await env.DB.prepare("INSERT INTO adventure_content (kind,id,rev,body,created_at) VALUES (?,?,?,?,?)").bind(b.kind, b.id, rev, body, new Date().toISOString()).run();
  return { status: 200, body: { ok: true, kind: b.kind, id: b.id, rev } };
}

// 列表只给元数据（管理员通道）。正文永不经 HTTP 返回；引擎在服务端用 readContentInternal 读取。
export async function listContent(env: SiteEnv, _url: URL): Promise<R> {
  await ensure(env);
  const rs = await env.DB.prepare("SELECT kind, id, MAX(rev) AS rev, LENGTH(body) AS bytes FROM adventure_content GROUP BY kind, id ORDER BY kind, id").all();
  return { status: 200, body: { ok: true, items: rs.results } };
}

// 仅服务端内部使用（DM 上下文）。不得把返回值原样放进玩家可见的响应。
export async function readContentInternal(env: SiteEnv, kind: string, id: string): Promise<{ rev: number; content: any } | null> {
  await ensure(env);
  const r = await env.DB.prepare("SELECT rev, body FROM adventure_content WHERE kind=? AND id=? ORDER BY rev DESC LIMIT 1").bind(kind, id).first<{ rev: number; body: string }>();
  return r ? { rev: r.rev, content: JSON.parse(r.body) } : null;
}
