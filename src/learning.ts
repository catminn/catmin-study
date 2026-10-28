// 课程无关的学习机会接入：把 learning-adapter（纯函数）接到服务器。
// 原则：只提出“可选的学习提示候选”，不改世界、不打分、不发奖励、不写事实；候选只来自当前场景里作者明确声明的公开线索。
// 课程包存在私有内容库 kind="course"（带版本号、可审计）；学习进度（已学概念）只由服务器按已确认的学习证据推导，客户端不能写。
import type { SiteEnv } from "./site";
import { CONCEPTS } from "./adventure";
import { canPrompt, recordPrompt, recordRefusal } from "./director";
import { suggestLearningOpportunities, validateCoursePacks, mayOfferPrompt, type CoursePack, type Cue, type Affordance, type LearningProfile } from "./learning-adapter";

let ready: Promise<unknown> | null = null;
function ensure(env: SiteEnv) {
  return (ready ??= env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_learning_profile (profile_id TEXT PRIMARY KEY, enrolled TEXT NOT NULL, opted_out TEXT NOT NULL, avoid INTEGER NOT NULL DEFAULT 0, updated_at REAL NOT NULL)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_learning_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, at INTEGER NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, affordance_id TEXT, concept_id TEXT, packs TEXT)`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS adventure_content (kind TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (kind,id,rev))`),
  ]).catch((e) => { ready = null; throw e; }));
}
const PROFILE = "owner";
const idList = (v: unknown) => Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === "string" && /^[a-z][a-z0-9._-]{1,119}$/.test(x));

export async function getProfile(env: SiteEnv): Promise<LearningProfile> {
  await ensure(env);
  const r = await env.DB.prepare("SELECT enrolled, opted_out, avoid FROM adventure_learning_profile WHERE profile_id=?").bind(PROFILE).first<any>();
  if (!r) return { enrolledCourseIds: [], learnedConceptIds: [], optedOutCourseIds: [], avoidLearning: false };
  return { enrolledCourseIds: JSON.parse(r.enrolled), learnedConceptIds: [], optedOutCourseIds: JSON.parse(r.opted_out), avoidLearning: !!r.avoid };
}
// 玩家（登录后）只能改自己的选课、退出课程和“不想被提示学习”开关；已学概念由服务器推导，不接受客户端写入。
export async function putProfile(env: SiteEnv, b: any): Promise<{ status: number; body: unknown }> {
  await ensure(env);
  if (!b || typeof b !== "object" || !idList(b.enrolledCourseIds) || (b.optedOutCourseIds !== undefined && !idList(b.optedOutCourseIds)) || (b.avoidLearning !== undefined && typeof b.avoidLearning !== "boolean") || "learnedConceptIds" in b)
    return { status: 400, body: { ok: false, error: "bad_request", message: "需要 enrolledCourseIds（课程 id 数组），可选 optedOutCourseIds、avoidLearning；learnedConceptIds 由服务器推导，不能写" } };
  await env.DB.prepare("INSERT INTO adventure_learning_profile (profile_id,enrolled,opted_out,avoid,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET enrolled=excluded.enrolled, opted_out=excluded.opted_out, avoid=excluded.avoid, updated_at=excluded.updated_at")
    .bind(PROFILE, JSON.stringify(b.enrolledCourseIds), JSON.stringify(b.optedOutCourseIds ?? []), b.avoidLearning ? 1 : 0, Date.now() / 1000).run();
  return { status: 200, body: { ok: true } };
}
// 已学概念：本站已确认、答案正确、推理有效、非代解的学习证据所对应的概念（概念 id 需与课程包里的概念 id 一致才算数；对不上就当没学过，失败关闭）
export async function learnedConcepts(env: SiteEnv): Promise<string[]> {
  const rs = await env.DB.prepare("SELECT DISTINCT ec.concept_id AS c FROM learning_events e JOIN adventure_evidence_concept ec ON ec.event_id=e.id WHERE e.verification='confirmed' AND e.correctness='correct' AND e.reasoning='valid' AND e.assistance != 'worked_solution'").all<{ c: string }>().catch(() => ({ results: [] as { c: string }[] }));
  return (rs.results ?? []).map((r) => r.c);
}
async function loadPacks(env: SiteEnv): Promise<{ packs: CoursePack[]; refs: string[] }> {
  const rs = await env.DB.prepare("SELECT c.id AS id, c.rev AS rev, c.body AS body FROM adventure_content c JOIN (SELECT id, MAX(rev) AS rev FROM adventure_content WHERE kind='course' GROUP BY id) m ON c.kind='course' AND c.id=m.id AND c.rev=m.rev ORDER BY c.id").all<any>();
  const packs: CoursePack[] = [], refs: string[] = [];
  for (const r of rs.results ?? []) { try { const p = JSON.parse(r.body); if (p && p.id === r.id) { packs.push(p); refs.push(r.id + "@r" + r.rev); } } catch { /* 坏包忽略；整体校验会失败关闭 */ } }
  return { packs, refs };
}
async function audit(env: SiteEnv, sid: string, decision: string, reason: string, a?: string, c?: string, packs?: string[]) {
  await env.DB.prepare("INSERT INTO adventure_learning_audit (session_id,at,decision,reason,affordance_id,concept_id,packs) VALUES (?,?,?,?,?,?,?)").bind(sid, Date.now(), decision, reason, a ?? null, c ?? null, packs ? packs.join(",") : null).run();
}

export type Offer = { affordanceId: string; conceptId: string; prompt: string };
// 返回至多一条非强制学习提示；无课程包/无选课/无公开线索/冷却/静默/玩家不想学 → null（并写审计）。
export async function learningOffer(env: SiteEnv, sid: string, scene: any, opts: { requestedLearning: boolean; quiet: boolean }): Promise<Offer | null> {
  await ensure(env);
  const { packs, refs } = await loadPacks(env);
  if (!packs.length || !scene || !Array.isArray(scene.learningAffordances) || !scene.learningAffordances.length) return null; // 没有课程或没有声明：完全不介入，也不写审计
  const profile = { ...(await getProfile(env)), learnedConceptIds: await learnedConcepts(env) };
  const cues: Cue[] = (Array.isArray(scene.publicCues) ? scene.publicCues : []).filter((c: any) => c && typeof c.id === "string" && typeof c.evidence === "string").map((c: any) => ({ id: c.id, visible: c.visible !== false, evidence: c.evidence }));
  const affordances = scene.learningAffordances as Affordance[];
  const res = suggestLearningOpportunities(packs, { cues, affordances, profile, requestedLearning: opts.requestedLearning });
  if (!res.candidates.length) { await audit(env, sid, "none", res.rejected[0]?.reason ?? "no_candidate", undefined, undefined, refs); return null; }
  // 玩家明确要学（LEARN）时不受冷却限制；否则要过导演冷却，且静默=偏好探索时不打扰
  const exploring = opts.quiet;
  const offered = mayOfferPrompt(res, opts.requestedLearning, exploring);
  if (!offered.length) { await audit(env, sid, "withheld", "exploration_preferred", offered[0]?.affordanceId, undefined, refs); return null; }
  const o = offered[0], topic = "learn:" + o.conceptId;
  if (!opts.requestedLearning) {
    const d = await canPrompt(env, sid, topic);
    if (!d.allow) { await audit(env, sid, "withheld", d.reason, o.affordanceId, o.conceptId, refs); return null; }
    await recordPrompt(env, sid, topic);
  }
  await audit(env, sid, "offered", opts.requestedLearning ? "requested" : "ok", o.affordanceId, o.conceptId, refs);
  return { affordanceId: o.affordanceId, conceptId: o.conceptId, prompt: o.prompt };
}
export async function declineOffer(env: SiteEnv, sid: string, conceptId: string): Promise<{ status: number; body: unknown }> {
  if (typeof sid !== "string" || typeof conceptId !== "string" || !conceptId) return { status: 400, body: { ok: false, error: "bad_request" } };
  await recordRefusal(env, sid, "learn:" + conceptId);
  await audit(env, sid, "declined", "player_declined", undefined, conceptId);
  return { status: 200, body: { ok: true } };
}
export async function auditStats(env: SiteEnv): Promise<Record<string, number>> {
  await ensure(env);
  const rs = await env.DB.prepare("SELECT decision, COUNT(*) AS n FROM adventure_learning_audit GROUP BY decision").all<{ decision: string; n: number }>();
  return Object.fromEntries((rs.results ?? []).map((r) => [r.decision, r.n]));
}
export { validateCoursePacks };

// 已选课程里、分类器还不认识的概念（来自管理员批准过的课程包）：让后续课程的数学解答也能记录到具体知识点，从而成为“已学”证据。
export async function extraConcepts(env: SiteEnv): Promise<{ id: string; title: string }[]> {
  await ensure(env);
  const pr = await getProfile(env);
  if (!pr.enrolledCourseIds.length) return [];
  const { packs } = await loadPacks(env);
  const out: { id: string; title: string }[] = [];
  for (const p of packs) for (const c of p.concepts) if (pr.enrolledCourseIds.includes(c.courseId) && !(pr.optedOutCourseIds ?? []).includes(c.courseId) && !CONCEPTS.includes(c.id) && /^[a-z][a-z0-9._-]{1,119}$/.test(c.id) && typeof c.title === "string") out.push({ id: c.id, title: c.title.slice(0, 60) });
  return out.slice(0, 40);
}
