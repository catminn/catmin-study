// 私有故事内容库：只有登录后才能读写，内容存在网站自己的 D1 里，不进 GitHub、不进共享记忆。
// 引擎目前不读取内容（沙盒用占位）；这里只提供安全的导入/读取通道，内容字段由 ChatGPT 的内容规格定义。
import type { SiteEnv } from "./site";
import { validateCoursePacks } from "./learning-adapter";

export const CONTENT_KINDS = ["world", "npc", "event", "knowledge-link", "scene", "course", "dungeon"] as const;
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

// 副本（原版主神空间格式）：{subject,after?,dungeon:{id,name,tint,st,desc,pre,cast,recap,zero,clear,fork,mission,rule,pen,hidden,ch:[{t,k,s,sb,tn,skill?,practice?}]}}
export const DUNGEON_SUBJECTS = ["math", "chem", "engri", "engl", "phys", "cs"];
export function validateDungeon(c: any): string | null {
  const d = c && c.dungeon;
  if (!c || !DUNGEON_SUBJECTS.includes(c.subject) || !d || typeof d !== "object") return "需要 subject（math/chem/engri/engl/phys/cs）和 dungeon 对象";
  for (const f of ["id", "name", "desc", "mission", "rule", "pen", "hidden"]) if (typeof d[f] !== "string" || !d[f]) return `dungeon.${f} 需为非空字符串`;
  const f = d.fork; if (!f || typeof f.t !== "string" || typeof f.q !== "string" || typeof f.b !== "string" || !Number.isInteger(f.ch) || typeof f.price !== "number") return "dungeon.fork 需为 {ch,t,q,b,price}";
  if (!Array.isArray(d.ch) || d.ch.length < 1 || d.ch.length > 12) return "dungeon.ch 需为 1–12 章";
  for (const ch of d.ch) {
    if (!ch || typeof ch.t !== "string" || typeof ch.k !== "string" || typeof ch.s !== "string" || typeof ch.sb !== "string" || typeof ch.tn !== "string") return "每章需要 t,k,s,sb,tn（字符串）";
    if (ch.skill !== undefined && (typeof ch.skill?.name !== "string" || typeof ch.skill?.effect !== "string")) return "skill 需为 {name,effect}";
    if (ch.practice !== undefined && (!Array.isArray(ch.practice) || ch.practice.length > 8 || ch.practice.some((q: any) => typeof q?.q !== "string" || !(typeof q?.a === "string" || (Array.isArray(q?.a) && q.a.length && q.a.every((x: any) => typeof x === "string"))) || (q.id !== undefined && !/^[a-z0-9][a-z0-9_.-]{0,40}$/.test(q.id))))) return "practice 需为 [{id?,q,a(字符串或数组),hint?}]";
  }
  return null;
}
// 登录后给前端的副本列表：练习题答案只留在服务端。
export async function listDungeons(env: SiteEnv): Promise<R> {
  await ensure(env);
  const rs = await env.DB.prepare("SELECT c.id AS id, c.body AS body FROM adventure_content c JOIN (SELECT id, MAX(rev) AS r FROM adventure_content WHERE kind='dungeon' GROUP BY id) m ON c.kind='dungeon' AND c.id=m.id AND c.rev=m.r ORDER BY c.id").all<{ id: string; body: string }>();
  const out: any[] = [];
  for (const r of rs.results ?? []) {
    const c = JSON.parse(r.body);
    if (validateDungeon(c)) continue;
    for (const ch of c.dungeon.ch) if (ch.practice) ch.practice = ch.practice.map((q: any, i: number) => ({ id: q.id ?? "c" + (i + 1), q: q.q, hint: q.hint }));
    out.push({ subject: c.subject, after: c.after ?? null, dungeon: c.dungeon });
  }
  return { status: 200, body: { ok: true, dungeons: out } };
}

export async function putContent(env: SiteEnv, b: any): Promise<R> {
  await ensure(env);
  if (!b || typeof b !== "object") return bad(400, "bad_request", "需要 JSON");
  if (!(CONTENT_KINDS as readonly string[]).includes(b.kind)) return bad(400, "bad_kind", `kind 只能是 ${CONTENT_KINDS.join("/")}`);
  if (!idOk(b.kind, b.id)) return bad(400, "bad_id", "id 需为小写字母/数字/._-（世界内容可用 worldId:localId）");
  if (b.content === undefined || b.content === null || typeof b.content !== "object") return bad(400, "bad_content", "content 需为 JSON 对象");
  if (b.kind === "dungeon") { const e = validateDungeon(b.content); if (e) return bad(400, "bad_dungeon", e); if (b.id.includes(":")) return bad(400, "bad_id", "副本 id 不带冒号"); }
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


// ---- 服务端核验：只有具体 dungeon+章+题 的答案校验通过才记 verified；全章通过才持久解锁技能 ----
let pready = false;
async function ensureProg(env: SiteEnv) {
  if (pready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS dungeon_progress (dungeon TEXT NOT NULL, ch INTEGER NOT NULL, challenge TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, verified_at TEXT, PRIMARY KEY (dungeon,ch,challenge))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS dungeon_skills (dungeon TEXT NOT NULL, ch INTEGER NOT NULL, skill TEXT NOT NULL, effect TEXT NOT NULL, unlocked_at TEXT NOT NULL, PRIMARY KEY (dungeon,ch))").run();
  pready = true;
}
const norm = (x: string) => x.normalize("NFKC").toLowerCase().replace(/\s+/g, "").replace(/[，。,.;；]+$/g, "");
export function answerMatches(given: string, key: string | string[]): boolean {
  const keys = Array.isArray(key) ? key : [key]; const g = norm(String(given));
  return keys.some((k) => { const n = norm(k); if (n === g) return true; const a = Number(g), b = Number(n); return g !== "" && n !== "" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)); });
}
async function findDungeon(env: SiteEnv, did: string) {
  const rs = await env.DB.prepare("SELECT c.body AS body FROM adventure_content c JOIN (SELECT id, MAX(rev) AS r FROM adventure_content WHERE kind='dungeon' GROUP BY id) m ON c.kind='dungeon' AND c.id=m.id AND c.rev=m.r").all<{ body: string }>();
  for (const r of rs.results ?? []) { const c = JSON.parse(r.body); if (!validateDungeon(c) && c.dungeon.id === did) return c.dungeon; }
  return null;
}
export async function checkDungeon(env: SiteEnv, b: any): Promise<R> {
  await ensure(env); await ensureProg(env);
  const did = String(b?.dungeon ?? ""), ci = Number(b?.ch), cid = String(b?.challenge ?? "");
  const d = await findDungeon(env, did); const ch = d?.ch?.[ci];
  if (!d || !ch || !Number.isInteger(ci)) return bad(404, "unknown_chapter", "没有这一章");
  const pr: any[] = ch.practice ?? [];
  const idx = pr.findIndex((q, i) => (q.id ?? "c" + (i + 1)) === cid);
  if (idx < 0) return bad(404, "unknown_challenge", "没有这道题");
  const got = await env.DB.prepare("SELECT verified_at FROM dungeon_progress WHERE dungeon=? AND ch=? AND challenge=?").bind(did, ci, cid).first<{ verified_at: string | null }>();
  const ok = answerMatches(String(b?.answer ?? ""), pr[idx].a);
  const now = new Date().toISOString();
  if (!got) await env.DB.prepare("INSERT INTO dungeon_progress (dungeon,ch,challenge,attempts,verified_at) VALUES (?,?,?,1,?)").bind(did, ci, cid, ok ? now : null).run();
  else if (!got.verified_at) await env.DB.prepare("UPDATE dungeon_progress SET attempts=attempts+1, verified_at=? WHERE dungeon=? AND ch=? AND challenge=?").bind(ok ? now : null, did, ci, cid).run();
  const verified = ok || !!got?.verified_at;
  const rows = (await env.DB.prepare("SELECT challenge FROM dungeon_progress WHERE dungeon=? AND ch=? AND verified_at IS NOT NULL").bind(did, ci).all<{ challenge: string }>()).results ?? [];
  const done = new Set(rows.map((r) => r.challenge));
  const allDone = pr.every((q, i) => done.has(q.id ?? "c" + (i + 1)));
  let skill: any = null;
  if (allDone && ch.skill) {
    await env.DB.prepare("INSERT OR IGNORE INTO dungeon_skills (dungeon,ch,skill,effect,unlocked_at) VALUES (?,?,?,?,?)").bind(did, ci, ch.skill.name, ch.skill.effect, now).run();
    skill = ch.skill;
  }
  return { status: 200, body: { ok: true, correct: ok, verified, hint: ok ? null : (pr[idx].hint ?? null), chapterDone: allDone, skill, next: pr.find((q, i) => !done.has(q.id ?? "c" + (i + 1)))?.id ?? null } };
}
export async function dungeonProgress(env: SiteEnv): Promise<R> {
  await ensure(env); await ensureProg(env);
  const v = (await env.DB.prepare("SELECT dungeon,ch,challenge FROM dungeon_progress WHERE verified_at IS NOT NULL").all()).results ?? [];
  const sk = (await env.DB.prepare("SELECT dungeon,ch,skill,effect FROM dungeon_skills").all()).results ?? [];
  return { status: 200, body: { ok: true, verified: v, skills: sk } };
}
