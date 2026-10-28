// 世界事件引擎 v0（服务端是唯一的世界变化确认方）。
// 读取私有内容包（world/scene/npc/event），只在服务端使用；对玩家只返回事件内容里写明的 publicOutcome，不返回 id、effects、条件。
// 契约：content/contracts/world-content-semantics-v1.md（ChatGPT 设计分支）。
import { readContentInternal } from "./content";
import type { SiteEnv } from "./site";
import { ACTION_ALIASES } from "./adventure";

export const WORLD_CONFIG = { version: "world-1.1.0", maxChain: 4, npcMemoryLayers: new Set(["heardClaims", "npcBeliefs", "confirmedNpcKnowledge"]), allowedEffects: new Set(["set_flag", "lock_flag", "advance_scene", "set_npc_location", "change_npc_relation", "record_fact_discovery", "grant_item", "remove_item", "record_npc_memory"]) };

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
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_applied (session_id TEXT NOT NULL, event_key TEXT NOT NULL, action_id TEXT NOT NULL, public_outcome TEXT, PRIMARY KEY (session_id,event_key))`),
  ]).catch((e) => { ready = null; throw e; }));
}

export type PublicEvent = { publicOutcome: string };
type St = { scene: string; version: number };

// 世界记录的 id 不固定：取内容库里唯一的 world 记录。
async function findWorld(env: SiteEnv): Promise<any | null> {
  const rs = await env.DB.prepare("SELECT id FROM adventure_content WHERE kind='world' GROUP BY id LIMIT 2").all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));
  if (rs.results.length !== 1) return null;
  return (await readContentInternal(env, "world", rs.results[0].id))?.content ?? null;
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

async function sceneContent(env: SiteEnv, id: string) { return (await readContentInternal(env, "scene", id).catch(() => null))?.content ?? null; }

// 事件缓存（单次请求内）
async function allEvents(env: SiteEnv): Promise<{ id: string; c: any }[]> {
  const rs = await env.DB.prepare("SELECT DISTINCT id FROM adventure_content WHERE kind='event'").all<{ id: string }>().catch(() => ({ results: [] as { id: string }[] }));
  const out: { id: string; c: any }[] = [];
  for (const r of rs.results) { const e = await readContentInternal(env, "event", r.id); if (e) out.push({ id: r.id, c: e.content }); }
  return out;
}

async function ensureState(env: SiteEnv, sid: string): Promise<St | null> {
  await ensure(env);
  const r = await env.DB.prepare("SELECT scene_id, version FROM adventure_world WHERE session_id=?").bind(sid).first<{ scene_id: string; version: number }>();
  if (r) return { scene: r.scene_id, version: r.version };
  const w = await findWorld(env);
  const start = w && typeof w.startSceneId === "string" ? w.startSceneId : null;
  if (!start || !(await sceneContent(env, start))) return null; // 没有世界或没有合法起点：引擎不介入
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

// 校验所有 effects（含 revealsFacts），通过才应用；任何一条非法就整条事件拒绝（不部分应用）。
async function planEffects(env: SiteEnv, sid: string, scene: string, effects: any[], reveals: unknown): Promise<{ ok: true; ops: any[] } | { ok: false }> {
  if (!Array.isArray(effects)) return { ok: false };
  if (reveals !== undefined && (!Array.isArray(reveals) || !reveals.every(strOk))) return { ok: false };
  const sc = await sceneContent(env, scene);
  const locks = new Map<string, string>();
  const held = new Set<string>(), removed = new Set<string>();
  for (const e of effects) {
    if (!e || typeof e !== "object" || !WORLD_CONFIG.allowedEffects.has(e.type) || !strOk(e.target)) return { ok: false };
    if (e.type === "advance_scene") {
      if (!sc || !Array.isArray(sc.choices) || !sc.choices.includes(e.target) || !(await sceneContent(env, e.target))) return { ok: false };
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
  return { ok: true, ops: [...effects, ...(Array.isArray(reveals) ? reveals.map((f: string) => ({ type: "record_fact_discovery", target: f })) : [])] };
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

async function execOps(env: SiteEnv, sid: string, st: St, ops: any[], next: Pending[]): Promise<St> {
  for (const e of ops) {
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
      if (r.meta.changes === 1) next.push({ type: "fact_discovered", scene: st.scene, factId: e.target });
    }
    else if (e.type === "grant_item") await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_items (session_id,item_id) VALUES (?,?)").bind(sid, e.target).run();
    else if (e.type === "remove_item") await env.DB.prepare("DELETE FROM adventure_world_items WHERE session_id=? AND item_id=?").bind(sid, e.target).run();
    else if (e.type === "record_npc_memory") await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_npc_memory (session_id,npc_id,layer,item) VALUES (?,?,?,?)").bind(sid, e.target, e.layer, e.value).run();
    else if (e.type === "advance_scene") st = await enterScene(env, sid, st, e.target, next);
  }
  return st;
}

// 进入场景：提交 + 触发 scene_entered；场景自带的 stateEffects（同一套 effects，非法则整体忽略）在进入时应用一次。
async function enterScene(env: SiteEnv, sid: string, st: St, target: string, next: Pending[]): Promise<St> {
  st = { scene: target, version: st.version + 1 };
  await env.DB.prepare("UPDATE adventure_world SET scene_id=?, version=? WHERE session_id=?").bind(st.scene, st.version, sid).run();
  next.push({ type: "scene_entered", scene: st.scene });
  const sc = await sceneContent(env, target);
  if (sc && Array.isArray(sc.stateEffects) && sc.stateEffects.length) {
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,NULL)").bind(sid, "scene-state:" + target + ":" + st.version, "scene-state").run();
    if (ins.meta.changes === 1) {
      const plan = await planEffects(env, sid, target, sc.stateEffects.filter((x: any) => x?.type !== "advance_scene"), undefined);
      if (plan.ok && sc.stateEffects.every((x: any) => x?.type !== "advance_scene")) st = await execOps(env, sid, st, plan.ops, next);
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
  const events = (await allEvents(env)).sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0) || (a.id < b.id ? -1 : 1));
  let pending: Pending[] = [{ type: trigger.type, scene: st.scene, success: trigger.success, actionTemplate: trigger.actionTemplate, choiceId: trigger.choiceId, npcId: trigger.npcId }];
  if (startScene) pending = [{ type: "scene_entered", scene: startScene }]; // 提交过的转场：scene_entered 由调用方先完成状态变更
  for (let depth = 0; depth < WORLD_CONFIG.maxChain && pending.length; depth++) {
    const next: Pending[] = [];
    for (const t of pending) {
      const runEvent = async (ev: { id: string; c: any }) => {
        if (!(await evalCond(env, sid, st!.scene, ev.c.preconditions))) return false;
        const once = (ev.c.repeatPolicy ?? "once_per_world") === "once_per_world";
        const key = once ? ev.id : ev.id + ":" + trigger.actionId;
        const plan = await planEffects(env, sid, st!.scene, ev.c.effects ?? [], ev.c.revealsFacts);
        if (!plan.ok) return false;
        const po = publicText(ev.c);
        const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,?)").bind(sid, key, trigger.actionId, po).run();
        if (ins.meta.changes !== 1) return false; // 幂等：已经应用过
        st = await execOps(env, sid, st!, plan.ops, next);
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
    const sc = await sceneContent(env, st.scene);
    if (!sc || !Array.isArray(sc.choices) || !sc.choices.includes(b.target) || !(await sceneContent(env, b.target))) return wfail(422, "not_available", "现在去不了那里");
    const claim = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_commits (session_id,commit_id,kind,payload) VALUES (?,?,?,?)").bind(sid, b.commitId, kind, pj).run();
    if (claim.meta.changes !== 1) return wfail(409, "commit_in_progress", "这次提交正在处理，请稍后重试");
    const next: Pending[] = [];
    const st2 = await enterScene(env, sid, st, b.target, next);
    // 进入后的 scene_entered 及连锁事件
    outcomes = await applyTrigger(env, sid, { type: "scene_entered", actionId }, st2.scene);
    // stateEffects 产生的二次触发（如 world_flag_changed）
    for (const t of next.filter((n) => n.type !== "scene_entered")) outcomes.push(...(await applyChained(env, sid, actionId, t)));
  } else {
    // 只有内容里确实存在、且挂在当前场景的选择才算数；否则不泄露存在与否，统一 not_available
    const evs = await allEvents(env);
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
  for (const ev of (await allEvents(env)).sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0) || (a.id < b.id ? -1 : 1))) {
    const tr = ev.c.trigger ?? {};
    if (tr.fallback === true || !matches(tr, { ...t, scene: st.scene })) continue;
    if (!(await evalCond(env, sid, st.scene, ev.c.preconditions))) continue;
    const once = (ev.c.repeatPolicy ?? "once_per_world") === "once_per_world";
    const key = once ? ev.id : ev.id + ":" + actionId;
    const plan = await planEffects(env, sid, st.scene, ev.c.effects ?? [], ev.c.revealsFacts);
    if (!plan.ok) continue;
    const po = publicText(ev.c);
    const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,?)").bind(sid, key, actionId, po).run();
    if (ins.meta.changes !== 1) continue;
    await execOps(env, sid, st, plan.ops.filter((o: any) => o.type !== "advance_scene"), []);
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
  for (const ev of await allEvents(env)) {
    const t = ev.c.trigger ?? {};
    if (t.type !== "dialogue_choice_committed" || typeof t.choiceId !== "string" || typeof t.npcId !== "string") continue;
    const row = await env.DB.prepare("SELECT location FROM adventure_world_npc WHERE session_id=? AND npc_id=?").bind(sid, t.npcId).first<{ location: string | null }>();
    let loc = row?.location ?? null;
    if (!loc) loc = (await readContentInternal(env, "npc", t.npcId).catch(() => null))?.content?.initial?.locationId ?? null;
    if (loc === st.scene && !out.some((o) => o.choiceId === t.choiceId && o.npcId === t.npcId)) out.push({ choiceId: t.choiceId, npcId: t.npcId });
  }
  return out;
}

// 玩家可见的场景信息：只给 publicText（以及世界开场白，仅在会话刚开始时）。
export async function publicSceneInfo(env: SiteEnv, sid: string): Promise<{ active: boolean; opening?: string; publicText?: string; entered?: string[]; options?: string[] }> {
  const st = await ensureState(env, sid);
  if (!st) return { active: false };
  const entered = (await worldIntro(env, sid).catch(() => [])).map((e) => e.publicOutcome);
  const options = (await availableMoves(env, sid).catch(() => [])).map((m) => m.label);
  const sc = await sceneContent(env, st.scene);
  const w = st.version === 0 ? await findWorld(env) : null;
  return { active: true, entered, options, opening: typeof w?.public_opening === "string" ? w.public_opening : undefined, publicText: typeof sc?.publicText === "string" ? sc.publicText : undefined };
}

// 可前往的场景：当前场景 content.choices 里的目的地。玩家可见的标签优先用当前场景的 choiceLabels[目的地]，否则“地点N”（内部 role 不给玩家看）。
export async function availableMoves(env: SiteEnv, sid: string): Promise<{ sceneId: string; label: string }[]> {
  const st = await ensureState(env, sid);
  if (!st) return [];
  const sc = await sceneContent(env, st.scene);
  if (!sc || !Array.isArray(sc.choices)) return [];
  const out: { sceneId: string; label: string }[] = [];
  for (const id of sc.choices) {
    const dest = await sceneContent(env, id);
    if (!dest) continue;
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
  await applyTrigger(env, sid, { type: "scene_entered", actionId: "init" });
  return replayPublicOutcomes(env, sid, "init");
}
