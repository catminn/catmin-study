// 极简 MCP（Streamable HTTP，无状态）：只实现 initialize / tools/list / tools/call / ping。
// 每个请求独立处理，不需要 Durable Object，也不保存会话。
import type { Env } from "./store";
import { TOOLS, TOOL_MAP } from "./tools";

const SUPPORTED = ["2025-03-26", "2025-06-18", "2025-11-25", "2026-07-28"];
const LATEST = SUPPORTED[SUPPORTED.length - 1];

type RpcMsg = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };

const ok = (id: RpcMsg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const err = (id: RpcMsg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handle(env: Env, msg: RpcMsg) {
  const id = msg.id;
  switch (msg.method) {
    case "initialize": {
      const asked = msg.params?.protocolVersion;
      return ok(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "catmin-memory", title: "共享记忆", version: "2.0.0" },
        instructions:
          "Catherine 的共享记忆（Claude 与 ChatGPT 共用）。用 memory_search 检索，memory_store 保存，mistake_note_* 管理错题。",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
      });
    case "tools/call": {
      const tool = TOOL_MAP.get(msg.params?.name);
      if (!tool) return err(id, -32602, "Unknown tool: " + msg.params?.name);
      try {
        const text = await tool.run(env, msg.params?.arguments ?? {});
        return ok(id, { content: [{ type: "text", text }] });
      } catch (e: any) {
        return ok(id, { content: [{ type: "text", text: "Error: " + (e?.message ?? String(e)) }], isError: true });
      }
    }
    default:
      if (msg.method?.startsWith("notifications/")) return null; // 通知不需要回复
      return err(id, -32601, "Method not found: " + msg.method);
  }
}

export async function mcpFetch(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") return new Response("SSE stream not supported (stateless server)", { status: 405, headers: { Allow: "POST" } });
  if (request.method === "DELETE") return new Response(null, { status: 204 });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  let body: RpcMsg | RpcMsg[];
  try {
    body = await request.json();
  } catch {
    return Response.json(err(null, -32700, "Parse error"), { status: 400 });
  }
  const msgs = Array.isArray(body) ? body : [body];
  const replies = (await Promise.all(msgs.map((m) => handle(env, m)))).filter(Boolean);
  if (!replies.length) return new Response(null, { status: 202 });
  return Response.json(Array.isArray(body) ? replies : replies[0], {
    headers: { "Cache-Control": "no-store" },
  });
}
