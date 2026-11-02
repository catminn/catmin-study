// study.catmin.io：主神空间网站版的后端
// - 登录：用共享记忆的同一个口令，签发 30 天的会话 cookie
// - /api/db：存档读写（和主神空间 artifact 云端同步用同一张 study_state 表）
// - /api/ai：代调 Anthropic / OpenAI，流式返回，带每日/每月花费上限
// - /api/mcp：共享记忆工具直接在这里执行；Google 日历/Drive 见 google.ts（只读，需要在页面上点一次「连接 Google」）
import type { Env } from "./store";
import { TOOL_MAP } from "./tools";
import { handleTurn } from "./turn";
import { commitChoice, commitTravel, snapshotStats } from "./world";
import { putContent, listContent, compareContent, listDungeons, checkDungeon, dungeonProgress, expandDungeonMarkers, registerDungeonTrigger, registerSkillBinding, setReviewMode, attachReview } from "./content";
import { pinLegacySessions, getDefaultWorld, setDefaultWorld } from "./world";
import { publicSceneInfo } from "./world";
import { approveProposal, courseStatus, getProposal, proposePack, removeFolder, setFolder, syncCourse } from "./coursesync";
import { auditStats, declineOffer, getProfile, putProfile } from "./learning";
import { getSession, postAction, sessionOp } from "./adventure";
import { getBalance, listEvents, postEvent, postReward } from "./events";
import { GErr, finishAuth, googleDisconnect, googleStatus, googleTool, startAuth, aiDriveSearch, aiDriveRead } from "./google";

export type SiteEnv = Env & {
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DAILY_LIMIT_USD?: string;
  MONTHLY_LIMIT_USD?: string;
};

const COOKIE = "cm_session";
const SESSION_DAYS = 30;
const enc = new TextEncoder();

// ---------- 模型与价格（美元 / 百万 token，2026-10 官方价格） ----------
export const MODELS: Record<string, { provider: "anthropic" | "openai"; label: string; in: number; out: number }> = {
  "claude-haiku-5-5": { provider: "anthropic", label: "Claude Haiku 5.5", in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { provider: "anthropic", label: "Claude Sonnet 5.5", in: 2, out: 10 },
  "claude-opus-5-5": { provider: "anthropic", label: "Claude Opus 5.5", in: 4, out: 20 },
  "gpt-6-luna": { provider: "openai", label: "GPT-6 Luna", in: 0.1, out: 0.5 },
  "gpt-6.1-terra": { provider: "openai", label: "GPT-6.1 Terra", in: 1, out: 5 },
  "gpt-6.1-sol": { provider: "openai", label: "GPT-6.1 Sol", in: 2, out: 10 },
};
const TIER_DEFAULT: Record<string, Record<string, string>> = {
  anthropic: { quick: "claude-haiku-5-5", default: "claude-sonnet-5-5", complex: "claude-opus-5-5" },
  openai: { quick: "gpt-6-luna", default: "gpt-6.1-terra", complex: "gpt-6.1-sol" },
};

// ---------- 工具 ----------
const json = (o: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const asJson = (r: { status: number; body: unknown }) => json(r.body, r.status);
const err = (code: string, message: string, status = 400) => json({ code, message }, status);

async function hmac(key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]!);
}
async function safeEq(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let d = 0;
  for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i];
  return d === 0;
}
function getCookie(req: Request, name: string) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? m[1] : null;
}
async function makeSession(env: SiteEnv) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  return `${exp}.${await hmac(env.ADMIN_TOKEN, "session:" + exp)}`;
}
async function validSession(req: Request, env: SiteEnv) {
  const v = getCookie(req, COOKIE);
  if (!v || !env.ADMIN_TOKEN) return false;
  const [exp, sig] = v.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEq(sig, await hmac(env.ADMIN_TOKEN, "session:" + exp));
}

// ---------- 登录页 ----------
const LOGIN_HTML = `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>学习空间</title><meta name="robots" content="noindex"><link rel="apple-touch-icon" href="/icon-180.png"><link rel="icon" href="/icon-192.png"><link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title" content="小助手">
<style>
:root{--bg:#e7eaf4;--panel:#fff;--line:#c3cae0;--fg:#1b1f3b;--dim:#565d82;--accent:#c4861a;--ink:#2e1f02;--late:#c93a3a;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#11131e;--panel:#1d2032;--line:#353a58;--fg:#eeedf6;--dim:#a9a8c4;--accent:#f0c060;--ink:#2a1d04;--late:#f07a7a;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.6 "Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:16px}
form{width:min(360px,100%);background:var(--panel);border:2px solid var(--line);border-radius:18px;padding:24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 4px 0 var(--line)}
h1{margin:0;font-size:24px;letter-spacing:.06em}p{margin:0;color:var(--dim);font-size:14px}
input{font:inherit;padding:10px 12px;border-radius:10px;border:2px solid var(--line);background:var(--bg);color:var(--fg)}
button{font:inherit;font-weight:700;padding:10px;border-radius:12px;border:0;background:var(--accent);color:var(--ink);cursor:pointer}
.err{color:var(--late);font-size:14px;min-height:1.4em}
</style>
<form id="f"><h1>学习空间</h1><p>输入共享记忆的口令。</p>
<input id="pw" type="password" autocomplete="current-password" autofocus aria-label="口令">
<button>进入</button><div class="err" id="e" role="alert"></div></form>
<script>
document.getElementById("f").onsubmit=async e=>{e.preventDefault();const el=document.getElementById("e");el.textContent="";
  const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("pw").value})});
  if(r.ok)location.reload();else{const o=await r.json().catch(()=>({}));el.textContent=o.message||"进不去，稍后再试。"}};
</script>`;

// ---------- 花费 ----------
// 「今天」按美东日期算（花费上限在她那边的午夜重置，而不是美东晚上 7/8 点）
const day = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
async function spent(env: SiteEnv) {
  const d = day();
  const m = d.slice(0, 7);
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN day=? THEN cost_usd END),0) AS today, COALESCE(SUM(CASE WHEN substr(day,1,7)=? THEN cost_usd END),0) AS month FROM api_usage WHERE day>=?",
  )
    .bind(d, m, m + "-01")
    .first<{ today: number; month: number }>();
  return { today: r?.today ?? 0, month: r?.month ?? 0 };
}
function limits(env: SiteEnv) {
  // 配置写错（NaN）时退回默认值，否则 NaN 比较永远为 false，等于没有上限
  const num = (v: string | undefined, d: number) => { const n = Number(v); return v && Number.isFinite(n) ? n : d; };
  return { daily: num(env.DAILY_LIMIT_USD, 1), monthly: num(env.MONTHLY_LIMIT_USD, 10) };
}
async function recordUsage(env: SiteEnv, model: string, inTok: number, outTok: number) {
  const p = MODELS[model];
  const cost = (inTok * p.in + outTok * p.out) / 1e6;
  await env.DB.prepare(
    `INSERT INTO api_usage (day, model, input_tok, output_tok, cost_usd) VALUES (?,?,?,?,?)
     ON CONFLICT(day, model) DO UPDATE SET input_tok=input_tok+excluded.input_tok, output_tok=output_tok+excluded.output_tok, cost_usd=cost_usd+excluded.cost_usd`,
  )
    .bind(day(), model, inTok, outTok, cost)
    .run();
  return cost;
}

// ---------- AI ----------
// 服务器端工具：模型在回答前可以自己调 Google Drive（用网站连的 Google 账号）
const DRIVE_TOOLS = [
  { name: "drive_search", description: "在 Catherine 的 Google Drive 里按文件名搜索，返回文件 id、标题、类型、修改时间。关键词尽量短，比如 HW8、Quiz 3、Lab 8；搜不到就换个关键词再试。", input_schema: { type: "object", properties: { query: { type: "string", description: "文件名里包含的关键词" } }, required: ["query"] } },
  { name: "drive_read", description: "读出 Google Drive 里一个文件的文字内容（PDF、Google 文档、Word 等），参数是 drive_search 给的 id。", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "calendar_add", description: "在 Catherine 的个人 Google 日历上添加一个日程。时间用美东时间，格式 YYYY-MM-DDTHH:MM；全天的设 allDay 为 true。只在她让你加日历时用。", input_schema: { type: "object", properties: { summary: { type: "string" }, startTime: { type: "string" }, endTime: { type: "string" }, description: { type: "string" }, allDay: { type: "boolean" } }, required: ["summary", "startTime", "endTime"] } },
  { name: "gmail_search", description: "搜 Catherine 个人 Gmail 的邮件，query 用 Gmail 搜索语法（比如 from:canvas newer_than:7d、is:unread in:inbox）。返回 id、主题、发件人、日期、摘要。", input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "gmail_read", description: "读一封邮件串的全文，参数是 gmail_search 给的 id。只读。", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "calendar_list", description: "查看 Catherine 个人 Google 日历某段时间里的日程（美东时间 YYYY-MM-DDTHH:MM），加之前可以先看有没有冲突。", input_schema: { type: "object", properties: { startTime: { type: "string" }, endTime: { type: "string" } }, required: ["startTime", "endTime"] } },
];
async function runDriveTool(env: SiteEnv, name: string, input: any, seen?: { titles: Record<string, string>; files: { id: string; title: string; text: string }[] }): Promise<string> {
  try {
    if (name === "drive_search") {
      const r = await aiDriveSearch(env, String(input?.query || ""));
      if (seen) for (const f of r) if (f?.id) seen.titles[f.id] = f.title;
      return JSON.stringify({ files: r.map((f: any) => ({ id: f.id, title: f.title, mimeType: f.mimeType, modified: f.modifiedTime, account: f.acct === "cornell" ? "Cornell 学校账号" : "个人账号" })), accounts: (r as any).status });
    }
    if (name === "drive_read") {
      const id = String(input?.id || "");
      const r: any = await aiDriveRead(env, id);
      const t = String(r.fileContent || "").slice(0, 24000);
      if (seen && t) seen.files.push({ id, title: seen.titles[id] || r.title || id, text: t });
      return t || "（读不出文字）";
    }
    if (name === "gmail_search" || name === "gmail_read") {
      const g = await import("./google");
      if (name === "gmail_search") return JSON.stringify(await g.gmailSearch(env, String(input?.query || ""))).slice(0, 12000);
      return JSON.stringify(await g.gmailRead(env, String(input?.id || ""))).slice(0, 16000);
    }
    if (name === "calendar_add" || name === "calendar_list") {
      const { googleTool } = await import("./google");
      const r: any = await googleTool(env, "Google Calendar", name === "calendar_add" ? "create_event" : "list_events", name === "calendar_list" ? { ...input, pageSize: 50 } : input);
      if (name === "calendar_add") return JSON.stringify({ ok: true, summary: r?.summary, start: r?.start, end: r?.end });
      return JSON.stringify((r?.events || r?.items || []).map((e: any) => ({ summary: e.summary, start: e.start, end: e.end })));
    }
    return "没有这个工具";
  } catch (e: any) {
    return "出错了：" + String(e?.message || e).slice(0, 200);
  }
}
// 带工具的回答：最多 5 轮「模型要工具 → 服务器执行 → 把结果给模型」，最后返回整段文字
async function anthropicWithTools(env: SiteEnv, model: string, r: AiReq, signal: AbortSignal, used: { inTok: number; outTok: number }) {
  const maxTok = Math.min(Math.max(Number(r.max_tokens) || 4096, 256), 16000);
  const imgs = (r.images || []).slice(0, 5);
  const msgs: any[] = r.messages.map((m, idx) => {
    const text = String(m.content ?? "");
    if (idx === r.messages.length - 1 && m.role === "user" && imgs.length)
      return { role: m.role, content: [...imgs.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })), { type: "text", text }] };
    if (idx === 0 && text.length > 200) return { role: m.role, content: [{ type: "text", text, cache_control: { type: "ephemeral" } }] };
    return { role: m.role, content: text };
  });
  let truncated = false, text = "";
  const seen = { titles: {} as Record<string, string>, files: [] as { id: string; title: string; text: string }[] };
  for (let round = 0; round < 6; round++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTok, messages: msgs, tools: round < 5 ? DRIVE_TOOLS : undefined }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); throw Object.assign(new Error("upstream"), { status: res.status, body: t }); }
    const o: any = await res.json();
    const u = o.usage || {};
    // 每轮的用量记在调用方的计数器里：中途出错时前几轮的花费也要记账
    used.inTok += Math.round((u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0));
    used.outTok += u.output_tokens ?? 0;
    const blocks: any[] = o.content || [];
    text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    if (o.stop_reason === "max_tokens") truncated = true;
    if (o.stop_reason !== "tool_use") break;
    msgs.push({ role: "assistant", content: blocks });
    const results = [];
    for (const b of blocks.filter((b) => b.type === "tool_use")) results.push({ type: "tool_result", tool_use_id: b.id, content: await runDriveTool(env, b.name, b.input, seen) });
    msgs.push({ role: "user", content: results });
  }
  return { text, inTok: used.inTok, outTok: used.outTok, truncated, files: seen.files };
}
type Img = { media_type: string; data: string };
type Msg = { role: "user" | "assistant"; content: string };
interface AiReq {
  messages: Msg[];
  model?: string;
  provider?: string;
  tier?: string;
  images?: Img[];
  max_tokens?: number;
  serverTools?: string[]; // ["drive"]：让模型自己去 Google Drive 搜文件、读内容（只支持 Anthropic）
}

function pickModel(env: SiteEnv, r: AiReq): string | null {
  if (r.model && MODELS[r.model]) return r.model;
  const prov = r.provider === "openai" ? "openai" : "anthropic";
  const tier = r.tier === "quick" || r.tier === "complex" ? r.tier : "default";
  return TIER_DEFAULT[prov][tier];
}
const hasKey = (env: SiteEnv, prov: string) => (prov === "openai" ? !!env.OPENAI_API_KEY : !!env.ANTHROPIC_API_KEY);

// 解析上游 SSE
async function* sse(body: ReadableStream<Uint8Array>) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (data) yield data;
    }
  }
}

async function upstream(env: SiteEnv, model: string, r: AiReq, signal: AbortSignal): Promise<Response> {
  const p = MODELS[model];
  const maxTok = Math.min(Math.max(Number(r.max_tokens) || 4096, 256), 16000);
  const msgs = r.messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }));
  const imgs = (r.images || []).slice(0, 5);
  if (p.provider === "anthropic") {
    // 提示缓存：第一条（固定的背景说明）和倒数第二条（之前的对话）打缓存点，下一轮这部分按 1/10 计价
    const cacheAt = new Set([0, msgs.length - 2].filter((i) => i >= 0 && i < msgs.length - 1 && msgs[i].content.length > 200));
    const content = msgs.map((m, idx) => {
      if (idx === msgs.length - 1 && m.role === "user" && imgs.length)
        return {
          role: m.role,
          content: [
            ...imgs.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
            { type: "text", text: m.content },
          ],
        };
      if (cacheAt.has(idx)) return { role: m.role, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] };
      return m;
    });
    return fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: { "x-api-key": env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTok, stream: true, messages: content }),
    });
  }
  const content = msgs.map((m, idx) => {
    if (idx === msgs.length - 1 && m.role === "user" && imgs.length)
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...imgs.map((im) => ({ type: "image_url", image_url: { url: `data:${im.media_type};base64,${im.data}` } })),
        ],
      };
    return m;
  });
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal,
    headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: content,
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: maxTok,
      reasoning_effort: "low",
    }),
  });
}

function upstreamError(status: number, text: string) {
  const t = text.slice(0, 300);
  if (status === 401 || status === 403) return { code: "sampling_disabled", message: "API Key 无效或没有权限：" + t };
  if (status === 429) return { code: "rate_limited", message: "调用太频繁或余额不足：" + t };
  if (status === 413 || /too long|maximum context|prompt is too long/i.test(t)) return { code: "prompt_too_large", message: t };
  if (status === 400 && /image/i.test(t)) return { code: "image_rejected", message: t };
  return { code: "upstream_error", message: `上游返回 ${status}：${t}` };
}

// ---------- 非流式一次性调用（冒险回合用）----------
async function completeOnce(env: SiteEnv, tier: string, provider: string, text: string, maxTok: number): Promise<string> {
  const model = pickModel(env, { messages: [], tier, provider });
  if (!model || !hasKey(env, MODELS[model].provider)) throw new Error("no_key");
  const up = await upstream(env, model, { messages: [{ role: "user", content: text }], max_tokens: maxTok }, new AbortController().signal);
  if (!up.ok || !up.body) throw new Error("upstream_" + up.status);
  const prov = MODELS[model].provider;
  let out = "", inTok = 0, outTok = 0;
  try {
    for await (const data of sse(up.body)) {
      if (data === "[DONE]") break;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      if (prov === "anthropic") {
        if (ev.type === "message_start") { const u = ev.message?.usage ?? {}; inTok = Math.round((u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0)); } // 按缓存折算后的输入量计费
        else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") out += ev.delta.text;
        else if (ev.type === "message_delta") outTok = ev.usage?.output_tokens ?? outTok;
      } else {
        const c = ev.choices?.[0];
        if (c?.delta?.content) out += c.delta.content;
        if (ev.usage) { inTok = ev.usage.prompt_tokens ?? inTok; outTok = ev.usage.completion_tokens ?? outTok; }
      }
    }
  } finally {
    if (inTok || outTok) await recordUsage(env, model, inTok, outTok).catch(() => {});
  }
  return out;
}
async function budgetOk(env: SiteEnv) {
  const lim = limits(env), sp = await spent(env);
  if (sp.today >= lim.daily) return { ok: false as const, reason: `今天的 API 花费已到上限 $${lim.daily}。进度已保留，明天再继续。` };
  if (sp.month >= lim.monthly) return { ok: false as const, reason: `本月的 API 花费已到上限 $${lim.monthly}。` };
  return { ok: true as const };
}

async function aiHandler(req: Request, env: SiteEnv, ctx: ExecutionContext) {
  let r: AiReq;
  try {
    r = await req.json();
  } catch {
    return err("bad_request", "请求格式不对");
  }
  if (!Array.isArray(r.messages) || !r.messages.length || r.messages[r.messages.length - 1].role !== "user")
    return err("bad_request", "messages 必须以 user 结尾");
  r.messages = await Promise.all(r.messages.map(async (m) => (m.role === "user" && typeof m.content === "string" ? { ...m, content: await expandDungeonMarkers(env, m.content) } : m)));
  const model = pickModel(env, r);
  if (!model) return err("bad_request", "未知模型");
  const prov = MODELS[model].provider;
  if (!hasKey(env, prov)) return err("sampling_disabled", (prov === "openai" ? "OpenAI" : "Anthropic") + " 的 API Key 还没设置", 503);
  const lim = limits(env);
  const sp = await spent(env);
  if (sp.today >= lim.daily) return err("rate_limited", `今天的 API 花费已到上限 $${lim.daily}，明天再用或者切回 Claude 订阅版。`, 429);
  if (sp.month >= lim.monthly) return err("rate_limited", `本月的 API 花费已到上限 $${lim.monthly}。`, 429);

  const ac = new AbortController();
  req.signal?.addEventListener?.("abort", () => ac.abort());
  if (prov === "anthropic" && Array.isArray(r.serverTools) && r.serverTools.includes("drive")) {
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const send = (o: unknown) => w.write(enc.encode("data: " + JSON.stringify(o) + "\n\n"));
    const used = { inTok: 0, outTok: 0 };
    let recorded = false;
    const work = (async () => {
      try {
        const out = await anthropicWithTools(env, model, r, ac.signal, used);
        const cost = await recordUsage(env, model, out.inTok, out.outTok);
        recorded = true;
        if (out.text) await send({ d: out.text });
        if (out.files.length) await send({ files: out.files });
        await send({ done: true, model, cost, truncated: out.truncated, input_tokens: out.inTok, output_tokens: out.outTok });
      } catch (e: any) {
        if (!recorded && (used.inTok || used.outTok)) await recordUsage(env, model, used.inTok, used.outTok).catch(() => {});
        const ue = e?.status ? upstreamError(e.status, e.body || "") : null;
        await send({ error: ue && (ue as any).code ? { code: (ue as any).code, message: (ue as any).message } : { code: ac.signal.aborted ? "cancelled" : "upstream_error", message: String(e?.message ?? e) } }).catch(() => {});
      } finally {
        await w.close().catch(() => {});
      }
    })();
    ctx.waitUntil(work);
    return new Response(readable, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
  }
  let up: Response;
  try {
    up = await upstream(env, model, r, ac.signal);
  } catch (e: any) {
    return err("upstream_error", "连不上模型服务：" + (e?.message ?? e), 502);
  }
  if (!up.ok || !up.body) {
    const t = await up.text().catch(() => "");
    const e = upstreamError(up.status, t);
    return json(e, up.status === 429 ? 429 : 502);
  }

  // 转成统一的 SSE：{d:"增量文本"} … 最后 {done:true, model, cost, truncated}
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const send = (o: unknown) => w.write(enc.encode("data: " + JSON.stringify(o) + "\n\n"));
  const work = (async () => {
    let inTok = 0, outTok = 0, truncated = false;
    try {
      for await (const data of sse(up.body!)) {
        if (data === "[DONE]") break;
        let ev: any;
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (prov === "anthropic") {
          if (ev.type === "message_start") { const u = ev.message?.usage ?? {}; inTok = Math.round((u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0)); } // 按缓存折算后的输入量计费
          else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") await send({ d: ev.delta.text });
          else if (ev.type === "message_delta") {
            outTok = ev.usage?.output_tokens ?? outTok;
            if (ev.delta?.stop_reason === "max_tokens") truncated = true;
          } else if (ev.type === "error") await send({ error: { code: "upstream_error", message: ev.error?.message ?? "error" } });
        } else {
          const c = ev.choices?.[0];
          if (c?.delta?.content) await send({ d: c.delta.content });
          if (c?.finish_reason === "length") truncated = true;
          if (ev.usage) {
            inTok = ev.usage.prompt_tokens ?? inTok;
            outTok = ev.usage.completion_tokens ?? outTok;
          }
        }
      }
      const cost = await recordUsage(env, model, inTok, outTok);
      await send({ done: true, model, cost, truncated, input_tokens: inTok, output_tokens: outTok });
    } catch (e: any) {
      // 中途断开也按已用的 token 记账
      if (inTok || outTok) await recordUsage(env, model, inTok, outTok).catch(() => {});
      await send({ error: { code: ac.signal.aborted ? "cancelled" : "upstream_error", message: String(e?.message ?? e) } }).catch(() => {});
    } finally {
      await w.close().catch(() => {});
    }
  })();
  ctx.waitUntil(work);
  return new Response(readable, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" } });
}

async function aiStatus(env: SiteEnv) {
  const sp = await spent(env);
  return json({
    models: Object.entries(MODELS).map(([id, m]) => ({ id, ...m, available: hasKey(env, m.provider) })),
    spent: sp,
    limits: limits(env),
  });
}

// ---------- 存档 ----------
const KEY_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
async function dbHandler(req: Request, env: SiteEnv, url: URL) {
  // ?meta=state,chat-zero,... 只回版本号，网页和桌面版每隔几秒问一次，变了才去拉整份（各端互通用）
  const meta = url.searchParams.get("meta");
  if (meta != null && req.method === "GET") {
    const keys = meta.split(",").filter((k) => KEY_RE.test(k)).slice(0, 20);
    if (!keys.length) return json({ meta: {} });
    const rs = await env.DB.prepare(`SELECT key, version, updated_at FROM study_state WHERE key IN (${keys.map(() => "?").join(",")})`)
      .bind(...keys)
      .all<{ key: string; version: number; updated_at: number }>();
    const out: Record<string, { version: number; updated_at: number }> = {};
    for (const r of rs.results || []) out[r.key] = { version: r.version, updated_at: r.updated_at };
    return json({ meta: out });
  }
  const key = url.searchParams.get("key") || "";
  if (!KEY_RE.test(key)) return err("bad_request", "key 不合法");
  if (req.method === "GET") {
    const r = await env.DB.prepare("SELECT value, version, updated_at, updated_by FROM study_state WHERE key=?")
      .bind(key)
      .first<{ value: string; version: number; updated_at: number; updated_by: string | null }>();
    return json(r ? { exists: true, value: JSON.parse(r.value), version: r.version, updated_at: r.updated_at, updated_by: r.updated_by } : { exists: false });
  }
  if (req.method === "PUT") {
    const text = await req.text();
    // 按 UTF-8 字节算（D1 单值上限约 2MB；中文一个字 3 字节，按字符数算会放过超限的存档，D1 报错变成 500）
    if (text.length > 1_800_000 || enc.encode(text).length > 1_800_000) return err("too_large", "存档太大", 413);
    try {
      JSON.parse(text);
    } catch {
      return err("bad_request", "不是 JSON");
    }
    const t = Date.now() / 1000;
    if (key === "state") await dailyBackup(env, t);
    const r = await env.DB.prepare(
      `INSERT INTO study_state (key,value,version,updated_at,updated_by) VALUES (?,?,1,?,'site')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, version=study_state.version+1, updated_at=excluded.updated_at, updated_by='site'
       RETURNING version`,
    )
      .bind(key, text, t)
      .first<{ version: number }>();
    return json({ ok: true, version: r ? r.version : null });
  }
  return err("bad_request", "只支持 GET / PUT", 405);
}

// 每天第一次保存存档前，把旧存档复制一份到 bak.state.YYYY-MM-DD（美东日期），保留 14 天
// 本实例已确认备份过的日期：存档每几秒保存一次，同一天里不用每次都跑 INSERT + DELETE
let backedUpDay = "";
async function dailyBackup(env: SiteEnv, t: number) {
  const day = new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  if (backedUpDay === day) return;
  const bk = "bak.state." + day;
  const ins = await env.DB.prepare(
    `INSERT OR IGNORE INTO study_state (key,value,version,updated_at,updated_by)
     SELECT ?, value, 1, ?, 'backup' FROM study_state WHERE key='state'`,
  )
    .bind(bk, t)
    .run();
  // 还没有 state（第一次保存）时不记，下次保存再试
  if (ins.meta.changes || (await env.DB.prepare("SELECT 1 FROM study_state WHERE key=?").bind(bk).first())) backedUpDay = day;
  if (!ins.meta.changes) return;
  const old = new Date((t - 14 * 86400) * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await env.DB.prepare("DELETE FROM study_state WHERE key LIKE 'bak.state.%' AND key < ?").bind("bak.state." + old).run();
}
async function backupsHandler(env: SiteEnv) {
  const r = await env.DB.prepare("SELECT key, updated_at, length(value) AS size FROM study_state WHERE key LIKE 'bak.state.%' ORDER BY key DESC").all<{ key: string; updated_at: number; size: number }>();
  return json({ backups: r.results });
}

// ---------- 全量导出（只读备份） ----------
// 导出 study_state 全部键（含版本号、更新时间）和聊天摘要，登录后访问 /api/export 即可下载
async function exportHandler(env: SiteEnv) {
  const st = await env.DB.prepare("SELECT key, value, version, updated_at, updated_by FROM study_state ORDER BY key").all<{
    key: string; value: string; version: number; updated_at: number; updated_by: string | null;
  }>();
  const cs = await env.DB.prepare("SELECT * FROM chat_summaries ORDER BY rowid").all();
  const docs = st.results.map((r) => {
    let value: unknown = null;
    try { value = JSON.parse(r.value); } catch { value = { __unparsable: r.value }; }
    return { key: r.key, version: r.version, updated_at: r.updated_at, updated_by: r.updated_by, value };
  });
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return json(
    { format: "zhushen-export-v1", exported_at: new Date().toISOString(), counts: { study_state: docs.length, chat_summaries: cs.results.length }, study_state: docs, chat_summaries: cs.results },
    200,
    { "Content-Disposition": `attachment; filename="zhushen-backup-${day}.json"` },
  );
}

// ---------- 连接器 ----------
async function mcpHandler(req: Request, env: SiteEnv) {
  const { server, tool, input } = (await req.json().catch(() => ({}))) as { server?: string; tool?: string; input?: Record<string, unknown> };
  if (server === "共享记忆") {
    const t = TOOL_MAP.get(String(tool));
    if (!t) return err("tool_error", "没有这个工具：" + tool);
    try {
      return json({ payload: await t.run(env, input ?? {}) });
    } catch (e: any) {
      return err("tool_error", String(e?.message ?? e));
    }
  }
  if (server === "Google Calendar" || server === "Google Drive") {
    try {
      return json({ payload: await googleTool(env, server, String(tool), (input ?? {}) as Record<string, any>) });
    } catch (e: any) {
      if (e instanceof GErr) return err(e.code, e.message, e.status);
      return err("upstream_error", String(e?.message ?? e), 502);
    }
  }
  return err("server_not_connected", "未知连接器：" + server, 400);
}

// ---------- 登录接口（限流复用授权页的规则） ----------
async function loginHandler(req: Request, env: SiteEnv) {
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  const k = "pwfail:" + ip;
  const fails = Number((await env.OAUTH_KV.get(k)) ?? 0);
  if (fails >= 5) return err("locked", "口令错误次数太多，15 分钟后再试。", 429);
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!env.OWNER_PASSWORD || !(await safeEq(String(password ?? ""), env.OWNER_PASSWORD))) {
    await env.OAUTH_KV.put(k, String(fails + 1), { expirationTtl: 900 });
    return err("bad_password", "口令不对。", 401);
  }
  const v = await makeSession(env);
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE}=${v}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
  });
}


const PRIVACY_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隐私政策 · 学习空间</title>
<style>body{font:16px/1.8 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:680px;margin:6vh auto;padding:0 20px;color:#1b1f3b}h1{font-size:26px}h2{font-size:18px;margin-top:1.6em}a{color:#4a5bd0}</style></head><body>
<h1>学习空间 隐私政策</h1>
<p>最后更新：2026-10-27</p>
<p>学习空间（study.catmin.io）是 Catherine Min 个人使用的学习工具，不对公众开放，没有其他用户。</p>
<h2>我们访问哪些 Google 数据</h2>
<p>只在她本人授权后，以<b>只读</b>方式读取：Google 日历的事件（用来显示课表和作业截止时间）、Google Drive 中她主动选择的文件（用来作为学习资料）。使用的权限是 calendar.readonly 和 drive.readonly，不会修改、删除或分享任何内容。</p>
<h2>数据如何使用和保存</h2>
<p>读取到的内容只用于在她自己的页面里显示，或在她主动提问时发送给她选择的 AI 模型服务（Anthropic 或 OpenAI）来回答问题。授权令牌加密后保存在 Cloudflare。学习进度保存在 Cloudflare 的数据库中。</p>
<h2>共享与披露</h2>
<p>不出售、不共享、不用于广告，也不向任何第三方披露这些数据，上面提到的 AI 服务商除外（仅限她主动发起的请求）。本应用对 Google 用户数据的使用遵守 <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>，包括其中的有限使用要求。</p>
<h2>撤销与删除</h2>
<p>可以随时在网站上点「Google ✓」断开连接（会同时向 Google 撤销令牌），也可以在 <a href="https://myaccount.google.com/permissions">Google 账号的第三方访问权限</a> 页面撤销。断开后保存的令牌会被删除。</p>
<h2>联系</h2>
<p>jm3235@cornell.edu</p>
<hr><p lang="en"><b>Privacy Policy (English summary).</b> “学习空间” (study.catmin.io) is a personal study tool used only by its owner, Catherine Min. With her consent it reads her Google Calendar events and chosen Google Drive files in read-only mode (calendar.readonly, drive.readonly) solely to display them to her and to answer her own requests. Tokens are stored encrypted. Data is not sold, shared or disclosed to third parties, except the AI providers she chooses (Anthropic, OpenAI) for requests she initiates. Use of Google user data complies with the Google API Services User Data Policy, including the Limited Use requirements. Access can be revoked at any time from the site or at myaccount.google.com/permissions. Contact: jm3235@cornell.edu</p>
</body></html>`;

export async function siteFetch(req: Request, env: SiteEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const p = url.pathname;
  if (p === "/api/login" && req.method === "POST") return loginHandler(req, env);
  if (p === "/privacy" && req.method === "GET")
    return new Response(PRIVACY_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Frame-Options": "DENY" } });
  const authed = await validSession(req, env);
  if (p.startsWith("/api/")) {
    if (!authed) return err("session_expired", "请先登录", 401);
    // 防跨站：写操作只接受同源请求
    if (req.method !== "GET") {
      const origin = req.headers.get("Origin");
      if (origin && origin !== url.origin) return err("forbidden", "跨站请求被拒绝", 403);
      // 没带 Origin 时看浏览器的 Sec-Fetch-Site（同站的其他子域名也算跨源）
      const sfs = req.headers.get("Sec-Fetch-Site");
      if (!origin && sfs && sfs !== "same-origin" && sfs !== "none") return err("forbidden", "跨站请求被拒绝", 403);
    }
    if (p === "/api/logout")
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
    if (p === "/api/ai" && req.method === "POST") return aiHandler(req, env, ctx);
    if (p === "/api/ai/status") return aiStatus(env);
    if (p === "/api/db") return dbHandler(req, env, url);
    if (p === "/api/export" && req.method === "GET") return exportHandler(env);
    if (p === "/api/backups" && req.method === "GET") return backupsHandler(env);
    if (p === "/api/events" && req.method === "POST") return asJson(await postEvent(env, await req.json().catch(() => null)));
    if (p === "/api/events" && req.method === "GET") return asJson(await listEvents(env, url));
    if (p === "/api/rewards" && req.method === "POST") return asJson(await postReward(env, await req.json().catch(() => null)));
    if (p === "/api/dungeons/check" && req.method === "POST") return asJson(await checkDungeon(env, await req.json().catch(() => null)));
    if (p === "/api/dungeons/progress" && req.method === "GET") return asJson(await dungeonProgress(env));
    if (p === "/api/dungeons" && req.method === "GET") return asJson(await listDungeons(env));
    if (p === "/api/adventure/turn" && req.method === "POST")
      return asJson(await handleTurn(env, await req.json().catch(() => null), { budgetOk: () => budgetOk(env), complete: (t, pr, x, m) => completeOnce(env, t, pr, x, m) }));
    if (p === "/api/adventure/travel" && req.method === "POST") return asJson(await commitTravel(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/choice" && req.method === "POST") return asJson(await commitChoice(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/action" && req.method === "POST") return asJson(await postAction(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/session" && req.method === "POST") return asJson(await sessionOp(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/session" && req.method === "GET") return asJson(await getSession(env, url.searchParams.get("id") || ""));
    if (p === "/api/adventure/world" && req.method === "GET") return json(await publicSceneInfo(env, url.searchParams.get("id") || ""));
    if (p === "/api/adventure/learning-profile" && req.method === "GET") { const pr = await getProfile(env); return json({ ok: true, enrolledCourseIds: pr.enrolledCourseIds, optedOutCourseIds: pr.optedOutCourseIds, avoidLearning: pr.avoidLearning }); }
    if (p === "/api/adventure/learning-profile" && req.method === "PUT") return asJson(await putProfile(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/learning-offer/decline" && req.method === "POST") { const b: any = await req.json().catch(() => null); return asJson(await declineOffer(env, b?.sessionId, b?.conceptId)); }
    if (p.startsWith("/api/courses/")) {
      const sub = p.slice("/api/courses/".length);
      const adminOk = async () => { const pw = req.headers.get("X-Owner-Password") ?? ""; return !!env.OWNER_PASSWORD && !!pw && (await safeEq(pw, env.OWNER_PASSWORD)); };
      const body = req.method === "GET" ? null : await req.json().catch(() => null);
      if (sub === "status" && req.method === "GET") return asJson(await courseStatus(env));
      if (sub === "folder" && req.method === "POST") return asJson(await setFolder(env, body));
      if (sub === "folder" && req.method === "DELETE") return asJson(await removeFolder(env, body));
      if (sub === "sync" && req.method === "POST") return asJson(await syncCourse(env, body));
      if (sub === "propose" && req.method === "POST") return asJson(await proposePack(env, body, (pr, m) => completeOnce(env, "default", "anthropic", pr, m)));
      if (sub === "proposal" && req.method === "GET") return asJson(await getProposal(env, url.searchParams.get("courseId") || ""));
      if (sub === "approve" && req.method === "POST") return (await adminOk()) ? asJson(await approveProposal(env, body)) : err("forbidden", "仅限管理员（需再带一次主口令）", 403);
    }
    if (p === "/api/adventure/learning-audit" && req.method === "GET") { // 管理员：只有分类计数
      const pw = req.headers.get("X-Owner-Password") ?? "";
      if (!env.OWNER_PASSWORD || !pw || !(await safeEq(pw, env.OWNER_PASSWORD))) return err("forbidden", "仅限管理员", 403);
      return json({ ok: true, audit: await auditStats(env) });
    }
    if (p === "/api/adventure/ending-snapshot" && req.method === "GET") {
      // 管理员计数视图：同内容库通道的口令校验；响应只有分类计数，快照本体永不经 HTTP
      const pw = req.headers.get("X-Owner-Password") ?? "";
      if (!env.OWNER_PASSWORD || !pw || !(await safeEq(pw, env.OWNER_PASSWORD))) return err("forbidden", "仅限管理员", 403);
      const st = await snapshotStats(env, url.searchParams.get("id") || "");
      return json({ ok: true, snapshot: st });
    }
    if (p === "/api/adventure/content" || p.startsWith("/api/adventure/admin/")) {
      // 内容库/世界管理员通道：登录会话还不够，必须在请求头再带一次主口令（X-Owner-Password）；失败 5 次锁 15 分钟。
      const ip = req.headers.get("CF-Connecting-IP") ?? "local";
      const fk = "cfail:" + ip;
      if (Number((await env.OAUTH_KV.get(fk)) ?? 0) >= 5) return err("locked", "尝试次数过多，请稍后再试", 429);
      const pw = req.headers.get("X-Owner-Password") ?? "";
      if (!env.OWNER_PASSWORD || !pw || !(await safeEq(pw, env.OWNER_PASSWORD))) {
        await env.OAUTH_KV.put(fk, String(Number((await env.OAUTH_KV.get(fk)) ?? 0) + 1), { expirationTtl: 900 });
        return err("forbidden", "内容库仅限管理员", 403);
      }
      if (p === "/api/adventure/admin/compare" && req.method === "POST") return asJson(await compareContent(env, await req.json().catch(() => null))); // 只读：只返回计数
      if (p === "/api/adventure/admin/pin-legacy" && req.method === "POST") return asJson(await pinLegacySessions(env, await req.json().catch(() => null)));
      if (p === "/api/adventure/admin/default-world") {
        if (req.method === "GET") return asJson(await getDefaultWorld(env));
        if (req.method === "PUT") return asJson(await setDefaultWorld(env, await req.json().catch(() => null)));
      }
      if (p === "/api/adventure/admin/skill-binding" && req.method === "PUT") return asJson(await registerSkillBinding(env, await req.json().catch(() => null))); // 私有绑定登记：不授予、不返回
      if (p === "/api/adventure/admin/dungeon-trigger" && req.method === "PUT") return asJson(await registerDungeonTrigger(env, await req.json().catch(() => null))); // 只登记私有注册表，不授予任何东西
      if (p === "/api/adventure/admin/dungeon-review-mode" && req.method === "PUT") return asJson(await setReviewMode(env, await req.json().catch(() => null)));
      if (p === "/api/adventure/admin/dungeon-review" && req.method === "PUT") return asJson(await attachReview(env, await req.json().catch(() => null)));
      if (p === "/api/adventure/content" && req.method === "PUT") return asJson(await putContent(env, await req.json().catch(() => null)));
      if (p === "/api/adventure/content" && req.method === "GET") return asJson(await listContent(env, url)); // 只返回元数据，正文永不经 HTTP 返回
      return err("not_found", "没有这个接口", 404);
    }
    if (p === "/api/rewards/balance" && req.method === "GET") return asJson(await getBalance(env));
    if (p === "/api/google/status") return json(await googleStatus(env));
    if (p === "/api/google/disconnect" && req.method === "POST") {
      await googleDisconnect(env);
      return json({ ok: true });
    }
    if (p === "/api/mcp" && req.method === "POST") return mcpHandler(req, env);
    return err("not_found", "没有这个接口", 404);
  }
  // 主屏幕图标和 manifest 不用登录也能取（iOS 取图标时不带登录状态）
  if (/^\/(icon-\d+\.png|manifest\.webmanifest)$/.test(p)) {
    const r = await env.ASSETS.fetch(req);
    const hh = new Headers(r.headers); hh.set("Cache-Control", "public, max-age=86400");
    if (p.endsWith(".webmanifest")) hh.set("Content-Type", "application/manifest+json");
    return new Response(r.body, { status: r.status, headers: hh });
  }
  if (!authed)
    return new Response(LOGIN_HTML, {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" },
    });
  if (p === "/auth/google/start" && req.method === "GET") return startAuth(env, url);
  if (p === "/auth/google/callback" && req.method === "GET") return finishAuth(env, url);
  const res = await env.ASSETS.fetch(req);
  const h = new Headers(res.headers);
  h.set("Cache-Control", "no-store");
  h.set("X-Frame-Options", "DENY");
  return new Response(res.body, { status: res.status, headers: h });
}
