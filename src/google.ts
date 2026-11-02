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
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");
// 第二个账号（Cornell）只用来往它的 Drive 里存文件
const CORNELL_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.file"].join(" ");
type Acct = "main" | "cornell";
const KK = (acct: Acct) => acct === "main" ? { refresh: "google:refresh", access: "google:access", email: "google:email", scope: "google:scope" } : { refresh: "google:cornell:refresh", access: "google:cornell:access", email: "google:cornell:email", scope: "google:cornell:scope" };
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
    const acct: Acct = url.searchParams.get("acct") === "cornell" ? "cornell" : "main";
    await env.OAUTH_KV.put("google:state:" + state, acct, { expirationTtl: 600 });
    const q = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      redirect_uri: url.origin + "/auth/google/callback",
      response_type: "code",
      scope: acct === "cornell" ? CORNELL_SCOPES : SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
    });
    if (acct === "cornell") { q.set("login_hint", "jm3235@cornell.edu"); q.set("hd", "cornell.edu"); }
    return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + q, 302);
  })();
}

function page(msg: string, ok: boolean) {
  return new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Google 连接</title>
<body style="font:16px/1.7 system-ui;max-width:480px;margin:15vh auto;padding:0 20px"><h2>${ok ? "已连接" : "没连上"}</h2><p>${msg}</p><p><a href="/">回到学习空间</a></p>${ok ? '<script>setTimeout(function(){location.href="/"},1500)</script>' : ""}`,
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
  const acct: Acct = (await env.OAUTH_KV.get("google:state:" + state)) === "cornell" ? "cornell" : "main";
  if (!/^[0-9a-f]{48}$/.test(state) || !(await env.OAUTH_KV.get("google:state:" + state))) return page("授权已过期，请回学习空间再点一次「连接 Google」。", false);
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
  if (acct === "cornell" && !String(t.scope || "").includes("drive.file")) return page("Cornell 账号没有给存文件的权限，文件会改存到个人 Drive。", false);
  if (acct === "main" && (!String(t.scope || "").includes("calendar.readonly") || !String(t.scope || "").includes("drive.readonly")))
    return page("授权时没有勾选全部权限（日历和 Drive 都需要）。请重新点「连接 Google」并勾选。", false);
  let email = "";
  try {
    email = JSON.parse(dec.decode(unb64(String(t.id_token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(t.id_token).split(".")[1].length / 4) * 4, "=")))).email || "";
  } catch {}
  const k = KK(acct);
  await env.OAUTH_KV.put(k.refresh, await seal(env, t.refresh_token));
  await env.OAUTH_KV.put(k.email, email);
  await env.OAUTH_KV.put(k.scope, String(t.scope || ""));
  if (t.access_token) await env.OAUTH_KV.put(k.access, t.access_token, { expirationTtl: Math.max(60, Number(t.expires_in || 3600) - 120) });
  return page(acct === "cornell" ? "已连接 " + esc(email || "Cornell 账号") + "，以后交给零的文件会存进这个账号的 Drive。" : "已连接 " + esc(email || "你的 Google 账号") + "。", true);
}

export async function googleStatus(env: SiteEnv) {
  const configured = googleConfigured(env);
  const connected = configured && !!(await env.OAUTH_KV.get(K_REFRESH));
  const scope = (await env.OAUTH_KV.get("google:scope")) || "";
  const cornell = configured && !!(await env.OAUTH_KV.get("google:cornell:refresh"));
  return { configured, connected, email: connected ? (await env.OAUTH_KV.get(K_EMAIL)) || "" : "",
    needsUpgrade: connected && !(scope.includes("calendar.events") && scope.includes("drive.file")),
    cornell, cornellEmail: cornell ? (await env.OAUTH_KV.get("google:cornell:email")) || "" : "" };
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
  await Promise.all([K_REFRESH, K_ACCESS, K_EMAIL, "google:scope"].map((k) => env.OAUTH_KV.delete(k)));
}

// ---------- 访问令牌 ----------
async function accessToken(env: SiteEnv, force = false, acct: Acct = "main"): Promise<string> {
  if (!googleConfigured(env)) throw new GErr("server_not_connected", "Google 还没设置密钥", 400);
  const k = KK(acct);
  if (!force) {
    const c = await env.OAUTH_KV.get(k.access);
    if (c) return c;
  }
  const sealed = await env.OAUTH_KV.get(k.refresh);
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
      await Promise.all([k.refresh, k.access].map((x) => env.OAUTH_KV.delete(x)));
      throw new GErr("needs_reauth", "Google 授权已失效，请重新点「连接 Google」", 400);
    }
    throw new GErr("upstream_error", "刷新 Google 令牌失败：" + (t.error_description || t.error || r.status), 502);
  }
  await env.OAUTH_KV.put(k.access, t.access_token, { expirationTtl: Math.max(60, Number(t.expires_in || 3600) - 120) });
  return t.access_token;
}

async function gfetch(env: SiteEnv, url: string, init: RequestInit = {}, acct: Acct = "main"): Promise<Response> {
  const go = async (force: boolean) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string> || {}), Authorization: "Bearer " + (await accessToken(env, force, acct)) } });
  let r = await go(false);
  if (r.status === 401) r = await go(true);
  return r;
}
async function gjson(env: SiteEnv, url: string, init: RequestInit = {}, acct: Acct = "main"): Promise<any> {
  const r = await gfetch(env, url, init, acct);
  if (r.status === 204) return {};
  if (!r.ok) {
    const t = (await r.json().catch(() => ({}))) as any;
    if (r.status === 403 && /insufficient|scope/i.test(String(t?.error?.message || "") + JSON.stringify(t?.error?.details || "")))
      throw new GErr("needs_reauth", "Google 日历还没有写入权限：点「连接 Google」重新授权一次", 403);
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

// 学习空间自己加的待办写进 Google 日历（只动她自己的主日历）
function evBody(input: Record<string, any>) {
  const b: Record<string, any> = {};
  if (input.summary != null) b.summary = String(input.summary).slice(0, 200);
  if (input.description != null) b.description = String(input.description).slice(0, 2000);
  if (input.allDay && input.startTime) {
    const d = String(input.startTime).slice(0, 10), e = String(input.endTime || input.startTime).slice(0, 10);
    b.start = { date: d }; b.end = { date: e > d ? e : new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10) };
  } else {
    if (input.startTime) b.start = { dateTime: toRfc3339(String(input.startTime)), timeZone: TZ };
    if (input.endTime) b.end = { dateTime: toRfc3339(String(input.endTime)), timeZone: TZ };
  }
  if (Array.isArray(input.overrideReminders)) b.reminders = { useDefault: false, overrides: input.overrideReminders.slice(0, 5).map((x: any) => ({ method: x.method === "email" ? "email" : "popup", minutes: Math.max(0, Number(x.minutes) || 0) })) };
  if (input.availability === "AVAILABILITY_FREE") b.transparency = "transparent";
  if (input.colorId) b.colorId = String(input.colorId);
  return b;
}
const evUrl = (id: string, ev = "") => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events${ev ? "/" + encodeURIComponent(ev) : ""}`;
async function createEvent(env: SiteEnv, input: Record<string, any>) {
  if (!input.summary || !input.startTime || !input.endTime) throw new GErr("bad_request", "需要 summary、startTime、endTime");
  return gjson(env, evUrl(String(input.calendarId || "primary")), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evBody(input)) });
}
async function updateEvent(env: SiteEnv, input: Record<string, any>) {
  if (!input.eventId) throw new GErr("bad_request", "需要 eventId");
  return gjson(env, evUrl(String(input.calendarId || "primary"), String(input.eventId)), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(evBody(input)) });
}
async function deleteEvent(env: SiteEnv, input: Record<string, any>) {
  if (!input.eventId) throw new GErr("bad_request", "需要 eventId");
  try { await gjson(env, evUrl(String(input.calendarId || "primary"), String(input.eventId)), { method: "DELETE" }); }
  catch (e) { if (!(e instanceof GErr && /Google 410|Google 404/.test(e.message))) throw e; }
  return { deleted: true };
}

// ---------- 往 Drive 里存文件（Cornell 账号连上了就存那边，否则存个人账号） ----------
// 文件只存 Cornell 账号的 Drive；没连上就不存（不再退回个人 Drive）
async function uploadAcct(env: SiteEnv): Promise<Acct> { if (await env.OAUTH_KV.get("google:cornell:refresh")) return "cornell"; throw new GErr("no_cornell", "还没连 Cornell Drive，文件没有上传。点页面顶上的「连 Cornell Drive」"); }
const qEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function ensureFolder(env: SiteEnv, acct: Acct, path: string[]): Promise<string> {
  let parent = "root";
  for (const raw of path) {
    const name = String(raw).replace(/[\\/]/g, " ").trim().slice(0, 80) || "未命名";
    const ck = `gdrive:${acct}:folder:${parent}:${name}`;
    const hit = await env.OAUTH_KV.get(ck);
    if (hit) { parent = hit; continue; }
    const q = new URLSearchParams({ q: `name='${qEsc(name)}' and mimeType='application/vnd.google-apps.folder' and '${parent}' in parents and trashed=false`, fields: "files(id)", pageSize: "1" });
    const found = await gjson(env, "https://www.googleapis.com/drive/v3/files?" + q, {}, acct);
    let id = found.files?.[0]?.id;
    if (!id) {
      const made = await gjson(env, "https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) }, acct);
      id = made.id;
    }
    await env.OAUTH_KV.put(ck, id, { expirationTtl: 30 * 86400 });
    parent = id;
  }
  return parent;
}
async function uploadFile(env: SiteEnv, input: Record<string, any>) {
  const name = String(input.name || "").replace(/[\\/]/g, "_").slice(0, 200);
  const data = String(input.dataBase64 || "");
  if (!name || !data) throw new GErr("bad_request", "需要 name 和 dataBase64");
  const bytes = unb64(data);
  if (bytes.length > 25 * 1024 * 1024) throw new GErr("bad_request", "文件太大（超过 25MB）");
  const acct = await uploadAcct(env);
  const folder = await ensureFolder(env, acct, Array.isArray(input.folderPath) ? input.folderPath.slice(0, 4) : ["Cornell"]);
  const q = new URLSearchParams({ q: `name='${qEsc(name)}' and '${folder}' in parents and trashed=false`, fields: "files(id,size,webViewLink)", pageSize: "5" });
  const same = (await gjson(env, "https://www.googleapis.com/drive/v3/files?" + q, {}, acct)).files || [];
  const dup = same.find((f: any) => Number(f.size) === bytes.length);
  if (dup) return { id: dup.id, webViewLink: dup.webViewLink, duplicate: true, account: acct };
  const mime = String(input.mimeType || "application/octet-stream");
  const boundary = "xk" + crypto.randomUUID().replace(/-/g, "");
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder] })}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const r = await gjson(env, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body }, acct);
  return { id: r.id, webViewLink: r.webViewLink, account: acct };
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
  if (server === "Google Calendar" && tool === "create_event") return createEvent(env, input);
  if (server === "Google Calendar" && tool === "update_event") return updateEvent(env, input);
  if (server === "Google Calendar" && tool === "delete_event") return deleteEvent(env, input);
  if (server === "Google Drive" && tool === "upload_file") return uploadFile(env, input);
  if (server === "Google Drive") {
    if (tool === "search_files") return driveList(env, driveQuery(String(input.query || "")), "modifiedTime desc", input);
    if (tool === "list_recent_files") return driveList(env, "trashed=false", "modifiedTime desc", input);
    if (tool === "read_file_content") return readFile(env, input);
  }
  throw new GErr("tool_error", `没有这个工具：${server}.${tool}`);
}
