// 网站版接入 Google 日历 / Drive（只读）。
// - /auth/google/start、/auth/google/callback：一次性授权，刷新令牌加密后存进 KV
// - googleTool()：提供和 claude.ai 连接器同名的工具，页面代码不用改
//     Google Calendar.list_events
//     Google Drive.search_files / list_recent_files / read_file_content
import type { SiteEnv } from "./site";

export class GErr extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
].join(" ");
const K_REFRESH = "google:refresh";
const K_ACCESS = "google:access";
const K_EMAIL = "google:email";
const TZ = "America/New_York";
const enc = new TextEncoder();
const dec = new TextDecoder();

export const googleConfigured = (env: SiteEnv) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

// ---------- 刷新令牌加密（AES-GCM，密钥由 ADMIN_TOKEN 派生） ----------
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function aesKey(env: SiteEnv) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("google-token:" + env.ADMIN_TOKEN));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env: SiteEnv, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(env), enc.encode(text)));
  return b64(iv) + "." + b64(ct);
}
async function unseal(env: SiteEnv, s: string) {
  const [iv, ct] = s.split(".");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(env), unb64(ct)));
}

// ---------- 授权 ----------
export function startAuth(env: SiteEnv, url: URL): Promise<Response> | Response {
  if (!googleConfigured(env)) return new Response("还没有在 Cloudflare 里设置 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET。", { status: 400 });
  return (async () => {
    const state = [...crypto.getRandomValues(new Uint8Array(24))].map((x) => x.toString(16).padStart(2, "0")).join("");
    await env.OAUTH_KV.put("google:state:" + state, "1", { expirationTtl: 600 });
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: url.origin + "/auth/google/callback",
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
    });
    return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + q, 302);
  })();
}

function page(msg: string, ok: boolean) {
  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Google 连接</title>
<body style="font:16px/1.7 system-ui;max-width:480px;margin:15vh auto;padding:0 20px"><h2>${ok ? "已连接" : "没连上"}</h2><p>${msg}</p><p><a href="/">回到主神空间</a></p>${ok ? '<script>setTimeout(function(){location.href="/"},1500)</script>' : ""}`,
    { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function finishAuth(env: SiteEnv, url: URL): Promise<Response> {
  if (!googleConfigured(env)) return page("还没有设置 Google 密钥。", false);
  const e = url.searchParams.get("error");
  if (e) return page("Google 返回：" + esc(e), false);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!/^[0-9a-f]{48}$/.test(state) || !(await env.OAUTH_KV.get("google:state:" + state))) return page("授权已过期，请回主神空间再点一次「连接 Google」。", false);
  await env.OAUTH_KV.delete("google:state:" + state);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: url.origin + "/auth/google/callback",
      grant_type: "authorization_code",
    }),
  });
  const t = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || !t.refresh_token) return page("换取令牌失败：" + esc(String(t.error_description || t.error || r.status)), false);
  if (!String(t.scope || "").includes("calendar.readonly") || !String(t.scope || "").includes("drive.readonly"))
    return page("授权时没有勾选全部权限（日历和 Drive 都需要）。请重新点「连接 Google」并勾选。", false);
  let email = "";
  try {
    email = JSON.parse(dec.decode(unb64(String(t.id_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(t.id_token).split(".")[1].length / 4) * 4, "=")))).email || "";
  } catch {}
  await env.OAUTH_KV.put(K_REFRESH, await seal(env, t.refresh_token));
  await env.OAUTH_KV.put(K_EMAIL, email);
  if (t.access_token) await env.OAUTH_KV.put(K_ACCESS, t.access_token, { expirationTtl: Math.max(60, Number(t.expires_in || 3600) - 120) });
  return page("已连接 " + esc(email || "你的 Google 账号") + "（只读）。", true);
}

export async function googleStatus(env: SiteEnv) {
  const configured = googleConfigured(env);
  const connected = configured && !!(await env.OAUTH_KV.get(K_REFRESH));
  return { configured, connected, email: connected ? (await env.OAUTH_KV.get(K_EMAIL)) || "" : "" };
}

export async function googleDisconnect(env: SiteEnv) {
  const sealed = await env.OAUTH_KV.get(K_REFRESH);
  if (sealed) {
    try {
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: await unseal(env, sealed) }),
      });
    } catch {}
  }
  await Promise.all([K_REFRESH, K_ACCESS, K_EMAIL].map((k) => env.OAUTH_KV.delete(k)));
}

// ---------- 访问令牌 ----------
async function accessToken(env: SiteEnv, force = false): Promise<string> {
  if (!googleConfigured(env)) throw new GErr("server_not_connected", "Google 还没设置密钥", 400);
  if (!force) {
    const c = await env.OAUTH_KV.get(K_ACCESS);
    if (c) return c;
  }
  const sealed = await env.OAUTH_KV.get(K_REFRESH);
  if (!sealed) throw new GErr("server_not_connected", "还没连接 Google：点页面右上角的「连接 Google」", 400);
  let refresh: string;
  try {
    refresh = await unseal(env, sealed);
  } catch {
    throw new GErr("needs_reauth", "Google 令牌读不出来，请重新连接", 400);
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const t = (await r.json().catch(() => ({}))) as any;
  if (!r.ok || !t.access_token) {
    if (t.error === "invalid_grant") {
      await Promise.all([K_REFRESH, K_ACCESS].map((k) => env.OAUTH_KV.delete(k)));
      throw new GErr("needs_reauth", "Google 授权已失效，请重新点「连接 Google」", 400);
    }
    throw new GErr("upstream_error", "刷新 Google 令牌失败：" + (t.error_description || t.error || r.status), 502);
  }
  await env.OAUTH_KV.put(K_ACCESS, t.access_token, { expirationTtl: Math.max(60, Number(t.expires_in || 3600) - 120) });
  return t.access_token;
}

async function gfetch(env: SiteEnv, url: string): Promise<Response> {
  let r = await fetch(url, { headers: { Authorization: "Bearer " + (await accessToken(env)) } });
  if (r.status === 401) r = await fetch(url, { headers: { Authorization: "Bearer " + (await accessToken(env, true)) } });
  return r;
}
async function gjson(env: SiteEnv, url: string): Promise<any> {
  const r = await gfetch(env, url);
  if (!r.ok) {
    const t = (await r.json().catch(() => ({}))) as any;
    throw new GErr("upstream_error", "Google " + r.status + "：" + String(t?.error?.message || "").slice(0, 160), r.status === 404 ? 404 : 502);
  }
  return r.json();
}

// ---------- 日历 ----------
// 页面传来的时间没有时区（"2026-10-26T00:00:00"），按美东本地时间理解
export function toRfc3339(s: string, tz = TZ): string {
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(s)) return s;
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:[T ](\d\d):(\d\d)(?::(\d\d))?)?/.exec(s);
  if (!m) throw new GErr("bad_request", "时间格式不对：" + s);
  const [y, mo, d, h, mi, se] = [m[1], m[2], m[3], m[4] || "0", m[5] || "0", m[6] || "0"].map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, se);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(guess));
  const g = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asLocal = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return new Date(guess - (asLocal - guess)).toISOString();
}

async function listEvents(env: SiteEnv, input: Record<string, any>) {
  const id = String(input.calendarId || "primary");
  const q = new URLSearchParams({ singleEvents: "true", orderBy: "startTime", timeZone: TZ, maxResults: String(Math.min(Number(input.pageSize) || 250, 500)) });
  if (input.startTime) q.set("timeMin", toRfc3339(String(input.startTime)));
  if (input.endTime) q.set("timeMax", toRfc3339(String(input.endTime)));
  if (input.pageToken) q.set("pageToken", String(input.pageToken));
  const o = await gjson(env, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events?${q}`);
  return { events: o.items || [], nextPageToken: o.nextPageToken };
}

// ---------- Drive ----------
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink";
// 把连接器的查询语法翻成 Drive API：title contains 'x' / parentId = 'id'
export function driveQuery(raw: string): string {
  let q = String(raw || "").replace(/\btitle\s+contains\b/g, "name contains");
  q = q.replace(/parentId\s*=\s*'((?:\\.|[^'\\])*)'/g, "'$1' in parents");
  return q.trim() ? `(${q}) and trashed=false` : "trashed=false";
}
const mapFiles = (o: any) => ({
  files: (o.files || []).map((f: any) => ({ id: f.id, title: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime, size: f.size, webViewLink: f.webViewLink })),
  nextPageToken: o.nextPageToken,
});
async function driveList(env: SiteEnv, q: string, orderBy: string | null, input: Record<string, any>) {
  const p = new URLSearchParams({ q, pageSize: String(Math.min(Number(input.pageSize) || 25, 100)), fields: `nextPageToken,files(${FILE_FIELDS})`, supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  if (orderBy) p.set("orderBy", orderBy);
  if (input.pageToken) p.set("pageToken", String(input.pageToken));
  return mapFiles(await gjson(env, "https://www.googleapis.com/drive/v3/files?" + p));
}

const MAX_BYTES = 15_000_000;
const MAX_TEXT = 1_500_000;
const TEXTY = /^(text\/|application\/(json|xml)$)/;

async function readFile(env: SiteEnv, input: Record<string, any>) {
  const id = String(input.fileId || "");
  if (!/^[\w-]{5,200}$/.test(id)) throw new GErr("bad_request", "fileId 不合法");
  const meta = await gjson(env, `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`);
  const mt: string = meta.mimeType || "";
  const cut = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);
  const fail = (r: Response) => new GErr("upstream_error", "读取失败（" + r.status + "）：文件可能太大或没有权限", 502);

  if (mt.startsWith("application/vnd.google-apps.")) {
    const kind = mt.endsWith(".spreadsheet") ? "text/csv" : mt.endsWith(".document") || mt.endsWith(".presentation") ? "text/plain" : "";
    if (!kind) throw new GErr("unsupported", "这种 Google 文件读不了：" + mt);
    const r = await gfetch(env, `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(kind)}`);
    if (!r.ok) throw fail(r);
    return { fileContent: cut(await r.text()) };
  }
  if (Number(meta.size || 0) > MAX_BYTES) throw new GErr("too_large", "文件超过 15MB，读不了", 413);
  const r = await gfetch(env, `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);
  if (!r.ok) throw fail(r);
  if (TEXTY.test(mt)) return { fileContent: cut(await r.text()) };
  // PDF / Word / PPT / 图片：交给 Cloudflare 的文档转换
  const conv = (env.AI as any)?.toMarkdown;
  if (typeof conv !== "function") throw new GErr("unsupported", "这个环境不能转换 PDF / 图片");
  const out = await (env.AI as any).toMarkdown([{ name: meta.name || "file", blob: new Blob([await r.arrayBuffer()], { type: mt }) }]);
  const first = Array.isArray(out) ? out[0] : out;
  if (!first || first.format === "error") throw new GErr("unsupported", "转换失败：" + String(first?.error || "不支持的格式"));
  return { fileContent: cut(String(first.data || "")) };
}

// ---------- 对外入口 ----------
export async function googleTool(env: SiteEnv, server: string, tool: string, input: Record<string, any>): Promise<unknown> {
  if (server === "Google Calendar" && tool === "list_events") return listEvents(env, input);
  if (server === "Google Drive") {
    if (tool === "search_files") return driveList(env, driveQuery(String(input.query || "")), "modifiedTime desc", input);
    if (tool === "list_recent_files") return driveList(env, "trashed=false", "modifiedTime desc", input);
    if (tool === "read_file_content") return readFile(env, input);
  }
  throw new GErr("tool_error", `没有这个工具：${server}.${tool}`);
}
