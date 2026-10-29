// 世界事件引擎 v0（服务端是唯一的世界变化确认方）。
// 读取私有内容包（world/scene/npc/event），只在服务端使用；对玩家只返回事件内容里写明的 publicOutcome，不返回 id、effects、条件。
// 契约：content/contracts/world-content-semantics-v1.md（ChatGPT 设计分支）。
import { readContentInternal, grantFromWorldEvent } from "./content";
import type { SiteEnv } from "./site";
import { ACTION_ALIASES } from "./adventure";

export const WORLD_CONFIG = { version: "world-1.2.0", maxChain: 4, endingConfirmTtlSec: 600, npcMemoryLayers: new Set(["heardClaims", "npcBeliefs", "confirmedNpcKnowledge"]), allowedEffects: new Set(["set_flag", "lock_flag", "advance_scene", "set_npc_location", "change_npc_relation", "record_fact_discovery", "grant_item", "remove_item", "record_npc_memory"]) };

let ready: Promise<unknown> | null = null;
function ensure(env: SiteEnv) {
  return (ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world (session_id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, version INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_flags (session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (session_id,key))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_npc (session_id TEXT NOT NULL, npc_id TEXT NOT NULL, location TEXT, relation TEXT, PRIMARY KEY (session_id,npc_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_facts (session_id TEXT NOT NULL, fact_id TEXT NOT NULL, PRIMARY KEY (session_id,fact_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_items (session_id TEXT NOT NULL, item_id TEXT NOT NULL, PRIMARY KEY (session_id,item_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_npc_memory (session_id TEXT NOT NULL, npc_id TEXT NOT NULL, layer TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY (session_id,npc_id,layer,item))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_rel_history (session_id TEXT NOT NULL, npc_id TEXT NOT NULL, n INTEGER NOT NULL, relation TEXT NOT NULL, PRIMARY KEY (session_id,npc_id,n))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_commits (session_id TEXT NOT NULL, commit_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (session_id,commit_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_ending_notice (session_id TEXT NOT NULL, target TEXT NOT NULL, ending_id TEXT NOT NULL, world_version INTEGER NOT NULL, shown_at REAL NOT NULL, PRIMARY KEY (session_id,target))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_ending_snapshot (session_id TEXT PRIMARY KEY, ending_commit_id TEXT NOT NULL, snapshot TEXT NOT NULL, created_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_threads (session_id TEXT NOT NULL, thread_id TEXT NOT NULL, audience TEXT NOT NULL, carryover TEXT NOT NULL, status TEXT NOT NULL, opened_by TEXT NOT NULL, resolved_by TEXT, PRIMARY KEY (session_id,thread_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_fact_src (session_id TEXT NOT NULL, fact_id TEXT NOT NULL, source_ref TEXT NOT NULL, scene_id TEXT NOT NULL, PRIMARY KEY (session_id,fact_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_pin (session_id TEXT PRIMARY KEY, world_id TEXT NOT NULL, world_rev INTEGER NOT NULL, ns INTEGER NOT NULL DEFAULT 0)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_pin_rev (session_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY (session_id,kind,id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_applied (session_id TEXT NOT NULL, event_key TEXT NOT NULL, action_id TEXT NOT NULL, public_outcome TEXT, PRIMARY KEY (session_id,event_key))`),
  ]).then(async (r) => { await env.DB.prepare("ALTER TABLE adventure_world_pin ADD COLUMN ns INTEGER NOT NULL DEFAULT 0").run().catch(() => null); return r; }).catch((e) => { ready = null; throw e; }));
}

export type PublicEvent = { publicOutcome: string };
type St = { scene: string; version: number };

// 世界选择与内容读取（world-bible-ref-contract-v1）：
// 会话固定 worldId + 当时各内容的修订（adventure_world_pin / adventure_world_pin_rev）。命名空间世界（ns=1）的存储 id 为 <worldId>:<localId>，
// 其内容读取只看本会话固定的修订，没有固定的对象视为不存在（绝不读 latest、绝不回落到别的世界）；
// 旧版单世界内容（ns=0，无前缀 id）保持原行为：固定的修订优先，固定之后才新增的对象仍按最新读取。
// 状态表里的场景/NPC/事件 id 一律是世界内的 localId；内容里写 <worldId>:<localId> 时必须是本世界，别的世界前缀一律当作不存在。
type Pin = { id: string; rev: number; ns: number };
const WORLD_RECORD = "world"; // 命名空间世界的世界记录 localId：<worldId>:world
const PIN_KINDS = ["world", "scene", "npc", "event", "knowledge-link"];
async function listWorlds(env: SiteEnv): Promise<Pin[]> {
  const rs = await env.DB.prepare("SELECT id, MAX(rev) AS rev FROM adventure_content WHERE kind='world' GROUP BY id").all<{ id: string; rev: number }>().catch(() => ({ results: [] as { id: string; rev: number }[] }));
  const out: Pin[] = [];
  for (const r of rs.results) {
    if (!r.id.includes(":")) out.push({ id: r.id, rev: r.rev, ns: 0 });
    else if (r.id.endsWith(":" + WORLD_RECORD)) out.push({ id: r.id.slice(0, r.id.indexOf(":")), rev: r.rev, ns: 1 });
  }
  return out;
}
// 同一个 worldId 可能同时有旧版（无前缀）和命名空间版两条世界记录（作者给旧世界记录起了同名 id）：
// 显式选择/默认世界时优先命名空间版；旧存档靠各自的固定记录，不受影响。
function pickById(all: Pin[], id: string): Pin | null {
  const m = all.filter((w) => w.id === id);
  if (m.length === 1) return m[0];
  const ns = m.filter((w) => w.ns);
  return ns.length === 1 && m.length === 2 ? ns[0] : null;
}
async function chooseWorld(env: SiteEnv, requested?: string): Promise<Pin | null> {
  const all = await listWorlds(env);
  if (requested !== undefined) { return pickById(all, requested); }
  if (all.length === 1) return all[0];
  // 世界不唯一：只有管理员显式设置了默认世界时，新会话才固定到它；否则失败关闭
  const d = await env.DB.prepare("SELECT value FROM adventure_world_config WHERE key='defaultWorldId'").first<{ value: string }>().catch(() => null);
  return d ? pickById(all, d.value) : null;
}
const sstore = (pin: Pin, local: string) => (pin.ns ? pin.id + ":" + local : local);
async function writePin(env: SiteEnv, sid: string, w: Pin): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_pin (session_id,world_id,world_rev,ns) VALUES (?,?,?,?)").bind(sid, w.id, w.rev, w.ns).run();
  const pref = w.ns ? w.id + ":%" : null;
  const rs = await (pref
    ? env.DB.prepare(`SELECT kind, id, MAX(rev) AS rev FROM adventure_content WHERE kind IN (${PIN_KINDS.map(() => "?").join(",")}) AND id LIKE ? GROUP BY kind, id`).bind(...PIN_KINDS, pref)
    : env.DB.prepare(`SELECT kind, id, MAX(rev) AS rev FROM adventure_content WHERE kind IN (${PIN_KINDS.map(() => "?").join(",")}) AND id NOT LIKE '%:%' GROUP BY kind, id`).bind(...PIN_KINDS)
  ).all<{ kind: string; id: string; rev: number }>();
  for (const r of rs.results ?? []) await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_pin_rev (session_id,kind,id,rev) VALUES (?,?,?,?)").bind(sid, r.kind, r.id, r.rev).run();
}
async function pinFor(env: SiteEnv, sid: string): Promise<Pin | null> {
  const r = await env.DB.prepare("SELECT world_id AS id, world_rev AS rev, ns FROM adventure_world_pin WHERE session_id=?").bind(sid).first<Pin>();
  if (r) {
    // 旧版固定记录（只有世界修订、没有逐对象修订）：补记一次当时的逐对象修订，之后同样冻结
    if (!(await env.DB.prepare("SELECT 1 FROM adventure_world_pin_rev WHERE session_id=? LIMIT 1").bind(sid).first())) await writePin(env, sid, r);
    return r;
  }
  // 已有世界状态但没有固定记录 = 旧存档：只能固定到唯一的旧版世界，绝不套用默认的新世界
  const hasState = await env.DB.prepare("SELECT 1 FROM adventure_world WHERE session_id=?").bind(sid).first();
  const u = hasState ? ((l) => (l.length === 1 ? l[0] : null))((await listWorlds(env)).filter((w) => !w.ns)) : await chooseWorld(env); // 旧会话/未显式选择：只有世界唯一时才固定，否则失败关闭
  if (!u) return null;
  await writePin(env, sid, u);
  return (await env.DB.prepare("SELECT world_id AS id, world_rev AS rev, ns FROM adventure_world_pin WHERE session_id=?").bind(sid).first<Pin>()) ?? null;
}
// 会话开始时显式选择世界（可选）：世界不存在/不唯一 → false；已固定的会话不能改（换世界需要显式迁移）。
export async function pinWorldForSession(env: SiteEnv, sid: string, worldId: string): Promise<boolean> {
  await ensure(env);
  const have = await env.DB.prepare("SELECT world_id FROM adventure_world_pin WHERE session_id=?").bind(sid).first<{ world_id: string }>();
  if (have) return have.world_id === worldId;
  const w = await chooseWorld(env, worldId);
  if (!w) return false;
  await writePin(env, sid, w);
  return true;
}
// —— 管理员：新旧世界并存 ——（只返回计数/世界 id，不返回会话 id 或正文）
async function worldSummary(env: SiteEnv) {
  const all = await listWorlds(env);
  const d = await env.DB.prepare("SELECT value FROM adventure_world_config WHERE key='defaultWorldId'").first<{ value: string }>();
  return { worlds: all.map((w) => ({ worldId: w.id, namespaced: !!w.ns, rev: w.rev })), defaultWorldId: d?.value ?? null };
}
export async function getDefaultWorld(env: SiteEnv): Promise<{ status: number; body: unknown }> {
  await ensure(env);
  return { status: 200, body: { ok: true, ...(await worldSummary(env)) } };
}
// 默认世界只影响“之后新开、且没有显式选择世界”的会话；已固定的会话永不改变。null 清除。
export async function setDefaultWorld(env: SiteEnv, b: any): Promise<{ status: number; body: unknown }> {
  await ensure(env);
  if (!b || !("worldId" in b)) return { status: 400, body: { ok: false, error: "bad_request" } };
  if (b.worldId === null) { await env.DB.prepare("DELETE FROM adventure_world_config WHERE key='defaultWorldId'").run(); return getDefaultWorld(env); }
  if (typeof b.worldId !== "string" || !pickById(await listWorlds(env), b.worldId)) return { status: 404, body: { ok: false, error: "unknown_world" } };
  await env.DB.prepare("INSERT INTO adventure_world_config (key,value) VALUES ('defaultWorldId',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(b.worldId).run();
  return getDefaultWorld(env);
}
// 把所有已有世界状态、但还没固定的会话显式固定到唯一的旧版（无前缀）世界，并快照当时修订。需要 {confirm:true}。
// 旧版世界不是恰好 1 个 → 409，什么都不做。已固定的会话不动。幂等。
export async function pinLegacySessions(env: SiteEnv, b: any): Promise<{ status: number; body: unknown }> {
  await ensure(env);
  const legacy = (await listWorlds(env)).filter((w) => !w.ns);
  if (legacy.length !== 1) return { status: 409, body: { ok: false, error: "legacy_world_not_unique", legacyWorlds: legacy.length } };
  const rows = (await env.DB.prepare("SELECT w.session_id AS sid, p.session_id AS pinned FROM adventure_world w LEFT JOIN adventure_world_pin p ON p.session_id=w.session_id").all<{ sid: string; pinned: string | null }>()).results ?? [];
  const todo = rows.filter((r) => !r.pinned);
  if (!b || b.confirm !== true) return { status: 200, body: { ok: true, dryRun: true, sessions: rows.length, alreadyPinned: rows.length - todo.length, wouldPin: todo.length } };
  for (const r of todo) await writePin(env, r.sid, legacy[0]);
  return { status: 200, body: { ok: true, sessions: rows.length, alreadyPinned: rows.length - todo.length, pinned: todo.length } };
}
// 读世界内容（会话固定的世界与修订）。ref 可为 localId 或本世界的 <worldId>:<localId>。
export async function readWorldContent(env: SiteEnv, sid: string, kind: string, ref: unknown): Promise<{ rev: number; content: any } | null> {
  if (typeof ref !== "string") return null;
  const pin = await pinFor(env, sid);
  if (!pin) return null;
  let local = ref;
  const i = ref.indexOf(":");
  if (i >= 0) { if (!pin.ns || ref.slice(0, i) !== pin.id) return null; local = ref.slice(i + 1); }
  const store = sstore(pin, local);
  const pr = await env.DB.prepare("SELECT rev FROM adventure_world_pin_rev WHERE session_id=? AND kind=? AND id=?").bind(sid, kind, store).first<{ rev: number }>();
  if (pr) { const r = await readContentInternal(env, kind, store, pr.rev).catch(() => null); return r && pin.ns ? { rev: r.rev, content: normRefs(r.content, pin.id) } : r; }
  return null; // 未固定的对象视为不存在（新旧世界一致，绝不读 latest）
}
// 内容里的限定引用：本世界的 <worldId>:<localId> 一律还原为 localId（引擎内部比较都用 localId）；
// 别的世界的限定引用替换为不可解析的占位，保证任何比较/查找都落空（失败关闭，不回落）。
const QREF = /^([a-z][a-z0-9_-]{1,63}):([a-z0-9][a-z0-9._-]{0,79})$/;
const FOREIGN = "\u0000foreign-world-ref";
function normRefs(x: any, worldId: string): any {
  if (typeof x === "string") { const m = QREF.exec(x); return m ? (m[1] === worldId ? m[2] : FOREIGN) : x; }
  if (Array.isArray(x)) return x.map((v) => normRefs(v, worldId));
  if (x && typeof x === "object") { const o: any = {}; for (const k of Object.keys(x)) o[typeof normRefs(k, worldId) === "string" ? normRefs(k, worldId) : k] = normRefs(x[k], worldId); return o; }
  return x;
}
const localOf = (pin: Pin, ref: unknown): string | null => {
  if (typeof ref !== "string") return null;
  const i = ref.indexOf(":");
  if (i < 0) return ref;
  return pin.ns && ref.slice(0, i) === pin.id ? ref.slice(i + 1) : null;
};
async function findWorld(env: SiteEnv, sid: string): Promise<any | null> {
  const pin = await pinFor(env, sid);
  if (!pin) return null;
  return (await readContentInternal(env, "world", sstore(pin, pin.ns ? WORLD_RECORD : pin.id), pin.rev).catch(() => null))?.content ?? null;
}

async function flagGet(env: SiteEnv, sid: string, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM adventure_world_flags WHERE session_id=? AND key=?").bind(sid, key).first<{ value: string }>();
  return r ? r.value : null;
}

// 条件：数组=全部满足；{all|any|not}；叶子 {flag, equals?|exists?} {scene} {npcRelation:{npc,band}} {npcLocation:{npc,scene}} {factKnown}。未知叶子一律不满足。
async function evalCond(env: SiteEnv, sid: string, scene: string, c: any): Promise<boolean> {
  if (c === undefined || c === null) return true;
  if (Array.isArray(c)) { for (const x of c) if (!(await evalCond(env, sid, scene, x))) return false; return true; }
  if (typeof c !== "object") return false;
  if ("all" in c) return evalCond(env, sid, scene, c.all);
  if ("any" in c) { for (const x of c.any ?? []) if (await evalCond(env, sid, scene, x)) return true; return false; }
  if ("not" in c) return !(await evalCond(env, sid, scene, c.not));
  if (typeof c.flag === "string") {
    const v = await flagGet(env, sid, c.flag);
    if ("equals" in c) return v === JSON.stringify(c.equals);
    if (c.exists === false) return v === null;
    return v !== null;
  }
  if (typeof c.scene === "string") return scene === c.scene;
  if (c.npcRelation && typeof c.npcRelation === "object") {
    const r = await env.DB.prepare("SELECT relation FROM adventure_world_npc WHERE session_id=? AND npc_id=?").bind(sid, c.npcRelation.npc).first<{ relation: string }>();
    return !!r && r.relation === c.npcRelation.band;
  }
  if (c.npcLocation && typeof c.npcLocation === "object") {
    const r = await env.DB.prepare("SELECT location FROM adventure_world_npc WHERE session_id=? AND npc_id=?").bind(sid, c.npcLocation.npc).first<{ location: string }>();
    return !!r && r.location === c.npcLocation.scene;
  }
  if (typeof c.hasItem === "string") return !!(await env.DB.prepare("SELECT 1 FROM adventure_world_items WHERE session_id=? AND item_id=?").bind(sid, c.hasItem).first());
  if (c.npcMemory && typeof c.npcMemory === "object") return !!(await env.DB.prepare("SELECT 1 FROM adventure_world_npc_memory WHERE session_id=? AND npc_id=? AND layer=? AND item=?").bind(sid, String(c.npcMemory.npc), String(c.npcMemory.layer), String(c.npcMemory.item)).first());
  if (typeof c.factKnown === "string") return !!(await env.DB.prepare("SELECT 1 FROM adventure_world_facts WHERE session_id=? AND fact_id=?").bind(sid, c.factKnown).first());
  return false;
}

async function sceneContent(env: SiteEnv, sid: string, id: string) { return (await readWorldContent(env, sid, "scene", id))?.content ?? null; }

// 结局同意契约（world-content-semantics-v1）：scene.ending={id,costNotice}；scene.entryRequirements=条件。
// 所有进入场景的入口（travel / advance_scene）都先过 entryRequirements；进入结局场景只能经 travel，且必须先展示 costNotice、再单独确认。
const endingOf = (sc: any): { id: string; costNotice: string } | null => {
  const e = sc?.ending;
  return e && typeof e === "object" && strOk(e.id) && typeof e.costNotice === "string" && e.costNotice.trim() ? { id: e.id, costNotice: e.costNotice } : null;
};
async function entryOk(env: SiteEnv, sid: string, from: string, dest: any): Promise<boolean> {
  if (dest?.entryRequirements === undefined) return true;
  return evalCond(env, sid, from, dest.entryRequirements);
}
export async function pendingEndingNotice(env: SiteEnv, sid: string, now = Date.now() / 1000): Promise<string | null> {
  await ensure(env);
  const st = await ensureState(env, sid);
  if (!st) return null;
  const r = await env.DB.prepare("SELECT target FROM adventure_world_ending_notice WHERE session_id=? AND world_version=? AND shown_at>=? ORDER BY shown_at DESC LIMIT 1").bind(sid, st.version, now - WORLD_CONFIG.endingConfirmTtlSec).first<{ target: string }>();
  return r?.target ?? null;
}

// 事件缓存（单次请求内）
async function allEvents(env: SiteEnv, sid: string): Promise<{ id: string; c: any }[]> {
  const pin = await pinFor(env, sid);
  if (!pin) return [];
  let ids = ((await env.DB.prepare("SELECT id FROM adventure_world_pin_rev WHERE session_id=? AND kind='event' ORDER BY id").bind(sid).all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }))).results ?? []).map((r) => r.id);
  const out: { id: string; c: any }[] = [];
  for (const store of ids) { const local = pin.ns ? store.slice(pin.id.length + 1) : store; const e = await readWorldContent(env, sid, "event", local); if (e) out.push({ id: local, c: e.content }); }
  return out;
}

async function ensureState(env: SiteEnv, sid: string): Promise<St | null> {
  await ensure(env);
  const r = await env.DB.prepare("SELECT scene_id, version FROM adventure_world WHERE session_id=?").bind(sid).first<{ scene_id: string; version: number }>();
  if (r) return { scene: r.scene_id, version: r.version };
  const w = await findWorld(env, sid);
  const pinW = await pinFor(env, sid);
  const start = w && pinW ? localOf(pinW, typeof w.startSceneId === "string" ? w.startSceneId : w.startSceneRef) : null;
  if (!start || !(await sceneContent(env, sid, start))) return null; // 没有世界或没有合法起点：引擎不介入
  await env.DB.prepare("INSERT OR IGNORE INTO adventure_world (session_id,scene_id,version) VALUES (?,?,0)").bind(sid, start).run();
  return { scene: start, version: 0 };
}

// publicOutcome：字符串，或 {text, ...授权元数据}（元数据只留在服务端，玩家只拿到 text）。
function publicText(c: any): string | null {
  const p = c?.publicOutcome;
  if (typeof p === "string") return p.trim() ? p : null;
  if (p && typeof p === "object" && typeof p.text === "string" && p.text.trim()) return p.text;
  return null;
}

type Pending = { type: string; scene: string; success?: boolean; actionTemplate?: string; factId?: string; choiceId?: string; npcId?: string; flagKey?: string; prev?: unknown; next?: unknown };

const strOk = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length <= 200;

// 未解线索（world-content-semantics-v1「Unresolved thread authoring and carryover」）：
// 声明 {id, authorizedAudience: player|server_private, carryover: eligible|local_only}；只在已提交的场景进入/事件提交时开启，resolvesThreads 只在事件提交时关闭。
// 已关闭的线索不会因重访/重放而重开；结构非法、冲突（受众或携带策略与已有记录不同）、关闭从未开启的线索 → 整条事件拒绝 / 场景声明整体忽略（失败关闭）。
export type ThreadDecl = { id: string; authorizedAudience: "player" | "server_private"; carryover: "eligible" | "local_only" };
export function parseThreadDecls(x: unknown): ThreadDecl[] | null {
  if (x === undefined) return [];
  if (!Array.isArray(x)) return null;
  const seen = new Set<string>(), out: ThreadDecl[] = [];
  for (const d of x) {
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const keys = Object.keys(d);
    if (keys.length !== 3 || !["id", "authorizedAudience", "carryover"].every((k) => keys.includes(k))) return null;
    if (!idOk((d as any).id) || !["player", "server_private"].includes((d as any).authorizedAudience) || !["eligible", "local_only"].includes((d as any).carryover) || seen.has((d as any).id)) return null;
    seen.add((d as any).id); out.push({ id: (d as any).id, authorizedAudience: (d as any).authorizedAudience, carryover: (d as any).carryover });
  }
  return out;
}
export function parseThreadResolves(x: unknown): string[] | null {
  if (x === undefined) return [];
  if (!Array.isArray(x) || !x.every(idOk) || new Set(x).size !== x.length) return null;
  return x as string[];
}
async function threadRow(env: SiteEnv, sid: string, id: string) {
  return env.DB.prepare("SELECT audience, carryover, status FROM adventure_world_threads WHERE session_id=? AND thread_id=?").bind(sid, id).first<{ audience: string; carryover: string; status: string }>();
}
// 校验线索声明与已有记录不冲突；返回可执行的 ops
async function planThreads(env: SiteEnv, sid: string, open: unknown, resolves: unknown): Promise<any[] | null> {
  const decls = parseThreadDecls(open), res = parseThreadResolves(resolves);
  if (!decls || !res) return null;
  const ops: any[] = [];
  for (const d of decls) {
    if (res.includes(d.id)) return null; // 同一事件既开又关：内容冲突
    const row = await threadRow(env, sid, d.id);
    if (row && (row.audience !== d.authorizedAudience || row.carryover !== d.carryover)) return null;
    ops.push({ type: "__thread_open", ...d });
  }
  for (const id of res) {
    if (!(await threadRow(env, sid, id))) return null; // 不得凭空创造或静默“解决”从未开启的线索
    ops.push({ type: "__thread_resolve", id });
  }
  return ops;
}
async function openSceneThreads(env: SiteEnv, sid: string, sc: any, ref: string): Promise<void> {
  const ops = await planThreads(env, sid, sc?.openThreads, undefined);
  if (!ops) return; // 非法/冲突：整体忽略，不部分开启
  await execThreadOps(env, sid, ops, ref);
}
async function execThreadOps(env: SiteEnv, sid: string, ops: any[], ref: string): Promise<void> {
  for (const o of ops) {
    if (o.type === "__thread_open") await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_threads (session_id,thread_id,audience,carryover,status,opened_by) VALUES (?,?,?,?,'open',?)").bind(sid, o.id, o.authorizedAudience, o.carryover, ref).run();
    else if (o.type === "__thread_resolve") await env.DB.prepare("UPDATE adventure_world_threads SET status='resolved', resolved_by=? WHERE session_id=? AND thread_id=? AND status='open'").bind(ref, sid, o.id).run();
  }
}

// 校验所有 effects（含 revealsFacts），通过才应用；任何一条非法就整条事件拒绝（不部分应用）。
async function planEffects(env: SiteEnv, sid: string, scene: string, effects: any[], reveals: unknown, threads?: { open?: unknown; resolves?: unknown }): Promise<{ ok: true; ops: any[] } | { ok: false }> {
  if (!Array.isArray(effects)) return { ok: false };
  if (reveals !== undefined && (!Array.isArray(reveals) || !reveals.every(strOk))) return { ok: false };
  const sc = await sceneContent(env, sid, scene);
  const locks = new Map<string, string>();
  const held = new Set<string>(), removed = new Set<string>();
  for (const e of effects) {
    if (!e || typeof e !== "object" || !WORLD_CONFIG.allowedEffects.has(e.type) || !strOk(e.target)) return { ok: false };
    if (e.type === "advance_scene") {
      const dest = await sceneContent(env, sid, e.target);
      if (!sc || !Array.isArray(sc.choices) || !sc.choices.includes(e.target) || !dest) return { ok: false };
      if (dest.ending !== undefined) return { ok: false }; // 结局只能经显式确认的 travel 进入
      if (!(await entryOk(env, sid, scene, dest))) return { ok: false };
    }
    if ((e.type === "change_npc_relation" || e.type === "set_flag" || e.type === "lock_flag") && typeof e.value === "object" && e.value !== null) return { ok: false };
    if (e.type === "change_npc_relation" && typeof e.value !== "string") return { ok: false };
    if (e.type === "set_npc_location" && typeof e.value !== "string") return { ok: false };
    if (e.type === "lock_flag") {
      // 一次写入：未设置 → 设置；相同值 → 无操作；不同值 → 整条事件拒绝（结局锁语义）
      const want = JSON.stringify(e.value ?? true);
      const have = locks.get(e.target) ?? (await flagGet(env, sid, e.target));
      if (have !== null && have !== undefined && have !== want) return { ok: false };
      locks.set(e.target, want);
    }
    if (e.type === "remove_item") {
      const has = held.has(e.target) || !!(await env.DB.prepare("SELECT 1 FROM adventure_world_items WHERE session_id=? AND item_id=?").bind(sid, e.target).first());
      if (!has || removed.has(e.target)) return { ok: false };
      removed.add(e.target);
    }
    if (e.type === "grant_item") held.add(e.target);
    if (e.type === "record_npc_memory" && (!WORLD_CONFIG.npcMemoryLayers.has(e.layer) || !strOk(e.value))) return { ok: false };
  }
  const tops = threads ? await planThreads(env, sid, threads.open, threads.resolves) : [];
  if (!tops) return { ok: false };
  return { ok: true, ops: [...effects, ...(Array.isArray(reveals) ? reveals.map((f: string) => ({ type: "record_fact_discovery", target: f })) : []), ...tops] };
}

function matches(tr: any, t: Pending): boolean {
  if (tr.type !== t.type) return false;
  if (tr.sceneId && tr.sceneId !== t.scene) return false; // 触发发生时所在的场景
  if (t.type === "action_resolved") {
    if (tr.outcome && tr.outcome !== (t.success ? "success" : "failure")) return false;
    if (tr.actionTemplateId && (ACTION_ALIASES[tr.actionTemplateId] ?? tr.actionTemplateId) !== t.actionTemplate) return false;
  } else if (t.type === "fact_discovered") {
    if (tr.factId && tr.factId !== t.factId) return false;
  } else if (t.type === "dialogue_choice_committed") {
    if (!tr.choiceId || tr.choiceId !== t.choiceId) return false;
    if (tr.npcId && tr.npcId !== t.npcId) return false;
  } else if (t.type === "world_flag_changed") {
    if (!tr.flagKey || tr.flagKey !== t.flagKey) return false;
    if ("nextValue" in tr && JSON.stringify(tr.nextValue) !== JSON.stringify(t.next)) return false;
  }
  return true;
}

async function execOps(env: SiteEnv, sid: string, st: St, ops: any[], next: Pending[], ref: string): Promise<St> {
  for (const e of ops) {
    if (e.type === "__thread_open" || e.type === "__thread_resolve") { await execThreadOps(env, sid, [e], ref); continue; }
    if (e.type === "set_flag" || e.type === "lock_flag") {
      const nv = JSON.stringify(e.value ?? true);
      const old = await flagGet(env, sid, e.target);
      await env.DB.prepare("INSERT INTO adventure_world_flags (session_id,key,value) VALUES (?,?,?) ON CONFLICT(session_id,key) DO UPDATE SET value=excluded.value").bind(sid, e.target, nv).run();
      if (old !== nv) next.push({ type: "world_flag_changed", scene: st.scene, flagKey: e.target, prev: old === null ? null : JSON.parse(old), next: e.value ?? true });
    }
    else if (e.type === "change_npc_relation") {
      await env.DB.prepare("INSERT INTO adventure_world_npc (session_id,npc_id,relation) VALUES (?,?,?) ON CONFLICT(session_id,npc_id) DO UPDATE SET relation=excluded.relation").bind(sid, e.target, e.value).run();
      await env.DB.prepare("INSERT INTO adventure_world_rel_history (session_id,npc_id,n,relation) SELECT ?,?,COALESCE(MAX(n),0)+1,? FROM adventure_world_rel_history WHERE session_id=? AND npc_id=?").bind(sid, e.target, e.value, sid, e.target).run();
    }
    else if (e.type === "set_npc_location") await env.DB.prepare("INSERT INTO adventure_world_npc (session_id,npc_id,location) VALUES (?,?,?) ON CONFLICT(session_id,npc_id) DO UPDATE SET location=excluded.location").bind(sid, e.target, e.value).run();
    else if (e.type === "record_fact_discovery") {
      const r = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_facts (session_id,fact_id) VALUES (?,?)").bind(sid, e.target).run();
      if (r.meta.changes === 1) {
        // 来源：产生该发现的已提交引用（提交/事件键）与发现时所在场景；只记引用，不记叙述
        await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_fact_src (session_id,fact_id,source_ref,scene_id) VALUES (?,?,?,?)").bind(sid, e.target, ref, st.scene).run();
        next.push({ type: "fact_discovered", scene: st.scene, factId: e.target });
      }
    }
    else if (e.type === "grant_item") await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_items (session_id,item_id) VALUES (?,?)").bind(sid, e.target).run();
    else if (e.type === "remove_item") await env.DB.prepare("DELETE FROM adventure_world_items WHERE session_id=? AND item_id=?").bind(sid, e.target).run();
    else if (e.type === "record_npc_memory") await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_npc_memory (session_id,npc_id,layer,item) VALUES (?,?,?,?)").bind(sid, e.target, e.layer, e.value).run();
    else if (e.type === "advance_scene") st = await enterScene(env, sid, st, e.target, next, ref);
  }
  return st;
}

// 进入场景：提交 + 触发 scene_entered；场景自带的 stateEffects（同一套 effects，非法则整体忽略）在进入时应用一次。
async function enterScene(env: SiteEnv, sid: string, st: St, target: string, next: Pending[], ref: string): Promise<St> {
  st = { scene: target, version: st.version + 1 };
  await env.DB.prepare("UPDATE adventure_world SET scene_id=?, version=? WHERE session_id=?").bind(st.scene, st.version, sid).run();
  next.push({ type: "scene_entered", scene: st.scene });
  const sc = await sceneContent(env, sid, target);
  await openSceneThreads(env, sid, sc, ref); // 已提交的场景进入才开启线索
  if (sc && Array.isArray(sc.stateEffects) && sc.stateEffects.length) {
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,NULL)").bind(sid, "scene-state:" + target + ":" + st.version, "scene-state").run();
    if (ins.meta.changes === 1) {
      const plan = await planEffects(env, sid, target, sc.stateEffects.filter((x: any) => x?.type !== "advance_scene"), undefined);
      if (plan.ok && sc.stateEffects.every((x: any) => x?.type !== "advance_scene")) st = await execOps(env, sid, st, plan.ops, next, "scene:" + target + ":" + st.version);
    }
  }
  return st;
}

export async function applyTrigger(
  env: SiteEnv,
  sid: string,
  trigger: { type: string; actionId: string; success?: boolean; actionTemplate?: string; choiceId?: string; npcId?: string },
  startScene?: string,
): Promise<PublicEvent[]> {
  const out: PublicEvent[] = [];
  let st = await ensureState(env, sid);
  if (!st) return out;
  const events = (await allEvents(env, sid)).sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0) || (a.id < b.id ? -1 : 1));
  let pending: Pending[] = [{ type: trigger.type, scene: st.scene, success: trigger.success, actionTemplate: trigger.actionTemplate, choiceId: trigger.choiceId, npcId: trigger.npcId }];
  if (startScene) pending = [{ type: "scene_entered", scene: startScene }]; // 提交过的转场：scene_entered 由调用方先完成状态变更
  for (let depth = 0; depth < WORLD_CONFIG.maxChain && pending.length; depth++) {
    const next: Pending[] = [];
    for (const t of pending) {
      const runEvent = async (ev: { id: string; c: any }) => {
        if (!(await evalCond(env, sid, st!.scene, ev.c.preconditions))) return false;
        const once = (ev.c.repeatPolicy ?? "once_per_world") === "once_per_world";
        const key = once ? ev.id : ev.id + ":" + trigger.actionId;
        const plan = await planEffects(env, sid, st!.scene, ev.c.effects ?? [], ev.c.revealsFacts, { open: ev.c.openThreads, resolves: ev.c.resolvesThreads });
        if (!plan.ok) return false;
        const po = publicText(ev.c);
        const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,?)").bind(sid, key, trigger.actionId, po).run();
        if (ins.meta.changes !== 1) return false; // 幂等：已经应用过
        st = await execOps(env, sid, st!, plan.ops, next, trigger.actionId);
        await grantFromWorldEvent(env, { sid, eventKey: key, eventId: ev.id, triggerRef: ev.c.grantTriggerRef });
        if (po) out.push({ publicOutcome: po });
        return !!po;
      };
      let spoke = false;
      for (const ev of events) {
        const tr = ev.c.trigger ?? {};
        if (tr.fallback === true || !matches(tr, t)) continue;
        if (await runEvent(ev)) spoke = true;
      }
      // 兜底：行动已提交但没有任何事件给出公开结果时，才轮到 fallback 事件（让世界对任意可行行动有回应）
      if (t.type === "action_resolved" && !spoke && out.length === 0) {
        for (const ev of events) {
          const tr = ev.c.trigger ?? {};
          if (tr.fallback !== true || !matches(tr, t)) continue;
          if (await runEvent(ev)) break;
        }
      }
    }
    pending = next;
  }
  return out;
}

// 同一个行动重放时：返回当时已提交的公开结果（不重复应用）。
export async function replayPublicOutcomes(env: SiteEnv, sid: string, actionId: string): Promise<PublicEvent[]> {
  await ensure(env);
  const rs = await env.DB.prepare("SELECT public_outcome FROM adventure_world_applied WHERE session_id=? AND action_id=? AND public_outcome IS NOT NULL ORDER BY rowid").bind(sid, actionId).all<{ public_outcome: string }>();
  return rs.results.map((r) => ({ publicOutcome: r.public_outcome }));
}

type WRes = { status: number; body: Record<string, unknown> };
const wfail = (status: number, code: string, message: string): WRes => ({ status, body: { code, message } });
const idOk = (x: unknown): x is string => typeof x === "string" && /^[\w.:-]{1,120}$/.test(x);

// 玩家真正提交的世界操作：转场（travel）与对话选择（choice）。列出 choices / 讨论都不改变世界。
// 幂等：同 commitId 同内容 → 返回原结果；同 commitId 不同内容 → 409。expectedVersion 不符 → 409（场景已变）。
async function commitOp(env: SiteEnv, body: unknown, kind: "travel" | "choice"): Promise<WRes> {
  const b = body as any;
  if (!b || typeof b !== "object" || !idOk(b.sessionId) || !idOk(b.commitId)) return wfail(400, "bad_request", "sessionId / commitId 不合法");
  const payload = kind === "travel" ? { target: b.target } : { choiceId: b.choiceId, npcId: b.npcId ?? null };
  if (kind === "travel" ? !idOk(b.target) : !idOk(b.choiceId) || (b.npcId != null && !idOk(b.npcId))) return wfail(400, "bad_request", "参数不合法");
  if (b.expectedVersion !== undefined && !Number.isSafeInteger(b.expectedVersion)) return wfail(400, "bad_request", "expectedVersion 不合法");
  await ensure(env);
  const sid: string = b.sessionId;
  const actionId = kind + ":" + b.commitId;
  const pj = JSON.stringify(payload);
  const old = await env.DB.prepare("SELECT kind, payload FROM adventure_world_commits WHERE session_id=? AND commit_id=?").bind(sid, b.commitId).first<{ kind: string; payload: string }>();
  if (old) {
    if (old.kind !== kind || old.payload !== pj) return wfail(409, "commit_conflict", "这个 commitId 已用于另一次提交");
    return { status: 200, body: { ok: true, replay: true, worldEvents: await replayPublicOutcomes(env, sid, actionId) } };
  }
  const sess = await env.DB.prepare("SELECT 1 FROM adventure_sessions WHERE id=?").bind(sid).first().catch(() => null);
  if (!sess) return wfail(404, "not_found", "会话不存在");
  const st = await ensureState(env, sid);
  if (!st) return wfail(422, "no_world", "当前没有可用的世界");
  if (b.expectedVersion !== undefined && b.expectedVersion !== st.version) return wfail(409, "stale_world", "世界已经变化，请按当前情况重新选择");
  let outcomes: PublicEvent[] = [];
  if (kind === "travel") {
    const sc = await sceneContent(env, sid, st.scene);
    const dest = sc && Array.isArray(sc.choices) && sc.choices.includes(b.target) && b.target !== st.scene ? await sceneContent(env, sid, b.target) : null;
    if (!dest || !(await entryOk(env, sid, st.scene, dest))) return wfail(422, "not_available", "现在去不了那里");
    if (dest.ending !== undefined) {
      const en = endingOf(dest);
      if (!en) return wfail(422, "not_available", "现在去不了那里"); // 结局内容不合法：宁可不可用
      const lockedTo = await flagGet(env, sid, "ending_locked");
      if (lockedTo !== null && lockedTo !== JSON.stringify(en.id)) return wfail(409, "ending_locked", "结局已经确定，不能再走向另一个结局");
      const shown = await env.DB.prepare("SELECT ending_id, world_version FROM adventure_world_ending_notice WHERE session_id=? AND target=?").bind(sid, b.target).first<{ ending_id: string; world_version: number }>();
      const consented = b.confirmEnding === true && !!shown && shown.world_version === st.version && shown.ending_id === en.id;
      if (!consented) {
        // 先展示代价说明（每次未确认的请求都重新记录：确认必须在展示之后、针对同一目标与同一世界版本）；不提交任何东西
        await env.DB.prepare("INSERT INTO adventure_world_ending_notice (session_id,target,ending_id,world_version,shown_at) VALUES (?,?,?,?,?) ON CONFLICT(session_id,target) DO UPDATE SET ending_id=excluded.ending_id, world_version=excluded.world_version, shown_at=excluded.shown_at").bind(sid, b.target, en.id, st.version, Date.now() / 1000).run();
        return { status: 422, body: { code: "ending_confirmation_required", message: "这一步不可逆，需要先看清代价并单独确认。", costNotice: en.costNotice } };
      }
    }
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_commits (session_id,commit_id,kind,payload) VALUES (?,?,?,?)").bind(sid, b.commitId, kind, pj).run();
    if (claim.meta.changes !== 1) return wfail(409, "commit_in_progress", "这次提交正在处理，请稍后重试");
    const next: Pending[] = [];
    const st2 = await enterScene(env, sid, st, b.target, next, actionId);
    await env.DB.prepare("DELETE FROM adventure_world_ending_notice WHERE session_id=?").bind(sid).run();
    // 进入后的 scene_entered 及连锁事件
    outcomes = await applyTrigger(env, sid, { type: "scene_entered", actionId }, st2.scene);
    // stateEffects 产生的二次触发（如 world_flag_changed）
    for (const t of next.filter((n) => n.type !== "scene_entered")) outcomes.push(...(await applyChained(env, sid, actionId, t)));
    if (dest.ending !== undefined) await createEndingSnapshot(env, sid, b.commitId, endingOf(dest)!.id, b.target);
  } else {
    // 只有内容里确实存在、且挂在当前场景的选择才算数；否则不泄露存在与否，统一 not_available
    const evs = await allEvents(env, sid);
    const ok = evs.some((e) => e.c.trigger?.type === "dialogue_choice_committed" && e.c.trigger.choiceId === b.choiceId && (!e.c.trigger.npcId || e.c.trigger.npcId === (b.npcId ?? null)) && (!e.c.trigger.sceneId || e.c.trigger.sceneId === st.scene));
    if (!ok) return wfail(422, "not_available", "现在没有这个选择");
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_commits (session_id,commit_id,kind,payload) VALUES (?,?,?,?)").bind(sid, b.commitId, kind, pj).run();
    if (claim.meta.changes !== 1) return wfail(409, "commit_in_progress", "这次提交正在处理，请稍后重试");
    outcomes = await applyTrigger(env, sid, { type: "dialogue_choice_committed", actionId, choiceId: b.choiceId, npcId: b.npcId ?? undefined });
  }
  await env.DB.prepare("UPDATE adventure_sessions SET world_seq=world_seq+1, updated_at=? WHERE id=?").bind(Date.now() / 1000, sid).run();
  return { status: 200, body: { ok: true, replay: false, worldEvents: outcomes } };
}
// 转场时 stateEffects 引发的 flag/fact 触发：作为独立触发交给事件规则（同一 actionId，事件键去重）
async function applyChained(env: SiteEnv, sid: string, actionId: string, t: Pending): Promise<PublicEvent[]> {
  const st = await ensureState(env, sid);
  if (!st) return [];
  const out: PublicEvent[] = [];
  for (const ev of (await allEvents(env, sid)).sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0) || (a.id < b.id ? -1 : 1))) {
    const tr = ev.c.trigger ?? {};
    if (tr.fallback === true || !matches(tr, { ...t, scene: st.scene })) continue;
    if (!(await evalCond(env, sid, st.scene, ev.c.preconditions))) continue;
    const once = (ev.c.repeatPolicy ?? "once_per_world") === "once_per_world";
    const key = once ? ev.id : ev.id + ":" + actionId;
    const plan = await planEffects(env, sid, st.scene, ev.c.effects ?? [], ev.c.revealsFacts, { open: ev.c.openThreads, resolves: ev.c.resolvesThreads });
    if (!plan.ok) continue;
    const po = publicText(ev.c);
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,?)").bind(sid, key, actionId, po).run();
    if (ins.meta.changes !== 1) continue;
    await execOps(env, sid, st, plan.ops.filter((o: any) => o.type !== "advance_scene"), [], actionId);
    await grantFromWorldEvent(env, { sid, eventKey: key, eventId: ev.id, triggerRef: ev.c.grantTriggerRef });
    if (po) out.push({ publicOutcome: po });
  }
  return out;
}
export const commitTravel = (env: SiteEnv, body: unknown) => commitOp(env, body, "travel");
export const commitChoice = (env: SiteEnv, body: unknown) => commitOp(env, body, "choice");

export async function availableChoices(env: SiteEnv, sid: string): Promise<{ choiceId: string; npcId: string }[]> {
  const st = await ensureState(env, sid);
  if (!st) return [];
  const out: { choiceId: string; npcId: string }[] = [];
  for (const ev of await allEvents(env, sid)) {
    const t = ev.c.trigger ?? {};
    if (t.type !== "dialogue_choice_committed" || typeof t.choiceId !== "string" || typeof t.npcId !== "string") continue;
    const row = await env.DB.prepare("SELECT location FROM adventure_world_npc WHERE session_id=? AND npc_id=?").bind(sid, t.npcId).first<{ location: string | null }>();
    let loc = row?.location ?? null;
    if (!loc) loc = (await readWorldContent(env, sid, "npc", t.npcId))?.content?.initial?.locationId ?? null;
    if (loc === st.scene && !out.some((o) => o.choiceId === t.choiceId && o.npcId === t.npcId)) out.push({ choiceId: t.choiceId, npcId: t.npcId });
  }
  return out;
}

// 玩家可见的场景信息：只给 publicText（以及世界开场白，仅在会话刚开始时）。
export async function publicSceneInfo(env: SiteEnv, sid: string): Promise<{ active: boolean; opening?: string; publicText?: string; entered?: string[]; options?: string[]; objective?: string; learningGoal?: string }> {
  const st = await ensureState(env, sid);
  if (!st) return { active: false };
  const entered = (await worldIntro(env, sid).catch(() => [])).map((e) => e.publicOutcome);
  const options = (await availableMoves(env, sid).catch(() => [])).map((m) => m.label);
  const sc = await sceneContent(env, sid, st.scene);
  const w = st.version === 0 ? await findWorld(env, sid) : null;
  return { active: true, entered, options, opening: typeof w?.public_opening === "string" ? w.public_opening : undefined, publicText: typeof sc?.publicText === "string" ? sc.publicText : undefined, ...(typeof sc?.objective === "string" ? { objective: sc.objective } : {}), ...(typeof sc?.learningGoal === "string" ? { learningGoal: sc.learningGoal } : {}) };
}

// 可前往的场景：当前场景 content.choices 里的目的地。玩家可见的标签优先用当前场景的 choiceLabels[目的地]，否则“地点N”（内部 role 不给玩家看）。
export async function availableMoves(env: SiteEnv, sid: string): Promise<{ sceneId: string; label: string }[]> {
  const st = await ensureState(env, sid);
  if (!st) return [];
  const sc = await sceneContent(env, sid, st.scene);
  if (!sc || !Array.isArray(sc.choices)) return [];
  const out: { sceneId: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const id of sc.choices) {
    if (id === st.scene || seen.has(id)) continue; // 不列出当前所在场景（原地“前往”）与重复目的地
    seen.add(id);
    const dest = await sceneContent(env, sid, id);
    if (!dest || !(await entryOk(env, sid, st.scene, dest))) continue;
    const label = (sc.choiceLabels && typeof sc.choiceLabels[id] === "string" && sc.choiceLabels[id]) || "地点" + (out.length + 1);
    out.push({ sceneId: id, label });
  }
  return out;
}

// 移动：校验目的地在当前场景的 choices 里，更新场景并触发 scene_entered 事件链。幂等按 actionId。

// 开场：会话第一次进入世界时触发起始场景的 scene_entered 事件（幂等），返回它们的公开结果。
export async function worldIntro(env: SiteEnv, sid: string): Promise<PublicEvent[]> {
  const st = await ensureState(env, sid);
  if (!st || st.version !== 0) return st ? await replayPublicOutcomes(env, sid, "init") : [];
  await openSceneThreads(env, sid, await sceneContent(env, sid, st.scene), "init");
  await applyTrigger(env, sid, { type: "scene_entered", actionId: "init" });
  return replayPublicOutcomes(env, sid, "init");
}

// ---- 章节开场快照（契约：world-content-semantics-v1「Chapter-opening continuity snapshot」）----
// 终局 travel 与其 scene_entered 结局锁成功提交之后创建；每个会话至多一份（INSERT OR IGNORE），重放不会产生第二份。
// 快照全部是引用，不含叙述文字；完整快照只在服务器内部，玩家/DM 只能拿 snapshotProjection 的授权视图。
export const SNAPSHOT_CONFIG = { schemaVersion: 1, carryoverPolicyVersion: "carry-1" };
async function createEndingSnapshot(env: SiteEnv, sid: string, commitId: string, endingId: string, endingScene: string): Promise<void> {
  const locked = await flagGet(env, sid, "ending_locked");
  if (locked !== JSON.stringify(endingId)) return; // 没有匹配的结局锁：不建快照
  const st = await ensureState(env, sid);
  if (!st) return;
  const all = async (q: string, ...a: any[]) => (await env.DB.prepare(q).bind(sid, ...a).all<any>()).results ?? [];
  const pin = await pinFor(env, sid);
  if (!pin) return; // 世界来源不可唯一确认：失败关闭，不建快照
  const world = { rev: pin.rev };
  const sceneRev = (await readWorldContent(env, sid, "scene", endingScene))?.rev ?? 0;
  const applied = await all("SELECT event_key FROM adventure_world_applied WHERE session_id=? ORDER BY event_key");
  const appliedKeys = new Set(applied.map((r) => String(r.event_key)));
  const facts = await all("SELECT fact_id FROM adventure_world_facts WHERE session_id=? ORDER BY fact_id");
  const factSrc = await all("SELECT fact_id, source_ref, scene_id FROM adventure_world_fact_src WHERE session_id=?");
  // 学习证据：本会话回合产生的、已核验为正确且有效推理、非代解的学习事件（只带引用；不重复发奖，奖励仍按来源事件一次性结算）
  const ev = (await env.DB.prepare("SELECT e.id AS id, e.topic_id AS topic, ec.concept_id AS concept FROM learning_events e JOIN adventure_turns tt ON e.id = 'turn:' || tt.turn_id || ':eval' LEFT JOIN adventure_evidence_concept ec ON ec.event_id=e.id WHERE tt.session_id=? AND e.verification='confirmed' AND e.correctness='correct' AND e.reasoning='valid' AND e.assistance != 'worked_solution' ORDER BY e.at, e.id LIMIT 200").bind(sid).all<any>().catch(() => ({ results: [] as any[] }))).results ?? [];
  const npcs = await all("SELECT npc_id, relation FROM adventure_world_npc WHERE session_id=? ORDER BY npc_id");
  const hist = await all("SELECT npc_id, n FROM adventure_world_rel_history WHERE session_id=? ORDER BY npc_id, n");
  const mem = await all("SELECT npc_id, layer, item FROM adventure_world_npc_memory WHERE session_id=? ORDER BY npc_id, layer, item");
  const items = await all("SELECT item_id FROM adventure_world_items WHERE session_id=? ORDER BY item_id");
  const threads = await all("SELECT thread_id, audience, opened_by FROM adventure_world_threads WHERE session_id=? AND status='open' AND carryover='eligible' ORDER BY thread_id");
  if (threads.some((t) => !t.opened_by)) return; // 缺少开启来源：失败关闭，不建快照
  const snap = {
    snapshotSchemaVersion: SNAPSHOT_CONFIG.schemaVersion,
    sourceWorldRef: pin.id, sourceWorldVersion: st.version, sourceContentRevision: { world: world.rev, endingScene: sceneRev }, engineVersion: WORLD_CONFIG.version,
    endingRef: endingId, endingCommitRef: commitId,
    // 玩家已知事实：来源是已提交事件（具体来源事件键集合只作审计引用），受众=该玩家
    confirmedFacts: facts.map((f) => ({ factRef: f.fact_id, provenance: (() => { const o = factSrc.find((x) => x.fact_id === f.fact_id); return o ? { sourceCommitRef: o.source_ref, sourceScene: o.scene_id, discoveredBy: "player" } : { sourceCommitRef: null, committedEvents: appliedKeys.size }; })(), audience: "player" })),
    npcContinuity: npcs.map((n) => ({
      npcRef: n.npc_id, relationBand: n.relation ?? null,
      relationshipHistoryRefs: hist.filter((h) => h.npc_id === n.npc_id).map((h) => n.npc_id + "#" + h.n),
      heardClaims: mem.filter((m) => m.npc_id === n.npc_id && m.layer === "heardClaims").map((m) => m.item),
      beliefs: mem.filter((m) => m.npc_id === n.npc_id && m.layer === "npcBeliefs").map((m) => m.item),
      confirmedKnowledge: mem.filter((m) => m.npc_id === n.npc_id && m.layer === "confirmedNpcKnowledge").map((m) => m.item),
    })),
    inventory: items.map((i) => ({ itemRef: i.item_id })),
    // 未解线索：只带“开启已提交、尚未解决、carryover=eligible”的引用；不含解答或叙述；local_only 与已解决的不带
    openThreads: threads.map((t) => ({ threadRef: t.thread_id, status: "unresolved", audience: t.audience, openedByCommitRef: t.opened_by })),
    learningEvidenceRefs: ev.map((x) => ({ evidenceRef: x.id, topicRef: x.topic, conceptRef: x.concept ?? null })),
    carryoverPolicyVersion: SNAPSHOT_CONFIG.carryoverPolicyVersion,
  };
  await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_ending_snapshot (session_id,ending_commit_id,snapshot,created_at) VALUES (?,?,?,?)").bind(sid, commitId, JSON.stringify(snap), Date.now() / 1000).run();
}
// 授权投影：只有玩家已知事实、可见关系档位、持有物品；不含结局 id、NPC 私有信念/知识、内部提交引用。
// 来源不可核验（快照版本/政策版本不符）→ 失败关闭返回 null。
export async function snapshotProjection(env: SiteEnv, sid: string): Promise<{ facts: string[]; relations: { npc: string; band: string | null }[]; items: string[]; openThreads: string[] } | null> {
  await ensure(env);
  const r = await env.DB.prepare("SELECT snapshot FROM adventure_world_ending_snapshot WHERE session_id=?").bind(sid).first<{ snapshot: string }>();
  if (!r) return null;
  let s: any;
  try { s = JSON.parse(r.snapshot); } catch { return null; }
  if (s.snapshotSchemaVersion !== SNAPSHOT_CONFIG.schemaVersion || s.carryoverPolicyVersion !== SNAPSHOT_CONFIG.carryoverPolicyVersion) return null;
  return {
    facts: s.confirmedFacts.filter((f: any) => f.audience === "player").map((f: any) => f.factRef),
    relations: s.npcContinuity.map((n: any) => ({ npc: n.npcRef, band: n.relationBand })),
    items: s.inventory.map((i: any) => i.itemRef),
    // 只有 audience=player 且仍为 unresolved 的线索引用；server_private 永不进入玩家/DM 视图
    openThreads: (s.openThreads ?? []).filter((t: any) => t.audience === "player" && t.status === "unresolved").map((t: any) => t.threadRef),
  };
}
// 管理员计数视图（测试/运维用）：只给分类计数，不给任何 id
export async function snapshotStats(env: SiteEnv, sid: string): Promise<Record<string, number> | null> {
  await ensure(env);
  const rows = await env.DB.prepare("SELECT snapshot FROM adventure_world_ending_snapshot WHERE session_id=?").bind(sid).all<{ snapshot: string }>();
  if (!rows.results.length) return null;
  const s = JSON.parse(rows.results[0].snapshot);
  return { snapshots: rows.results.length, facts: s.confirmedFacts.length, npcs: s.npcContinuity.length, items: s.inventory.length, heard: s.npcContinuity.reduce((a: number, n: any) => a + n.heardClaims.length, 0), beliefs: s.npcContinuity.reduce((a: number, n: any) => a + n.beliefs.length, 0), openThreads: s.openThreads.length, openThreadsPlayer: s.openThreads.filter((t: any) => t.audience === "player").length, openThreadsPrivate: s.openThreads.filter((t: any) => t.audience === "server_private").length, projectedOpenThreads: (await snapshotProjection(env, sid))?.openThreads.length ?? -1, learningRefs: s.learningEvidenceRefs.length, factsSourced: s.confirmedFacts.filter((f: any) => typeof f.provenance?.sourceCommitRef === "string" && f.provenance?.sourceScene).length };
}
