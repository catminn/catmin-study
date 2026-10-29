// 私有故事内容库：只有登录后才能读写，内容存在网站自己的 D1 里，不进 GitHub、不进共享记忆。
// 引擎目前不读取内容（沙盒用占位）；这里只提供安全的导入/读取通道，内容字段由 ChatGPT 的内容规格定义。
import type { SiteEnv } from "./site";
import { validateCoursePacks } from "./learning-adapter";
import { answerMatches } from "./answer";
import { reviewPreflight, recordDigest, provenanceOk } from "./review";

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
// 公开文案命名空间（dungeon-public-copy-v1）：只接受已列出的键；每条 1–1200 个字符；无控制字符、无导演占位符。
function pubErr(p: any, keys: string[]): string | null {
  if (p === undefined) return null;
  if (!p || typeof p !== "object" || Array.isArray(p)) return "pub 需为对象";
  for (const k of Object.keys(p)) {
    if (!keys.includes(k)) return "未知键 " + k;
    const v = p[k];
    if (typeof v !== "string") return k + " 需为字符串";
    const n = [...v].length;
    if (n < 1 || n > 1200 || /[\u0000-\u001f\u007f]/.test(v) || v.includes("⟦DG:")) return k + " 不合规";
  }
  return null;
}
export type DungeonGrants = { dungeonId?: string; zeroUnlocked?: boolean; hiddenUnlocked?: boolean };
export function validateDungeon(c: any): string | null {
  const d = c && c.dungeon;
  if (!c || !DUNGEON_SUBJECTS.includes(c.subject) || !d || typeof d !== "object") return "需要 subject（math/chem/engri/engl/phys/cs）和 dungeon 对象";
  for (const f of ["id", "name", "desc", "mission", "rule", "pen", "hidden"]) if (typeof d[f] !== "string" || !d[f]) return `dungeon.${f} 需为非空字符串`;
  const f = d.fork; if (!f || typeof f.t !== "string" || typeof f.q !== "string" || typeof f.b !== "string" || !Number.isInteger(f.ch) || typeof f.price !== "number") return "dungeon.fork 需为 {ch,t,q,b,price}";
  if (!Array.isArray(d.ch) || d.ch.length < 1 || d.ch.length > 12) return "dungeon.ch 需为 1–12 章";
  if (!castOk(d)) return "dungeon.cast 需为 [[名字,公开身份,导演秘密,揭示章索引(0基)],…]";
  const pe = pubErr(d.pub, ["open", "clear", "zero", "hidden"]); if (pe) return "dungeon.pub：" + pe;
  for (const ch of d.ch) {
    if (ch && ch.pub !== undefined) { const e = pubErr(ch.pub, ["intro", "recap"]); if (e) return "ch.pub：" + e; }
    if (!ch || typeof ch.t !== "string" || typeof ch.k !== "string" || typeof ch.s !== "string" || typeof ch.sb !== "string" || typeof ch.tn !== "string") return "每章需要 t,k,s,sb,tn（字符串）";
    if (ch.skill !== undefined && (typeof ch.skill?.name !== "string" || typeof ch.skill?.effect !== "string")) return "skill 需为 {name,effect}";
    if (ch.practice !== undefined && (!Array.isArray(ch.practice) || ch.practice.length > 8 || ch.practice.some((q: any) => typeof q?.q !== "string" || !(typeof q?.a === "string" || (Array.isArray(q?.a) && q.a.length && q.a.every((x: any) => typeof x === "string"))) || (q.id !== undefined && !/^[a-z0-9][a-z0-9_.-]{0,40}$/.test(q.id))))) return "practice 需为 [{id?,q,a(字符串或数组),hint?}]";
  }
  return null;
}
// 白名单投影（content/contracts/dungeon-client-projection-v1）：浏览器永远收不到导演字段。
// pre/recap/zero/clear/hidden、ch[].s/sb/tn、cast[i][2]、fork.b、practice[].a/hint 一律不下发；
// 未到达章节只给标题 t；cast 只给已揭示（revealChapter<=当前章）角色的名字与公开身份。
// 导演内容只在服务端经 expandDungeonMarkers 注入模型提示词。
export function dungeonReach(d: any, verified: Set<string>): { reach: number; visible: number; current: number; allDone: boolean } {
  const chDone = (ch: any, ci: number) => { const pr: any[] = ch.practice ?? []; return pr.every((q, i) => verified.has(ci + "|" + (q.id ?? "c" + (i + 1)))); };
  let reach = 0;
  while (reach < d.ch.length && chDone(d.ch[reach], reach)) reach++;
  const visible = Math.min(reach + 1, d.ch.length);
  return { reach, visible, current: visible - 1, allDone: reach >= d.ch.length };
}
export function castOk(d: any): boolean {
  return d.cast === undefined || (Array.isArray(d.cast) && d.cast.every((x: any) => Array.isArray(x) && x.length === 4 && typeof x[0] === "string" && typeof x[1] === "string" && typeof x[2] === "string" && Number.isInteger(x[3]) && x[3] >= 0 && x[3] < d.ch.length));
}
export function projectDungeon(d: any, verified: Set<string>, grants: DungeonGrants = {}): any {
  if (!castOk(d)) throw new Error("invalid_cast");
  if (pubErr(d.pub, ["open", "clear", "zero", "hidden"]) || d.ch.some((x: any) => pubErr(x.pub, ["intro", "recap"]))) throw new Error("invalid_pub");
  const { visible, current, allDone } = dungeonReach(d, verified);
  const chDone = (x: any, ci: number) => ((x.practice ?? []) as any[]).every((q, i) => verified.has(ci + "|" + (q.id ?? "c" + (i + 1))));
  const ch = d.ch.map((x: any, i: number) => i >= visible ? { t: x.t, k: "", s: "", sb: "", tn: "", pub: {} } : {
    t: x.t, k: x.k, s: "", sb: "", tn: "",
    pub: { ...(x.pub?.intro !== undefined ? { intro: x.pub.intro } : {}), ...(x.pub?.recap !== undefined && chDone(x, i) ? { recap: x.pub.recap } : {}) },
    ...(x.practice ? { practice: x.practice.map((q: any, j: number) => ({ id: q.id ?? "c" + (j + 1), q: q.q })) } : {}),
    ...(x.skill ? { skill: { ...(x.skill.id !== undefined ? { id: x.skill.id } : {}), name: x.skill.name, effect: x.skill.effect } } : {}),
  });
  const cast = (d.cast ?? []).filter((x: any) => x[3] <= current).map((x: any) => [x[0], x[1], null, x[3]]);
  const f = d.fork;
  const fork = f ? { ch: f.ch, price: f.price, t: f.ch <= current ? f.t : "", q: f.ch <= current ? f.q : "", b: "" } : f;
  const own = grants?.dungeonId === d.id; // 授权按副本作用域：别的副本的授权无效
  const pub = Object.fromEntries(Object.entries(d.pub ?? {}).filter(([k]) => k === "open" || (k === "clear" && allDone) || (k === "zero" && allDone && own && grants.zeroUnlocked === true) || (k === "hidden" && own && grants.hiddenUnlocked === true)));
  return { id: d.id, name: d.name, tint: d.tint, st: d.st, desc: d.desc, mission: d.mission, rule: d.rule, pen: d.pen, pre: "", recap: "", zero: "", clear: "", hidden: "", pub, cast, fork, ch };
}
// 服务端展开模型提示词里的导演占位符（只对 user 消息；只展开已授权章节；未授权一律展开为空）。
const MARK_RE = /⟦DG:(pre|cast|ahead|recap|s|tn):([a-z0-9][a-z0-9_.-]{0,79})(?::(\d{1,2}))?(?::([ab]))?⟧/g;
export async function expandDungeonMarkers(env: SiteEnv, text: string): Promise<string> {
  if (!text.includes("⟦DG:")) return text;
  await ensure(env); await ensureProg(env);
  const ms = [...text.matchAll(MARK_RE)];
  const cache = new Map<string, { d: any; r: ReturnType<typeof dungeonReach> } | null>();
  const load = async (id: string) => {
    if (cache.has(id)) return cache.get(id)!;
    let out: { d: any; r: ReturnType<typeof dungeonReach> } | null = null;
    const row = await env.DB.prepare("SELECT body FROM adventure_content WHERE kind='dungeon' AND id=? ORDER BY rev DESC LIMIT 1").bind(id).first<{ body: string }>();
    if (row) {
      const c = JSON.parse(row.body);
      if (!validateDungeon(c) && castOk(c.dungeon)) {
        const pv = (await env.DB.prepare("SELECT ch,challenge FROM dungeon_progress WHERE dungeon=? AND verified_at IS NOT NULL").bind(id).all<{ ch: number; challenge: string }>()).results ?? [];
        out = { d: c.dungeon, r: dungeonReach(c.dungeon, new Set(pv.map((x) => x.ch + "|" + x.challenge))) };
      }
    }
    cache.set(id, out); return out;
  };
  let res = text;
  for (const m of ms) {
    const [tok, kind, id, n, br] = m;
    const x = await load(id); let v = "";
    if (x) {
      const ci = n === undefined ? -1 : Number(n);
      const okCh = ci >= 0 && ci < x.d.ch.length && ci < x.r.visible;
      if (kind === "pre") v = x.d.pre ?? "";
      else if (kind === "recap") v = x.r.allDone ? (x.d.recap ?? "") : "";
      else if (kind === "cast" && okCh) v = x.d.cast.filter((c: any) => c[3] <= ci).map((c: any) => c[0] + "（" + c[1] + "；隐藏：" + c[2] + "）").join("；");
      else if (kind === "ahead" && okCh) v = x.d.cast.filter((c: any) => c[3] > ci).map((c: any) => c[0]).join("、");
      else if (kind === "s" && okCh) v = (br === "b" && x.d.ch[ci].sb) ? x.d.ch[ci].sb : x.d.ch[ci].s;
      else if (kind === "tn" && okCh) v = x.d.ch[ci].tn ?? "";
    }
    res = res.split(tok).join(v);
  }
  return res;
}
// 登录后给前端的副本列表：练习题答案只留在服务端；未授权章节不下发。
export async function listDungeons(env: SiteEnv): Promise<R> {
  await ensure(env); await ensureProg(env);
  const rs = await env.DB.prepare("SELECT c.id AS id, c.body AS body FROM adventure_content c JOIN (SELECT id, MAX(rev) AS r FROM adventure_content WHERE kind='dungeon' GROUP BY id) m ON c.kind='dungeon' AND c.id=m.id AND c.rev=m.r ORDER BY c.id").all<{ id: string; body: string }>();
  const pv = (await env.DB.prepare("SELECT dungeon,ch,challenge FROM dungeon_progress WHERE verified_at IS NOT NULL").all<{ dungeon: string; ch: number; challenge: string }>()).results ?? [];
  const gr = (await env.DB.prepare("SELECT dungeon,grant_name FROM dungeon_grants").all<{ dungeon: string; grant_name: string }>()).results ?? [];
  const out: any[] = [];
  const enforce = await reviewEnforced(env);
  const approved = new Set(((await env.DB.prepare("SELECT record_id,content_digest FROM dungeon_review").all<{ record_id: string; content_digest: string }>()).results ?? []).map((x) => x.record_id + "|" + x.content_digest));
  for (const r of rs.results ?? []) {
    const c = JSON.parse(r.body);
    if (validateDungeon(c)) continue;
    if (enforce && !approved.has(r.id + "|" + (await recordDigest({ kind: "dungeon", id: r.id, content: c })))) continue; // 无匹配审批 → 整个副本 fail closed
    const grants: DungeonGrants = { dungeonId: c.dungeon.id, zeroUnlocked: gr.some((g) => g.dungeon === c.dungeon.id && g.grant_name === "zeroUnlocked"), hiddenUnlocked: gr.some((g) => g.dungeon === c.dungeon.id && g.grant_name === "hiddenUnlocked") };
    const v = new Set(pv.filter((x) => x.dungeon === c.dungeon.id).map((x) => x.ch + "|" + x.challenge));
    try { out.push({ subject: c.subject, after: c.after ?? null, dungeon: projectDungeon(c.dungeon, v, grants) }); } catch { /* 畸形 cast：fail closed */ }
  }
  return { status: 200, body: { ok: true, dungeons: out } };
}

// ---- 公开字段审批侧车（dungeon-public-field-review-v1）----
// enforce 开启后：导入副本必须带通过校验的侧车；GET 只下发有匹配审批的最新版本（缺审批 → 整个副本不出现）。默认关闭，以免旧线上副本在没有作者审批前消失；开启由管理员通道决定。
async function reviewEnforced(env: SiteEnv): Promise<boolean> {
  await ensureProg(env);
  const r = await env.DB.prepare("SELECT v FROM dungeon_review_mode WHERE k='enforce'").first<{ v: string }>();
  return r?.v === "1";
}
export async function setReviewMode(env: SiteEnv, b: any): Promise<R> {
  await ensureProg(env);
  if (typeof b?.enforce !== "boolean") return bad(400, "bad_request", "需要 {enforce:boolean}");
  await env.DB.prepare("INSERT INTO dungeon_review_mode (k,v) VALUES ('enforce',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(b.enforce ? "1" : "0").run();
  return { status: 200, body: { ok: true, enforce: b.enforce } };
}
async function storeReview(env: SiteEnv, id: string, digest: string, prov: { approvedBy: string; approvedAt: string }) {
  await env.DB.prepare("INSERT OR REPLACE INTO dungeon_review (record_id,content_digest,approved_by,approved_at,created_at) VALUES (?,?,?,?,?)").bind(id, digest, prov.approvedBy.trim(), prov.approvedAt, new Date().toISOString()).run();
}
// 给已入库的最新版本补挂侧车（不改正文）。
export async function attachReview(env: SiteEnv, b: any): Promise<R> {
  await ensure(env); await ensureProg(env);
  const id = b?.id;
  if (!idOk("dungeon", id)) return bad(400, "bad_id", "需要副本 id");
  if (!provenanceOk(b?.reviewApproval)) return bad(400, "review_failed", "缺审批归属", ) ;
  const row = await env.DB.prepare("SELECT body FROM adventure_content WHERE kind='dungeon' AND id=? ORDER BY rev DESC LIMIT 1").bind(id).first<{ body: string }>();
  if (!row) return bad(404, "not_found", "没有这个副本");
  const rec = { kind: "dungeon", id, content: JSON.parse(row.body) };
  const codes = await reviewPreflight(rec, b?.reviewSidecar);
  if (codes.length) return { status: 400, body: { ok: false, error: "review_failed", codes } };
  await storeReview(env, id, await recordDigest(rec), b.reviewApproval);
  return { status: 200, body: { ok: true } };
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
  let reviewDigest: string | null = null;
  if (b.kind === "dungeon") { // 侧车只经管理员通道到达；内容里自报的 review 字段不算数
    await ensureProg(env);
    if (b.reviewSidecar !== undefined || (await reviewEnforced(env))) {
      if (!provenanceOk(b.reviewApproval)) return { status: 400, body: { ok: false, error: "review_failed", codes: ["missing_provenance"] } };
      const rec = { kind: "dungeon", id: b.id, content: b.content };
      const codes = await reviewPreflight(rec, b.reviewSidecar);
      if (codes.length) return { status: 400, body: { ok: false, error: "review_failed", codes } };
      reviewDigest = await recordDigest(rec);
    }
  }
  const last = await env.DB.prepare("SELECT rev, body FROM adventure_content WHERE kind=? AND id=? ORDER BY rev DESC LIMIT 1").bind(b.kind, b.id).first<{ rev: number; body: string }>();
  if (last && last.body === body) { if (reviewDigest) await storeReview(env, b.id, reviewDigest, b.reviewApproval); return { status: 200, body: { ok: true, unchanged: true, rev: last.rev } }; }
  const rev = (last?.rev ?? 0) + 1;
  await env.DB.prepare("INSERT INTO adventure_content (kind,id,rev,body,created_at) VALUES (?,?,?,?,?)").bind(b.kind, b.id, rev, body, new Date().toISOString()).run();
  if (reviewDigest) await storeReview(env, b.id, reviewDigest, b.reviewApproval);
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
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS dungeon_grants (dungeon TEXT NOT NULL, grant_name TEXT NOT NULL, granted_at TEXT NOT NULL, PRIMARY KEY (dungeon,grant_name))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS dungeon_triggers (trigger_ref TEXT PRIMARY KEY, world_id TEXT NOT NULL, dungeon_id TEXT NOT NULL, manifest_revision INTEGER NOT NULL, kind TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS dungeon_review (record_id TEXT NOT NULL, content_digest TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (record_id,content_digest))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS dungeon_review_mode (k TEXT PRIMARY KEY, v TEXT NOT NULL)").run();
  await env.DB.prepare("ALTER TABLE dungeon_skills ADD COLUMN skill_id TEXT").run().catch(() => null); // 稳定技能 ID（旧行为空，下面回填为章位置 ID）
  await env.DB.prepare("UPDATE dungeon_skills SET skill_id='ch'||ch WHERE skill_id IS NULL").run();
  for (const c of ["event_id", "trigger_ref", "manifest_revision"]) await env.DB.prepare("ALTER TABLE dungeon_grants ADD COLUMN " + c + " TEXT").run().catch(() => null); // 来源记录（旧行为空）
  pready = true;
}
// 私有触发器注册表（仅管理员通道写入；绝不经 HTTP 返回）：opaque triggerRef → {worldId, dungeonId, manifestRevision, kind}
export async function registerDungeonTrigger(env: SiteEnv, b: any): Promise<R> {
  await ensureProg(env);
  const ref = b?.triggerRef, w = b?.worldId, d = b?.dungeonId, rev = b?.manifestRevision, kind = b?.kind;
  if (typeof ref !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(ref) || typeof w !== "string" || !w || typeof d !== "string" || !d || !Number.isInteger(rev) || rev < 1 || (kind !== "zeroUnlocked" && kind !== "hiddenUnlocked")) return bad(400, "bad_trigger", "触发器注册格式不对");
  const old = await env.DB.prepare("SELECT 1 AS x FROM dungeon_triggers WHERE trigger_ref=?").bind(ref).first();
  if (old) return bad(409, "exists", "触发器已存在（不可覆盖）");
  await env.DB.prepare("INSERT INTO dungeon_triggers (trigger_ref,world_id,dungeon_id,manifest_revision,kind) VALUES (?,?,?,?,?)").bind(ref, w, d, rev, kind).run();
  return { status: 200, body: { ok: true } };
}
// 世界事件日志 → 副本授权。只被世界引擎在“事件已提交（adventure_world_applied 已写入）”之后调用；失败关闭、幂等、按副本+版本隔离。
export async function grantFromWorldEvent(env: SiteEnv, ev: { sid: string; eventKey: string; eventId: string; triggerRef: unknown }): Promise<boolean> {
  if (typeof ev.triggerRef !== "string") return false;
  await ensureProg(env);
  const reg = await env.DB.prepare("SELECT world_id,dungeon_id,manifest_revision,kind FROM dungeon_triggers WHERE trigger_ref=?").bind(ev.triggerRef).first<{ world_id: string; dungeon_id: string; manifest_revision: number; kind: string }>();
  if (!reg) return false;
  const pin = await env.DB.prepare("SELECT world_id,world_rev FROM adventure_world_pin WHERE session_id=?").bind(ev.sid).first<{ world_id: string; world_rev: number }>();
  if (!pin || pin.world_id !== reg.world_id || pin.world_rev !== reg.manifest_revision) return false; // 跨世界/跨版本不授权
  const evidence = await env.DB.prepare("SELECT 1 AS x FROM adventure_world_applied WHERE session_id=? AND event_key=?").bind(ev.sid, ev.eventKey).first();
  if (!evidence) return false; // 没有已提交的事件记录 → 无证据
  const r = await env.DB.prepare("INSERT OR IGNORE INTO dungeon_grants (dungeon,grant_name,granted_at,event_id,trigger_ref,manifest_revision) VALUES (?,?,?,?,?,?)").bind(reg.dungeon_id, reg.kind, new Date().toISOString(), ev.eventId, ev.triggerRef, String(reg.manifest_revision)).run();
  return r.meta.changes === 1;
}
// 服务端内部授权（无 HTTP 入口：客户端声明、模型发言、答题尝试都不是授权）。按副本作用域持久化。
export async function grantDungeon(env: SiteEnv, dungeon: string, grant: "zeroUnlocked" | "hiddenUnlocked"): Promise<void> {
  await ensureProg(env);
  await env.DB.prepare("INSERT OR IGNORE INTO dungeon_grants (dungeon,grant_name,granted_at) VALUES (?,?,?)").bind(dungeon, grant, new Date().toISOString()).run();
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
  if (ci > 0) { // 前面各章必须已全部核验通过（防止绕过阶段授权直接猜后章答案）
    const vr = (await env.DB.prepare("SELECT ch,challenge FROM dungeon_progress WHERE dungeon=? AND verified_at IS NOT NULL").bind(did).all<{ ch: number; challenge: string }>()).results ?? [];
    const vs = new Set(vr.map((x) => x.ch + "|" + x.challenge));
    for (let k = 0; k < ci; k++) if (!((d.ch[k].practice ?? []) as any[]).every((q, i) => vs.has(k + "|" + (q.id ?? "c" + (i + 1))))) return bad(409, "chapter_locked", "前面的章节还没通过");
  }
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
    await env.DB.prepare("INSERT OR IGNORE INTO dungeon_skills (dungeon,ch,skill,effect,unlocked_at,skill_id) VALUES (?,?,?,?,?,?)").bind(did, ci, ch.skill.name, ch.skill.effect, now, typeof ch.skill.id === "string" && ch.skill.id ? ch.skill.id : "ch" + ci).run();
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
// 服务端内部：某副本已持久解锁的技能 ID（供 4c actionKey 适配器使用；绝不经 HTTP 返回）
export async function unlockedSkillIds(env: SiteEnv, dungeon: string): Promise<string[]> {
  await ensureProg(env);
  return ((await env.DB.prepare("SELECT COALESCE(skill_id,'ch'||ch) AS skill_id FROM dungeon_skills WHERE dungeon=? ORDER BY ch").bind(dungeon).all<{ skill_id: string }>()).results ?? []).map((r) => r.skill_id);
}
