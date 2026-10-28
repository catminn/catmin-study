// study.catmin.io：主神空间网站版的后端
// - 登录：用共享记忆的同一个口令，签发 30 天的会话 cookie
// - /api/db：存档读写（和主神空间 artifact 云端同步用同一张 study_state 表）
// - /api/ai：代调 Anthropic / OpenAI，流式返回，带每日/每月花费上限
// - /api/mcp：共享记忆工具直接在这里执行；Google 日历/Drive 见 google.ts（只读，需要在页面上点一次「连接 Google」）
import type { Env } from "./store";
import { TOOL_MAP } from "./tools";
import { handleTurn } from "./turn";
import { putContent, listContent } from "./content";
import { getSession, postAction, sessionOp } from "./adventure";
import { getBalance, listEvents, postEvent, postReward } from "./events";
import { GErr, finishAuth, googleDisconnect, googleStatus, googleTool, startAuth } from "./google";

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
<title>主神空间</title><meta name="robots" content="noindex">
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
<form id="f"><h1>主神空间</h1><p>输入共享记忆的口令。</p>
<input id="pw" type="password" autocomplete="current-password" autofocus aria-label="口令">
<button>进入</button><div class="err" id="e" role="alert"></div></form>
<script>
document.getElementById("f").onsubmit=async e=>{e.preventDefault();const el=document.getElementById("e");el.textContent="";
  const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("pw").value})});
  if(r.ok)location.reload();else{const o=await r.json().catch(()=>({}));el.textContent=o.message||"进不去，稍后再试。"}};
</script>`;

// ---------- 花费 ----------
const day = () => new Date().toISOString().slice(0, 10);
async function spent(env: SiteEnv) {
  const d = day();
  const m = d.slice(0, 7);
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN day=? THEN cost_usd END),0) AS today, COALESCE(SUM(CASE WHEN substr(day,1,7)=? THEN cost_usd END),0) AS month FROM api_usage",
  )
    .bind(d, m)
    .first<{ today: number; month: number }>();
  return { today: r?.today ?? 0, month: r?.month ?? 0 };
}
function limits(env: SiteEnv) {
  return { daily: Number(env.DAILY_LIMIT_USD || 1), monthly: Number(env.MONTHLY_LIMIT_USD || 10) };
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
type Img = { media_type: string; data: string };
type Msg = { role: "user" | "assistant"; content: string };
interface AiReq {
  messages: Msg[];
  model?: string;
  provider?: string;
  tier?: string;
  images?: Img[];
  max_tokens?: number;
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
    const content = msgs.map((m, idx) => {
      if (idx === msgs.length - 1 && m.role === "user" && imgs.length)
        return {
          role: m.role,
          content: [
            ...imgs.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
            { type: "text", text: m.content },
          ],
        };
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
        if (ev.type === "message_start") inTok = ev.message?.usage?.input_tokens ?? 0;
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
          if (ev.type === "message_start") inTok = ev.message?.usage?.input_tokens ?? 0;
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
    if (text.length > 1_800_000) return err("too_large", "存档太大", 413);
    try {
      JSON.parse(text);
    } catch {
      return err("bad_request", "不是 JSON");
    }
    const t = Date.now() / 1000;
    await env.DB.prepare(
      `INSERT INTO study_state (key,value,version,updated_at,updated_by) VALUES (?,?,1,?,'site')
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, version=study_state.version+1, updated_at=excluded.updated_at, updated_by='site'`,
    )
      .bind(key, text, t)
      .run();
    return json({ ok: true });
  }
  return err("bad_request", "只支持 GET / PUT", 405);
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
  const day = new Date().toISOString().slice(0, 10);
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


const PRIVACY_HTML = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隐私政策 · 主神空间</title>
<style>body{font:16px/1.8 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:680px;margin:6vh auto;padding:0 20px;color:#1b1f3b}h1{font-size:26px}h2{font-size:18px;margin-top:1.6em}a{color:#4a5bd0}</style></head><body>
<h1>主神空间 隐私政策</h1>
<p>最后更新：2026-10-27</p>
<p>主神空间（study.catmin.io）是 Catherine Min 个人使用的学习工具，不对公众开放，没有其他用户。</p>
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
<hr><p lang="en"><b>Privacy Policy (English summary).</b> “主神空间” (study.catmin.io) is a personal study tool used only by its owner, Catherine Min. With her consent it reads her Google Calendar events and chosen Google Drive files in read-only mode (calendar.readonly, drive.readonly) solely to display them to her and to answer her own requests. Tokens are stored encrypted. Data is not sold, shared or disclosed to third parties, except the AI providers she chooses (Anthropic, OpenAI) for requests she initiates. Use of Google user data complies with the Google API Services User Data Policy, including the Limited Use requirements. Access can be revoked at any time from the site or at myaccount.google.com/permissions. Contact: jm3235@cornell.edu</p>
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
    }
    if (p === "/api/logout")
      return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
    if (p === "/api/ai" && req.method === "POST") return aiHandler(req, env, ctx);
    if (p === "/api/ai/status") return aiStatus(env);
    if (p === "/api/db") return dbHandler(req, env, url);
    if (p === "/api/export" && req.method === "GET") return exportHandler(env);
    if (p === "/api/events" && req.method === "POST") return asJson(await postEvent(env, await req.json().catch(() => null)));
    if (p === "/api/events" && req.method === "GET") return asJson(await listEvents(env, url));
    if (p === "/api/rewards" && req.method === "POST") return asJson(await postReward(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/turn" && req.method === "POST")
      return asJson(await handleTurn(env, await req.json().catch(() => null), { budgetOk: () => budgetOk(env), complete: (t, pr, x, m) => completeOnce(env, t, pr, x, m) }));
    if (p === "/api/adventure/action" && req.method === "POST") return asJson(await postAction(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/session" && req.method === "POST") return asJson(await sessionOp(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/session" && req.method === "GET") return asJson(await getSession(env, url.searchParams.get("id") || ""));
    if (p === "/api/adventure/content" && req.method === "PUT") return asJson(await putContent(env, await req.json().catch(() => null)));
    if (p === "/api/adventure/content" && req.method === "GET") return asJson(await listContent(env, url));
    if (p === "/api/rewards/balance" && req.method === "GET") return asJson(await getBalance(env));
    if (p === "/api/google/status") return json(await googleStatus(env));
    if (p === "/api/google/disconnect" && req.method === "POST") {
      await googleDisconnect(env);
      return json({ ok: true });
    }
    if (p === "/api/mcp" && req.method === "POST") return mcpHandler(req, env);
    return err("not_found", "没有这个接口", 404);
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
