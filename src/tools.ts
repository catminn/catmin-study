// MCP 工具：名字和参数与原来的 mcp-memory-service 保持一致，
// 这样 claude.ai、ChatGPT 和主神空间都不用改调用方式。
import {
  type Env,
  type Filter,
  type Memory,
  deleteByHashes,
  embed,
  exactSearch,
  getByHash,
  insertMemory,
  listMemories,
  normTags,
  semanticSearch,
  sha256,
  updateMemoryRow,
} from "./store";
import { isoToSec, parseTimeExpr } from "./timeexpr";

type Args = Record<string, any>;
type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  run: (env: Env, a: Args) => Promise<string>;
};

const tagsSchema = {
  oneOf: [
    { type: "array", items: { type: "string" }, description: "Tags as an array of strings" },
    { type: "string", description: "Tags as comma-separated string" },
  ],
};

const iso = (sec: number) => new Date(sec * 1000).toISOString();
const now = () => Date.now() / 1000;

function memJSON(m: Memory) {
  return {
    content: m.content,
    content_hash: m.content_hash,
    tags: m.tags,
    memory_type: m.memory_type,
    metadata: m.metadata,
    created_at: m.created_at,
    updated_at: m.updated_at,
    created_at_iso: iso(m.created_at),
    updated_at_iso: iso(m.updated_at),
    agent_id: m.agent_id,
  };
}

// 与原服务一致的文本格式（主神空间会去掉 "Hash:" 行）
function formatSearch(results: { memory: Memory }[], mode: string, query: string | undefined, maxChars?: number) {
  const head = `Found ${results.length} memories (mode: ${mode})${query ? ` for query: '${query}'` : ""}\n`;
  let out = head;
  results.forEach(({ memory: m }, i) => {
    const block =
      `\n=== Memory ${i + 1} ===\nTimestamp: ${iso(m.created_at)}\nContent: ${m.content}\nHash: ${m.content_hash}\n` +
      (m.tags.length ? `Tags: ${m.tags.join(", ")}\n` : "") +
      "---";
    if (maxChars && out.length + block.length > maxChars && i > 0) return;
    out += block;
  });
  if (!results.length) out = `No memories found (mode: ${mode})${query ? ` for query: '${query}'` : ""}`;
  return out;
}

function filterFrom(a: Args): Filter {
  const f: Filter = {};
  const tags = normTags(a.tags);
  if (tags.length) {
    f.tags = tags;
    f.tagMatch = a.tag_match === "all" ? "all" : "any";
  }
  if (a.time_expr) {
    const r = parseTimeExpr(String(a.time_expr));
    if (r) Object.assign(f, r);
  }
  const after = isoToSec(a.after);
  const before = isoToSec(a.before);
  if (after != null) f.after = after;
  if (before != null) f.before = before;
  if (a.agent_id) f.agentId = String(a.agent_id);
  return f;
}

function parseMistake(content: string) {
  const get = (k: string) => {
    const m = content.match(new RegExp(`^${k}: ([\\s\\S]*?)(?=\\n(?:Pattern|Context|Wrong|Right): |$)`, "m"));
    return m ? m[1] : "";
  };
  return { error_pattern: get("Pattern"), context_signature: get("Context"), incorrect_action: get("Wrong"), correct_action: get("Right") };
}
const mistakeContent = (p: ReturnType<typeof parseMistake>) =>
  `Pattern: ${p.error_pattern}\nContext: ${p.context_signature}\nWrong: ${p.incorrect_action}\nRight: ${p.correct_action}`;

export const TOOLS: Tool[] = [
  {
    name: "memory_search",
    description:
      "Search memories with flexible modes and filters. Primary tool for finding stored information. " +
      "Modes: semantic (default, multilingual), exact (substring), hybrid (same as semantic here). " +
      "Filters: time_expr ('yesterday', 'last week', '3 days ago', '昨天', '上周'), after/before (YYYY-MM-DD), tags.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (required for semantic/exact modes, optional for time-only searches)" },
        mode: { type: "string", enum: ["semantic", "exact", "hybrid", "ranked"], default: "semantic" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
        time_expr: { type: "string", description: "Natural language time filter" },
        after: { type: "string", description: "Created after (YYYY-MM-DD)" },
        before: { type: "string", description: "Created before (YYYY-MM-DD)" },
        tags: { ...tagsSchema, description: "Filter to memories with any of these tags" },
        tag_match: { type: "string", enum: ["any", "all"], default: "any" },
        agent_id: { type: "string" },
        max_response_chars: { type: "number", description: "Maximum response size in characters" },
      },
    },
    annotations: { readOnlyHint: true },
    async run(env, a) {
      const limit = Math.min(100, Math.max(1, Number(a.limit) || 10));
      const mode = ["exact", "semantic", "hybrid", "ranked"].includes(a.mode) ? a.mode : "semantic";
      const f = filterFrom(a);
      const q = a.query ? String(a.query) : "";
      let results: { memory: Memory; score: number }[];
      if (!q) {
        const r = await listMemories(env, f, limit, 0);
        results = r.items.map((m) => ({ memory: m, score: 1 }));
      } else if (mode === "exact") {
        results = await exactSearch(env, q, f, limit);
      } else {
        // 和原服务一样：普通记忆和错题一起搜，按相似度合并
        const [vec] = await embed(env, [q]);
        const [a1, a2] = await Promise.all([
          semanticSearch(env, q, "memory", f, limit, vec),
          semanticSearch(env, q, "mistake", f, limit, vec),
        ]);
        results = [...a1, ...a2].sort((x, y) => y.score - x.score).slice(0, limit);
      }
      return formatSearch(results, mode, q || undefined, a.max_response_chars ? Number(a.max_response_chars) : undefined);
    },
  },
  {
    name: "memory_store",
    description:
      "Store new information with optional tags. metadata.tags accepts an array or a comma-separated string; metadata.type sets the memory type. " +
      "Use conversation_id to bypass near-duplicate detection for incremental notes.",
    inputSchema: {
      type: "object",
      required: ["content"],
      properties: {
        content: { type: "string", description: "The memory content to store" },
        metadata: {
          type: "object",
          properties: { tags: tagsSchema, type: { type: "string", description: "Memory type, e.g. note, reference, decision, observation" } },
        },
        conversation_id: { type: "string" },
        agent_id: { type: "string" },
      },
    },
    async run(env, a) {
      const content = String(a.content ?? "").trim();
      if (!content) throw new Error("content is required");
      const hash = await sha256(content);
      if (await getByHash(env, hash)) return JSON.stringify({ success: false, message: "Duplicate content: an identical memory already exists", content_hash: hash });
      const meta: Record<string, unknown> = { ...(a.metadata ?? {}) };
      const tags = normTags(meta.tags);
      const type = typeof meta.type === "string" && meta.type ? meta.type : "note";
      delete meta.tags;
      delete meta.type;
      if (a.conversation_id) meta.conversation_id = String(a.conversation_id);
      if (a.agent_id) meta.agent_id = String(a.agent_id);
      // 近似重复检测（没有 conversation_id 时）
      if (!a.conversation_id) {
        try {
          const near = await semanticSearch(env, content, "memory", {}, 1);
          if (near[0] && near[0].score >= 0.985)
            return JSON.stringify({ success: false, message: "Near-duplicate of an existing memory; not stored", content_hash: near[0].memory.content_hash });
        } catch {}
      }
      const t = now();
      await insertMemory(env, {
        content_hash: hash,
        content,
        tags,
        memory_type: type,
        metadata: meta,
        agent_id: a.agent_id ? String(a.agent_id) : null,
        created_at: t,
        updated_at: t,
      });
      return JSON.stringify({ success: true, message: "Memory stored successfully", content_hash: hash });
    },
  },
  {
    name: "memory_list",
    description: "List and browse memories with pagination and optional filters (tags, memory_type).",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "integer", minimum: 1, default: 1 },
        page_size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        tags: { type: "array", items: { type: "string" } },
        tag_match: { type: "string", enum: ["any", "all"], default: "any" },
        memory_type: { type: "string" },
        agent_id: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true },
    async run(env, a) {
      const page = Math.max(1, Number(a.page) || 1);
      const size = Math.min(100, Math.max(1, Number(a.page_size) || 20));
      const f = filterFrom(a);
      if (a.memory_type) f.type = String(a.memory_type);
      const r = await listMemories(env, f, size, (page - 1) * size);
      const pages = Math.ceil(r.total / size);
      return JSON.stringify(
        { memories: r.items.map(memJSON), page, page_size: size, total: r.total, total_pages: pages, has_more: page < pages },
        null,
        2,
      );
    },
  },
  {
    name: "memory_update",
    description: "Update a memory's tags, type or metadata (content stays the same). updates.tags replaces tags; updates.metadata is merged.",
    inputSchema: {
      type: "object",
      required: ["content_hash", "updates"],
      properties: {
        content_hash: { type: "string" },
        updates: {
          type: "object",
          properties: { tags: tagsSchema, memory_type: { type: "string" }, metadata: { type: "object" } },
        },
      },
    },
    async run(env, a) {
      const m = await getByHash(env, String(a.content_hash));
      if (!m) throw new Error("Memory not found: " + a.content_hash);
      const u = a.updates ?? {};
      if (u.tags !== undefined) m.tags = normTags(u.tags);
      if (u.memory_type) m.memory_type = String(u.memory_type);
      const extra = { ...u };
      delete extra.tags;
      delete extra.memory_type;
      const metaPatch = typeof extra.metadata === "object" && extra.metadata ? extra.metadata : {};
      delete extra.metadata;
      m.metadata = { ...m.metadata, ...metaPatch, ...extra };
      m.updated_at = now();
      await updateMemoryRow(env, m);
      return JSON.stringify({ success: true, message: "Memory updated", content_hash: m.content_hash });
    },
  },
  {
    name: "memory_delete",
    description:
      "Delete memories by content_hash, tags, and/or time range (AND logic). dry_run=true previews. Calling with no filter is an error.",
    inputSchema: {
      type: "object",
      properties: {
        content_hash: { type: "string" },
        tags: tagsSchema,
        tag_match: { type: "string", enum: ["any", "all"], default: "any" },
        before: { type: "string" },
        after: { type: "string" },
        dry_run: { type: "boolean", default: false },
      },
    },
    annotations: { destructiveHint: true },
    async run(env, a) {
      let hashes: string[];
      if (a.content_hash) {
        const m = await getByHash(env, String(a.content_hash));
        hashes = m ? [m.content_hash] : [];
      } else {
        const f = filterFrom({ tags: a.tags, tag_match: a.tag_match, before: a.before, after: a.after });
        if (!f.tags && f.after == null && f.before == null) throw new Error("Refusing to delete without any filter");
        const r = await listMemories(env, f, 1000, 0);
        hashes = r.items.map((m) => m.content_hash);
      }
      if (!a.dry_run) await deleteByHashes(env, hashes);
      return JSON.stringify({ success: true, dry_run: !!a.dry_run, deleted_count: hashes.length, deleted_hashes: hashes });
    },
  },
  {
    name: "mistake_note_add",
    description: "Record a mistake pattern for error replay. Auto-increments failure_count when the same pattern and context are recorded again.",
    inputSchema: {
      type: "object",
      required: ["error_pattern", "context_signature", "incorrect_action", "correct_action"],
      properties: {
        error_pattern: { type: "string" },
        context_signature: { type: "string" },
        incorrect_action: { type: "string" },
        correct_action: { type: "string" },
      },
    },
    async run(env, a) {
      const p = {
        error_pattern: String(a.error_pattern ?? ""),
        context_signature: String(a.context_signature ?? ""),
        incorrect_action: String(a.incorrect_action ?? ""),
        correct_action: String(a.correct_action ?? ""),
      };
      // 同一 Pattern + Context 已存在 → 次数 +1
      const prefix = `Pattern: ${p.error_pattern}\nContext: ${p.context_signature}\n`;
      const existing = await env.DB.prepare("SELECT content_hash FROM memories WHERE memory_type='mistake' AND substr(content,1,?)=?")
        .bind(prefix.length, prefix)
        .first<{ content_hash: string }>();
      if (existing) {
        const m = (await getByHash(env, existing.content_hash))!;
        const n = Number(m.metadata.failure_count ?? 1) + 1;
        m.metadata = { ...m.metadata, failure_count: n };
        m.updated_at = now();
        await updateMemoryRow(env, m);
        return JSON.stringify({ success: true, content_hash: m.content_hash, failure_count: n, repeated: true });
      }
      const content = mistakeContent(p);
      const hash = await sha256(content);
      const t = now();
      await insertMemory(env, {
        content_hash: hash,
        content,
        tags: ["mistake-note", "error-replay"],
        memory_type: "mistake",
        metadata: { failure_count: 1, confidence: 0.5, frustration_score: 1.0, is_avoid_rule: false },
        agent_id: null,
        created_at: t,
        updated_at: t,
      });
      return JSON.stringify({ success: true, content_hash: hash, failure_count: 1 });
    },
  },
  {
    name: "mistake_note_search",
    description: "Search mistake notes by semantic similarity. Use before starting a task to check for known pitfalls.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" }, limit: { type: "integer", default: 5 } },
    },
    annotations: { readOnlyHint: true },
    async run(env, a) {
      const limit = Math.min(50, Math.max(1, Number(a.limit) || 5));
      const r = await semanticSearch(env, String(a.query ?? ""), "mistake", { type: "mistake" }, limit);
      const notes = r.map(({ memory: m, score }) => ({
        content_hash: m.content_hash,
        ...parseMistake(m.content),
        failure_count: m.metadata.failure_count ?? 1,
        similarity: Number(score.toFixed(4)),
        created_at_iso: iso(m.created_at),
      }));
      return JSON.stringify({ notes, count: notes.length }, null, 2);
    },
  },
  {
    name: "mistake_note_update",
    description: "Update fields of an existing mistake note. Content changes create a new hash.",
    inputSchema: {
      type: "object",
      required: ["content_hash"],
      properties: {
        content_hash: { type: "string" },
        failure_count: { type: "integer" },
        error_pattern: { type: "string" },
        context_signature: { type: "string" },
        incorrect_action: { type: "string" },
        correct_action: { type: "string" },
      },
    },
    async run(env, a) {
      const m = await getByHash(env, String(a.content_hash));
      if (!m || m.memory_type !== "mistake") throw new Error("Mistake note not found: " + a.content_hash);
      const p = parseMistake(m.content);
      let changed = false;
      for (const k of ["error_pattern", "context_signature", "incorrect_action", "correct_action"] as const)
        if (typeof a[k] === "string" && a[k] !== p[k]) {
          p[k] = a[k];
          changed = true;
        }
      const meta = { ...m.metadata };
      if (a.failure_count != null) meta.failure_count = Number(a.failure_count);
      if (!changed) {
        m.metadata = meta;
        m.updated_at = now();
        await updateMemoryRow(env, m);
        return JSON.stringify({ success: true, content_hash: m.content_hash });
      }
      const content = mistakeContent(p);
      const hash = await sha256(content);
      await deleteByHashes(env, [m.content_hash]);
      await insertMemory(env, { ...m, content, content_hash: hash, metadata: meta, updated_at: now() });
      return JSON.stringify({ success: true, content_hash: hash, previous_hash: m.content_hash });
    },
  },
  {
    name: "mistake_note_delete",
    description: "Delete a mistake note by content hash. Only deletes memories with memory_type='mistake'.",
    inputSchema: { type: "object", required: ["content_hash"], properties: { content_hash: { type: "string" } } },
    annotations: { destructiveHint: true },
    async run(env, a) {
      const m = await getByHash(env, String(a.content_hash));
      if (!m || m.memory_type !== "mistake") throw new Error("Mistake note not found: " + a.content_hash);
      await deleteByHashes(env, [m.content_hash]);
      return JSON.stringify({ success: true, deleted: m.content_hash });
    },
  },
  {
    name: "memory_health",
    description: "Check database health and get statistics.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async run(env) {
      const c = await env.DB.prepare(
        "SELECT COUNT(*) AS total, SUM(embedded=0) AS missing, SUM(memory_type='mistake') AS mistakes FROM memories",
      ).first<{ total: number; missing: number; mistakes: number }>();
      const vec = await env.VEC.describe().catch(() => null);
      return JSON.stringify(
        {
          status: "healthy",
          backend: "cloudflare-d1+vectorize",
          embedding_model: env.EMBED_MODEL,
          total_memories: c?.total ?? 0,
          mistake_notes: c?.mistakes ?? 0,
          missing_embeddings: c?.missing ?? 0,
          vector_index: vec,
        },
        null,
        2,
      );
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
