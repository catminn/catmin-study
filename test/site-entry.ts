// 本地测试：假 AI 向量 + 假 Vectorize + 假的 Anthropic/OpenAI 流式接口
import base from "./entry";
import { canPrompt, recordPrompt, recordRefusal, suppressExplore } from "../src/director";
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
    const q = (lastText.split("玩家输入：")[1] || "").split("\n")[0].trim();
    let special: string | null = null;
    if (lastText.includes("[[CLASSIFY]]")) {
      const C = (i: string[], c: boolean, r: boolean, e: any, p = false, k: string | null = null, pr = "none", act = "apply-derivative-method") => JSON.stringify({ intents: i, explicitCommit: c, storyResume: r, pauseStory: p, insightKey: k, planRef: pr, conceptId: e ? "math1920.derivative-basics" : null, actionId: act, evaluation: e });
      if (q.includes("BADJSON")) special = "不是json";
      else if (q.includes("出发 s-b")) special = JSON.stringify({ intents: ["EXPLORE"], explicitCommit: false, moveTo: "s-b", actionId: "plain-action", evaluation: null });
      else if (q.includes("前往 s-b")) special = JSON.stringify({ intents: ["ACT"], explicitCommit: true, moveTo: "s-b", actionId: "plain-action", evaluation: null });
      else if (q.includes("前往 s-a")) special = JSON.stringify({ intents: ["ACT"], explicitCommit: true, moveTo: "s-a", actionId: "plain-action", evaluation: null });
      else if (q.includes("谈 ch-one")) special = JSON.stringify({ intents: ["ACT"], explicitCommit: true, choiceId: "ch-one", actionId: "plain-action", evaluation: null });
      else if (q.includes("谈 ch-bad")) special = JSON.stringify({ intents: ["ACT"], explicitCommit: true, choiceId: "ch-bad", actionId: "plain-action", evaluation: null });
      else if (q.includes("完整演示")) special = JSON.stringify({ intents: ["LEARN"], explicitCommit: false, tutorSolution: true, evaluation: null });
      else if (q.includes("换道新题")) special = C(["PRACTICE"], false, false, { correctness: "correct", reasoning: "valid", assistance: "none" }, false, "new-task-insight").replace('"conceptId"', '"newTask":true,"conceptId"');
      else if (q.includes("自己算")) special = JSON.stringify({ intents: ["ASK"], explicitCommit: false, quiet: "on", evaluation: null });
      else if (q.includes("给我提示")) special = JSON.stringify({ intents: ["ASK"], explicitCommit: false, quiet: "off", evaluation: null });
      else if (q.includes("执行方案 A")) special = JSON.stringify({ intents: ["ACT"], explicitCommit: true, planRef: "previous", planIndex: 1, actionId: "apply-derivative-method", evaluation: null });
      else if (q.includes("搬箱子")) special = C(["ACT"], true, false, null, false, null, "inline", "plain-action");
      else if (q.includes("梯度方法执行")) special = C(["ACT"], true, false, null, false, null, "inline", "determine-local-steepest-ascent");
      else if (q.includes("区别")) special = C(["ASK"], false, false, null);
      else if (q.includes("系统讲")) special = C(["LEARN"], false, false, null);
      else if (q.includes("刷5题")) special = C(["PRACTICE"], false, false, null, true);
      else if (q.includes("先不要执行")) special = C(["ASK", "LEARN", "ACT"], false, false, null, false, null, "inline");
      else if (q.includes("继续课程")) special = JSON.stringify({ intents: ["EXPLORE"], explicitCommit: false, storyResume: true, resumeTarget: "lesson", evaluation: null });
      else if (q.includes("回到故事")) special = JSON.stringify({ intents: ["EXPLORE"], explicitCommit: false, storyResume: true, resumeTarget: "story", evaluation: null });
      else if (q.trim() === "继续") special = JSON.stringify({ intents: ["EXPLORE"], explicitCommit: false, storyResume: true, evaluation: null });
      else if (q.includes("继续并执行")) special = C(["ACT"], true, true, null, false, null, "inline");
      else if (q.includes("刚才")) special = C(["ACT"], true, false, null, false, null, "previous");
      else if (q.includes("执行")) special = C(["ACT"], true, false, null, false, null, "inline");
      else if (q.includes("乘 2")) special = C(["PRACTICE"], false, false, { correctness: "correct", reasoning: "invalid", assistance: "none" });
      else if (q.includes("先展开") || q.includes("再说一遍")) special = C(["PRACTICE"], false, false, { correctness: "correct", reasoning: "valid", assistance: "none" }, false, "expand-then-differentiate");
      else if (q.includes("提示后")) special = C(["PRACTICE"], false, false, { correctness: "correct", reasoning: "valid", assistance: "major_hint" });
      else special = C(["EXPLORE"], false, false, null);
    } else if (lastText.includes("[[VERIFY]]")) special = JSON.stringify({ ownAnswer: "2t+2", agree: !q.includes("NOAGREE") });
    if (!special && !lastText.includes("[[") && q.includes("刚才的方法")) special = lastText.includes("思路 expand-then-differentiate") ? "CTXOK" : "CTXMISSING";
    if (!special && (globalThis as any).__replyfail && lastText.includes("你是学习型冒险游戏里的导师兼 DM")) return new Response("boom", { status: 500 });
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
    if (u.pathname === "/__director") {
      const sid = u.searchParams.get("sid")!, topic = u.searchParams.get("topic") || "t", now = Number(u.searchParams.get("now"));
      return (async () => {
        const op = u.searchParams.get("op");
        if (op === "prompt") await recordPrompt(env, sid, topic, now);
        else if (op === "refuse") await recordRefusal(env, sid, topic);
        else if (op === "explore") await suppressExplore(env, sid, now);
        return Response.json(await canPrompt(env, sid, topic, now));
      })();
    }
    if (u.pathname === "/__expire401") { (globalThis as any).__expire401 = u.searchParams.get("on") === "1"; return new Response("ok"); }
    return (base as any).fetch(req, env, ctx);
  },
};
