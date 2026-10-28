// 入口：OAuth 保护的 /mcp + 授权页 + 管理接口
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { authorize } from "./auth";
import { mcpFetch } from "./mcp";
import { type Env as BaseEnv, getByHash, insertMemory, normTags, reindexMissing } from "./store";
import { type SiteEnv, siteFetch } from "./site";
import { syncAllCourses } from "./coursesync";

export type Env = BaseEnv & SiteEnv & { PUBLIC_URL: string; SITE_HOST?: string };

async function adminAuthorized(request: Request, env: Env) {
  const h = request.headers.get("Authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!env.ADMIN_TOKEN || token.length < 16) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(token)),
    crypto.subtle.digest("SHA-256", enc.encode(env.ADMIN_TOKEN)),
  ]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// 导入 mcp-memory-service 的 memory_list 导出（保留原 hash 和时间）
async function importMemories(request: Request, env: Env) {
  const body = (await request.json()) as { memories?: any[] };
  const list = Array.isArray(body.memories) ? body.memories : [];
  let added = 0, skipped = 0;
  for (const x of list) {
    if (!x?.content || !x?.content_hash) { skipped++; continue; }
    if (await getByHash(env, x.content_hash)) { skipped++; continue; }
    const meta = { ...(x.metadata ?? {}) };
    delete meta.access_queries; // 只是检索日志，不迁
    await insertMemory(
      env,
      {
        content_hash: String(x.content_hash),
        content: String(x.content),
        tags: normTags(x.tags),
        memory_type: String(x.memory_type || "note"),
        metadata: meta,
        agent_id: x.agent_id ?? null,
        created_at: Number(x.created_at) || Date.now() / 1000,
        updated_at: Number(x.updated_at) || Number(x.created_at) || Date.now() / 1000,
      },
      { embedNow: false },
    );
    added++;
  }
  return Response.json({ added, skipped, next: "POST /admin/reindex 生成向量" });
}

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/authorize") return authorize(request, env as any);
    if (url.pathname.startsWith("/admin/")) {
      if (request.method !== "POST" || !(await adminAuthorized(request, env))) return new Response("Forbidden", { status: 403 });
      if (url.pathname === "/admin/import") return importMemories(request, env);
      if (url.pathname === "/admin/reindex") return Response.json(await reindexMissing(env, 200));
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/") return new Response("共享记忆 · MCP 地址是 /mcp", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    return new Response("Not found", { status: 404 });
  },
};

// 资源地址取决于部署到哪个域名，所以按 PUBLIC_URL 构造并缓存
let cached: { url: string; provider: OAuthProvider<Env> } | null = null;
function providerFor(env: Env) {
  const base = (env.PUBLIC_URL || "").replace(/\/+$/, "");
  if (cached?.url === base) return cached.provider;
  const provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { fetch: (req, e) => mcpFetch(req, e as Env) },
    defaultHandler,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["memory"],
    resourceMetadata: {
      resource: base + "/mcp",
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
      resource_name: "共享记忆",
    },
    accessTokenTTL: 3600,
    refreshTokenTTL: 180 * 86400, // 半年
    refreshTokenIdleTTL: 60 * 86400, // 60 天不用才过期
    clientRegistrationTTL: 365 * 86400,
    clientIdMetadataDocumentEnabled: true,
  });
  cached = { url: base, provider };
  return provider;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    // study.catmin.io 是网站；其余域名（memory.catmin.io）是共享记忆 MCP
    if (env.SITE_HOST && new URL(request.url).host === env.SITE_HOST) return siteFetch(request, env, ctx);
    return providerFor(env).fetch(request, env, ctx);
  },
  // 定时任务：课程资料同步（见 wrangler.jsonc 的 triggers.crons）
  async scheduled(_ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(syncAllCourses(env).catch(() => null));
  },
} satisfies ExportedHandler<Env>;
