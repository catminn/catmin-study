// 本地测试：假 AI 向量 + 假 Vectorize + 假的 Anthropic/OpenAI 流式接口
import base from "./entry";
const realFetch = globalThis.fetch;
function fakeStream(provider: string, text: string) {
  const enc = new TextEncoder();
  const parts = text.match(/.{1,4}/gsu) || [];
  const evs = provider === "anthropic"
    ? [{ type: "message_start", message: { usage: { input_tokens: 1200 } } }, ...parts.map((t) => ({ type: "content_block_delta", delta: { type: "text_delta", text: t } })), { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } }]
    : [...parts.map((t) => ({ choices: [{ delta: { content: t } }] })), { choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 200 } }];
  return new ReadableStream({ start(c) { for (const e of evs) c.enqueue(enc.encode("data: " + JSON.stringify(e) + "\n\n")); if (provider !== "anthropic") c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
}

// ---- 假的 Google：授权、令牌、日历、Drive ----
const jwt = (o: any) => "x." + btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") + ".y";
const gj = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
(globalThis as any).__gcalls = [] as string[];
// 假的课程文件夹：{roots:[folderId], files:{id:{parent,name,mime,modified,size,text|null}}}
(globalThis as any).__drive = { roots: [] as string[], files: {} as Record<string, any> };
(globalThis as any).__lastprompt = "";
function fakeDrive(u: URL): Response | null {
  const D = (globalThis as any).__drive;
  if (u.pathname === "/drive/v3/files") {
    const pm = /'([\w-]+)' in parents/.exec(u.searchParams.get("q") || "");
    if (!pm || !D.roots.includes(pm[1])) return null;
    if (D.listFail) return gj({ error: { message: "rate" } }, 429);
    return gj({ files: Object.entries(D.files).filter(([, f]: any) => f.parent === pm[1]).map(([id, f]: any) => ({ id, name: f.name, mimeType: f.mime, modifiedTime: f.modified, size: String(f.size ?? (f.text || "").length) })) });
  }
  const f = /^\/drive\/v3\/files\/(cf[\w-]+)(\/export)?$/.exec(u.pathname);
  if (!f) return null;
  const file = D.files[f[1]];
  if (!file) return gj({ error: { message: "nf" } }, 404);
  if (f[2]) return file.text == null ? gj({ error: { message: "x" } }, 403) : new Response(file.text);
  if (u.searchParams.get("alt") === "media") return file.text == null ? gj({ error: { message: "denied" } }, 403) : new Response(file.text);
  return gj({ id: f[1], name: file.name, mimeType: file.mime, size: String(file.size ?? (file.text || "").length) });
}
function fakeGoogle(url: string, init?: any): Response | null {
  const u = new URL(url);
  const auth = (init?.headers?.Authorization || init?.headers?.authorization || "") as string;
  if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
    const b = new URLSearchParams(String(init.body));
    (globalThis as any).__gcalls.push("token:" + b.get("grant_type"));
    if (b.get("grant_type") === "authorization_code")
      return b.get("code") === "nocal"
        ? gj({ access_token: "at1", refresh_token: "rt1", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/drive.readonly", id_token: jwt({ email: "cat@gmail.com" }) })
        : gj({ access_token: "at1", refresh_token: "rt1", expires_in: 3600, scope: "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly", id_token: jwt({ email: "cat@gmail.com" }) });
    if (b.get("refresh_token") === "rt1") return gj({ access_token: "at2", expires_in: 3600 });
    return gj({ error: "invalid_grant" }, 400);
  }
  if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") { (globalThis as any).__gcalls.push("revoke"); return gj({}); }
  if (u.host !== "www.googleapis.com") return null;
  (globalThis as any).__gcalls.push(auth + " " + u.pathname + u.search);
  if (!auth.startsWith("Bearer at")) return gj({ error: { message: "no auth" } }, 401);
  if (auth === "Bearer at1" && (globalThis as any).__expire401) return gj({ error: { message: "expired" } }, 401);
  const m = u.pathname;
  const fd = fakeDrive(u); if (fd) return fd;
  if (m.startsWith("/calendar/v3/calendars/")) {
    if (m.includes("missing")) return gj({ error: { message: "Not Found" } }, 404);
    return gj({ items: [{ summary: "MATH 1920 lecture", start: { dateTime: u.searchParams.get("timeMin") }, end: { dateTime: u.searchParams.get("timeMax") }, location: "Olin 155" }] });
  }
  if (m === "/drive/v3/files") {
    return gj({ files: [{ id: "f1", name: "q=" + u.searchParams.get("q") + "|" + u.searchParams.get("orderBy"), mimeType: "application/pdf", modifiedTime: "2026-10-01T00:00:00Z" }, { id: "d1", name: "ENGRI", mimeType: "application/vnd.google-apps.folder" }] });
  }
  const f = /^\/drive\/v3\/files\/([\w-]+)(\/export)?$/.exec(m);
  if (f) {
    const id = f[1];
    if (f[2]) return new Response("导出文本 " + u.searchParams.get("mimeType"));
    if (u.searchParams.get("alt") === "media") return new Response(id === "txt00" ? "纯文本内容" : "%PDF-fake");
    const kinds: Record<string, string> = { doc00: "application/vnd.google-apps.document", sht00: "application/vnd.google-apps.spreadsheet", pdf00: "application/pdf", txt00: "text/plain", big00: "application/pdf", fld00: "application/vnd.google-apps.form" };
    return gj({ id, name: "file-" + id, mimeType: kinds[id] || "application/pdf", size: id === "big00" ? "20000000" : "100" });
  }
  return gj({ error: { message: "unhandled " + m } }, 404);
}
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url;
  const g = fakeGoogle(url, init);
  if (g) return g;
  if (url.startsWith("https://api.anthropic.com/") || url.startsWith("https://api.openai.com/")) {
    const body = JSON.parse(init.body);
    const prov = url.includes("anthropic") ? "anthropic" : "openai";
    const last = body.messages[body.messages.length - 1];
    const lastText = typeof last.content === "string" ? last.content : last.content.map((c: any) => c.text || "").join("");
    const hasImg = typeof last.content !== "string";
    const special: string | null = null;
    const reply = special ?? (lastText.includes("JSON") ? '```json\n{"ok":true,"n":3}\n```' : `你好，这是${prov}的${body.model}回答。${hasImg ? "收到图片。" : ""}`);
    return new Response(fakeStream(prov, reply), { headers: { "content-type": "text/event-stream" } });
  }
  return realFetch(input, init);
}) as typeof fetch;
export default {
  fetch(req: Request, env: any, ctx: ExecutionContext) {
    const u = new URL(req.url);
    if (u.pathname === "/__gcalls") return Response.json((globalThis as any).__gcalls.splice(0));
    if (u.pathname === "/__replyfail") { (globalThis as any).__replyfail = u.searchParams.get("on") === "1"; return new Response("ok"); }
    if (u.pathname === "/__drive") {
      const D = (globalThis as any).__drive, g = (k: string) => u.searchParams.get(k);
      const op = g("op");
      if (op === "root") D.roots.push(g("id"));
      else if (op === "set") D.files[g("id")!] = { parent: g("parent"), name: g("name"), mime: g("mime") || "text/plain", modified: g("modified"), text: g("nulltext") ? null : g("text") ?? "" };
      else if (op === "del") delete D.files[g("id")!];
      else if (op === "listfail") D.listFail = g("on") === "1";
      else if (op === "lastprompt") return new Response((globalThis as any).__lastprompt);
      return Response.json({ ok: true });
    }
    if (u.pathname === "/__expire401") { (globalThis as any).__expire401 = u.searchParams.get("on") === "1"; return new Response("ok"); }
    return (base as any).fetch(req, env, ctx);
  },
};
