// /authorize：Claude、ChatGPT 第一次连接时打开的授权页。只有知道口令的人（你）能批准。
import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "./store";

type AuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const USER_ID = "catherine";

function page(d: ConsentDescription, handle: string, error = ""): string {
  const name = esc(d.clientName || "未知应用");
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>授权访问共享记忆</title>
<style>
:root{color-scheme:light dark}
body{font:16px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:420px;margin:12vh auto;padding:0 16px}
h1{font-size:20px}.box{border:1px solid #8884;border-radius:12px;padding:16px}
input{width:100%;box-sizing:border-box;padding:10px;font-size:16px;border-radius:8px;border:1px solid #8886}
button{padding:10px 18px;font-size:16px;border-radius:8px;border:0;margin-right:8px;cursor:pointer}
.go{background:#c4861a;color:#fff}.err{color:#c93a3a}.dim{opacity:.7;font-size:14px}
</style>
<h1>${name} 想访问你的共享记忆</h1>
<div class="box">
<p class="dim">${d.clientDomain ? `发布者：<b>${esc(d.clientDomain)}</b>` : "这个应用的名字是它自己填的，未经验证。"}<br>
授权会发送到：<b>${esc(d.redirectHost)}</b></p>
${d.redirectIsLoopback ? "<p class=err><b>授权会发给你电脑上的程序。</b>只有你刚刚自己发起了连接才继续。</p>" : ""}
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post">
<input type="hidden" name="handle" value="${esc(handle)}">
<p><input type="password" name="password" placeholder="口令" autocomplete="current-password" autofocus></p>
<p><button class="go" name="decision" value="approve">允许</button><button name="decision" value="deny">拒绝</button></p>
</form></div>`;
}

const html = (body: string, headers?: Headers, status = 200) => {
  const h = headers ?? new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("X-Frame-Options", "DENY");
  h.set("Content-Security-Policy", "frame-ancestors 'none'");
  return new Response(body, { status, headers: h });
};

async function safeEqual(a: string, b: string) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const ua = new Uint8Array(x), ub = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
  return diff === 0 && a.length > 0;
}

// 口令输错限流：每个 IP 15 分钟内最多 5 次
async function tooManyFailures(env: Env, ip: string) {
  const n = Number((await env.OAUTH_KV.get("pwfail:" + ip)) ?? 0);
  return n >= 5;
}
async function recordFailure(env: Env, ip: string) {
  const k = "pwfail:" + ip;
  const n = Number((await env.OAUTH_KV.get(k)) ?? 0) + 1;
  await env.OAUTH_KV.put(k, String(n), { expirationTtl: 900 });
}

export async function authorize(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const req = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(req);
      const consent = await oauth.beginConsent(req);
      // 把页面需要的说明存起来，POST 输错口令时重新显示
      await env.OAUTH_KV.put("consentdesc:" + consent.handle, JSON.stringify(details), { expirationTtl: 600 });
      return html(page(details, consent.handle), consent.headers);
    }
    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const details = JSON.parse((await env.OAUTH_KV.get("consentdesc:" + handle)) ?? "null") as ConsentDescription | null;
      if (await tooManyFailures(env, ip)) {
        return html("<p>口令错误次数太多，请 15 分钟后再试。</p>", undefined, 429);
      }
      if (!(await safeEqual(String(form.get("password") ?? ""), env.OWNER_PASSWORD ?? ""))) {
        await recordFailure(env, ip);
        if (!details) return html("<p>页面已过期，请回到应用里重新连接。</p>", undefined, 400);
        return html(page(details, handle, "口令不对"), undefined, 401);
      }
      const approved = await oauth.approveConsent(request, handle, { scope: details?.scope ?? [] });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: USER_ID,
        metadata: { approvedAt: new Date().toISOString() },
        scope: approved.request.scope,
        props: { userId: USER_ID },
      });
      await env.OAUTH_KV.delete("consentdesc:" + handle);
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && (error as any).redirectTo)
      return Response.redirect((error as any).redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const msg = error instanceof AuthorizationError ? (error as any).description ?? "授权请求无效" : "无法验证这个应用。";
      return html(`<p>${esc(String(msg))}</p><p>请回到应用里重新连接。</p>`, undefined, 400);
    }
    throw error;
  }
}
