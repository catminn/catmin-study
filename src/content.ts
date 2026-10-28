// 私有故事内容库：只有登录后才能读写，内容存在网站自己的 D1 里，不进 GitHub、不进共享记忆。
// 引擎目前不读取内容（沙盒用占位）；这里只提供安全的导入/读取通道，内容字段由 ChatGPT 的内容规格定义。
import type { SiteEnv } from "./site";
import { validateCoursePacks } from "./learning-adapter";

export const CONTENT_KINDS = ["world", "npc", "event", "knowledge-link", "scene", "course"] as const;
const ID_RE = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
// 多世界命名空间（world-bible-ref-contract-v1）：世界内容的存储 id 为 <worldId>:<localId>；无前缀的是旧版（单世界）内容。课程包是跨世界共享库，只能用无前缀 id。
export const WORLD_ID_RE = /^[a-z][a-z0-9_-]{1,63}$/;
export const LOCAL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const idOk = (kind: string, id: unknown): boolean => {
  if (typeof id !== "string") return false;
  const i = id.indexOf(":");
  if (i < 0) return ID_RE.test(id);
  return kind !== "course" && i === id.lastIndexOf(":") && WORLD_ID_RE.test(id.slice(0, i)) && LOCAL_ID_RE.test(id.slice(i + 1));
};
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
  if (!idOk(b.kind, b.id)) return bad(400, "bad_id", "id 需为小写字母/数字/._-（世界内容可用 worldId:localId）");
  if (b.content === undefined || b.content === null || typeof b.content !== "object") return bad(400, "bad_content", "content 需为 JSON 对象");
  if (b.kind === "course") { // 课程包：结构必须合法（跨包前置概念引用在运行时整体校验，这里不拦）
    const errs = validateCoursePacks([b.content]).filter((e) => e !== "missing_prerequisite");
    if (errs.length || b.content.id !== b.id) return bad(400, "bad_course_pack", "课程包结构不合法或 content.id 与 id 不一致");
  }
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
export async function readContentInternal(env: SiteEnv, kind: string, id: string, rev?: number): Promise<{ rev: number; content: any } | null> {
  await ensure(env);
  const r = rev === undefined
    ? await env.DB.prepare("SELECT rev, body FROM adventure_content WHERE kind=? AND id=? ORDER BY rev DESC LIMIT 1").bind(kind, id).first<{ rev: number; body: string }>()
    : await env.DB.prepare("SELECT rev, body FROM adventure_content WHERE kind=? AND id=? AND rev=?").bind(kind, id, rev).first<{ rev: number; body: string }>();
  return r ? { rev: r.rev, content: JSON.parse(r.body) } : null;
}

// 只读比对（管理员）：把一个内容包与线上最新修订逐条比较，只返回计数，不写入、不返回正文或 id。
export async function compareContent(env: SiteEnv, b: any): Promise<R> {
  await ensure(env);
  const recs = b && Array.isArray(b.records) ? b.records : null;
  if (!recs || recs.length > 2000) return bad(400, "bad_request", "需要 {records:[{kind,id,content}]}");
  let identical = 0, different = 0, missing = 0, invalid = 0;
  const kinds = new Set<string>(), prefixes = new Set<string>(), seen = new Set<string>();
  for (const r of recs) {
    if (!r || !(CONTENT_KINDS as readonly string[]).includes(r.kind) || !idOk(r.kind, r.id) || !r.content || typeof r.content !== "object") { invalid++; continue; }
    kinds.add(r.kind); prefixes.add(r.id.includes(":") ? r.id.slice(0, r.id.indexOf(":")) : ""); seen.add(r.kind + " " + r.id);
    const last = await env.DB.prepare("SELECT body FROM adventure_content WHERE kind=? AND id=? ORDER BY rev DESC LIMIT 1").bind(r.kind, r.id).first<{ body: string }>();
    if (!last) missing++; else if (last.body === JSON.stringify(r.content)) identical++; else different++;
  }
  // 线上同命名空间、同类、但不在包里的记录数（导入不会删除它们）
  let onlineNotInBundle = 0;
  for (const k of kinds) for (const pre of prefixes) {
    const rs = await env.DB.prepare(pre ? "SELECT DISTINCT id FROM adventure_content WHERE kind=? AND id LIKE ?" : "SELECT DISTINCT id FROM adventure_content WHERE kind=? AND id NOT LIKE '%:%'").bind(...(pre ? [k, pre + ":%"] : [k])).all<{ id: string }>();
    for (const x of rs.results ?? []) if (!seen.has(k + " " + x.id)) onlineNotInBundle++;
  }
  return { status: 200, body: { ok: true, records: recs.length, identical, different, missing, invalid, onlineNotInBundle } };
}
