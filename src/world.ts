// 世界事件引擎 v0（服务端是唯一的世界变化确认方）。
// 读取私有内容包（world/scene/npc/event），只在服务端使用；对玩家只返回事件内容里写明的 publicOutcome，不返回 id、effects、条件。
// 契约：content/contracts/world-content-semantics-v1.md（ChatGPT 设计分支）。
import { readContentInternal } from "./content";
import type { SiteEnv } from "./site";

export const WORLD_CONFIG = { version: "world-1.0.0", maxChain: 4, allowedEffects: new Set(["set_flag", "advance_scene", "set_npc_location", "change_npc_relation", "record_fact_discovery"]) };

let ready: Promise<unknown> | null = null;
function ensure(env: SiteEnv) {
  return (ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world (session_id TEXT PRIMARY KEY, scene_id TEXT NOT NULL, version INTEGER NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_flags (session_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (session_id,key))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_npc (session_id TEXT NOT NULL, npc_id TEXT NOT NULL, location TEXT, relation TEXT, PRIMARY KEY (session_id,npc_id))`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_world_facts (session_id TEXT NOT NULL, fact_id TEXT NOT NULL, PRIMARY KEY (session_id,fact_id))`),
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

// 校验所有 effects，通过才应用；任何一条非法就整条事件拒绝（不部分应用）。
async function planEffects(env: SiteEnv, scene: string, effects: any[]): Promise<{ ok: true; ops: any[] } | { ok: false }> {
  if (!Array.isArray(effects)) return { ok: false };
  const sc = await sceneContent(env, scene);
  for (const e of effects) {
    if (!e || typeof e !== "object" || !WORLD_CONFIG.allowedEffects.has(e.type) || typeof e.target !== "string") return { ok: false };
    if (e.type === "advance_scene") {
      if (!sc || !Array.isArray(sc.choices) || !sc.choices.includes(e.target) || !(await sceneContent(env, e.target))) return { ok: false };
    }
    if ((e.type === "change_npc_relation" || e.type === "set_flag") && typeof e.value === "object" && e.value !== null) return { ok: false };
    if (e.type === "change_npc_relation" && typeof e.value !== "string") return { ok: false };
    if (e.type === "set_npc_location" && typeof e.value !== "string") return { ok: false };
  }
  return { ok: true, ops: effects };
}

export async function applyTrigger(
  env: SiteEnv,
  sid: string,
  trigger: { type: string; actionId: string; success?: boolean; actionTemplate?: string; flagKey?: string; choiceId?: string; npcId?: string; factId?: string },
): Promise<PublicEvent[]> {
  const out: PublicEvent[] = [];
  let st = await ensureState(env, sid);
  if (!st) return out;
  const events = await allEvents(env);
  let pending: { type: string; scene: string; success?: boolean; actionTemplate?: string; flagKey?: string; choiceId?: string; npcId?: string; factId?: string }[] = [{ type: trigger.type, scene: st.scene, success: trigger.success, actionTemplate: trigger.actionTemplate, flagKey: trigger.flagKey, choiceId: trigger.choiceId, npcId: trigger.npcId, factId: trigger.factId }];
  for (let depth = 0; depth < WORLD_CONFIG.maxChain && pending.length; depth++) {
    const next: typeof pending = [];
    for (const t of pending) {
      for (const ev of events.sort((a, b) => (b.c.priority ?? 0) - (a.c.priority ?? 0) || (a.id < b.id ? -1 : 1))) {
        const tr = ev.c.trigger ?? {};
        if (tr.type !== t.type) continue;
        if (tr.sceneId && tr.sceneId !== t.scene) continue; // 触发发生时所在的场景（同一次行动里切场景不影响同一触发的其它事件）
        if (t.type === "world_flag_changed" && (!t.flagKey || tr.flagKey !== t.flagKey)) continue;
        if (t.type === "dialogue_choice_committed" && (!t.choiceId || !t.npcId || tr.choiceId !== t.choiceId || tr.npcId !== t.npcId)) continue;
        if (t.type === "fact_discovered" && (!t.factId || tr.factId !== t.factId)) continue;
        if (t.type === "action_resolved") {
          if (tr.outcome && tr.outcome !== (t.success ? "success" : "failure")) continue;
          if (tr.actionTemplateId && tr.actionTemplateId !== t.actionTemplate) continue;
        }
        if (!(await evalCond(env, sid, st.scene, ev.c.preconditions))) continue;
        const once = (ev.c.repeatPolicy ?? "once_per_world") === "once_per_world";
        const key = once ? ev.id : ev.id + ":" + trigger.actionId;
        const plan = await planEffects(env, st.scene, ev.c.effects ?? []);
        if (!plan.ok) continue;
        const po = typeof ev.c.publicOutcome === "string" ? ev.c.publicOutcome : null;
        const ins = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_applied (session_id,event_key,action_id,public_outcome) VALUES (?,?,?,?)").bind(sid, key, trigger.actionId, po).run();
        if (ins.meta.changes !== 1) continue; // 幂等：已经应用过
        for (const e of plan.ops) {
          if (e.type === "set_flag") {
            const newValue = JSON.stringify(e.value ?? true);
            const oldValue = await flagGet(env, sid, e.target);
            if (oldValue !== newValue) {
              await env.DB.prepare("INSERT INTO adventure_world_flags (session_id,key,value) VALUES (?,?,?) ON CONFLICT(session_id,key) DO UPDATE SET value=excluded.value").bind(sid, e.target, newValue).run();
              next.push({ type: "world_flag_changed", scene: st.scene, flagKey: e.target });
            }
          }
          else if (e.type === "change_npc_relation") await env.DB.prepare("INSERT INTO adventure_world_npc (session_id,npc_id,relation) VALUES (?,?,?) ON CONFLICT(session_id,npc_id) DO UPDATE SET relation=excluded.relation").bind(sid, e.target, e.value).run();
          else if (e.type === "set_npc_location") await env.DB.prepare("INSERT INTO adventure_world_npc (session_id,npc_id,location) VALUES (?,?,?) ON CONFLICT(session_id,npc_id) DO UPDATE SET location=excluded.location").bind(sid, e.target, e.value).run();
          else if (e.type === "record_fact_discovery") await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_facts (session_id,fact_id) VALUES (?,?)").bind(sid, e.target).run();
          else if (e.type === "advance_scene") {
            st = { scene: e.target, version: st.version + 1 };
            await env.DB.prepare("UPDATE adventure_world SET scene_id=?, version=? WHERE session_id=?").bind(st.scene, st.version, sid).run();
            next.push({ type: "scene_entered", scene: st.scene });
          }
        }
        for (const fact of ev.c.revealsFacts ?? []) {
          if (typeof fact !== "string" || !fact) continue;
          const factInsert = await env.DB.prepare("INSERT OR IGNORE INTO adventure_world_facts (session_id,fact_id) VALUES (?,?)").bind(sid, fact).run();
          if (factInsert.meta.changes === 1) next.push({ type: "fact_discovered", scene: st.scene, factId: fact });
        }
        if (po) out.push({ publicOutcome: po });
      }
    }
    pending = next;
  }
  return out;
}

// 同一个行动重放时：返回当时已提交的公开结果（不重复应用）。
export async function replayPublicOutcomes(env: SiteEnv, sid: string, actionId: string): Promise<PublicEvent[]> {
  await ensure(env);
  const rs = await env.DB.prepare("SELECT public_outcome FROM adventure_world_applied WHERE session_id=? AND action_id=? AND public_outcome IS NOT NULL").bind(sid, actionId).all<{ public_outcome: string }>();
  return rs.results.map((r) => ({ publicOutcome: r.public_outcome }));
}
