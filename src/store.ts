// D1 + Vectorize + Workers AI 存取层
export interface Env {
  DB: D1Database;
  VEC: VectorizeIndex;
  AI: Ai;
  OAUTH_KV: KVNamespace;
  EMBED_MODEL: string;
  EMBED_DIM: string;
  OWNER_PASSWORD: string;
  CONSENT_SECRET: string;
  ADMIN_TOKEN: string;
}

export interface Memory {
  content_hash: string;
  content: string;
  tags: string[];
  memory_type: string;
  metadata: Record<string, unknown>;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
}

interface Row {
  content_hash: string;
  content: string;
  tags: string;
  memory_type: string;
  metadata: string;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
}

const NS_MEMORY = "memory";
const NS_MISTAKE = "mistake";
export const nsFor = (type: string) => (type === "mistake" ? NS_MISTAKE : NS_MEMORY);

function parseJSON<T>(s: string | null | undefined, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function fromRow(r: Row): Memory {
  return {
    content_hash: r.content_hash,
    content: r.content,
    tags: parseJSON<string[]>(r.tags, []),
    memory_type: r.memory_type,
    metadata: parseJSON<Record<string, unknown>>(r.metadata, {}),
    agent_id: r.agent_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function normTags(t: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(t)) arr = t;
  else if (typeof t === "string") arr = t.split(",");
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
}

// ---------- 向量 ----------
export async function embed(env: Env, texts: string[]): Promise<number[][]> {
  const res = (await env.AI.run(env.EMBED_MODEL as keyof AiModels, { text: texts } as never)) as {
    data?: number[][];
    response?: number[][];
  };
  const vecs = res.data ?? res.response;
  if (!Array.isArray(vecs) || vecs.length !== texts.length) throw new Error("embedding: unexpected response shape");
  const dim = Number(env.EMBED_DIM);
  for (const v of vecs) if (v.length !== dim) throw new Error(`embedding: got ${v.length} dims, index expects ${dim}`);
  return vecs;
}

async function upsertVectors(env: Env, mems: Memory[]) {
  if (!mems.length) return;
  // bge-m3 一次可以吃多条；分批避免单次请求过大
  for (let i = 0; i < mems.length; i += 20) {
    const batch = mems.slice(i, i + 20);
    const vecs = await embed(env, batch.map((m) => m.content));
    await env.VEC.upsert(
      batch.map((m, j) => ({
        id: m.content_hash,
        values: vecs[j],
        namespace: nsFor(m.memory_type),
        metadata: { created_at: m.created_at },
      })),
    );
    await env.DB.batch(
      batch.map((m) => env.DB.prepare("UPDATE memories SET embedded=1 WHERE content_hash=?").bind(m.content_hash)),
    );
  }
}

// ---------- 写 ----------
export async function getByHash(env: Env, hash: string): Promise<Memory | null> {
  const r = await env.DB.prepare("SELECT * FROM memories WHERE content_hash=?").bind(hash).first<Row>();
  return r ? fromRow(r) : null;
}

export async function insertMemory(env: Env, m: Memory, opts: { embedNow?: boolean } = {}) {
  const stmts = [
    env.DB.prepare(
      `INSERT INTO memories (content_hash,content,tags,memory_type,metadata,agent_id,created_at,updated_at,embedded)
       VALUES (?,?,?,?,?,?,?,?,0)`,
    ).bind(
      m.content_hash,
      m.content,
      JSON.stringify(m.tags),
      m.memory_type,
      JSON.stringify(m.metadata),
      m.agent_id,
      m.created_at,
      m.updated_at,
    ),
    ...m.tags.map((t) => env.DB.prepare("INSERT OR IGNORE INTO memory_tags VALUES (?,?)").bind(m.content_hash, t)),
  ];
  await env.DB.batch(stmts);
  if (opts.embedNow !== false) {
    try {
      await upsertVectors(env, [m]);
    } catch (e) {
      // 向量失败不丢数据：embedded=0，之后 /admin/reindex 会补
      console.error("embed failed", e);
    }
  }
}

export async function updateMemoryRow(env: Env, m: Memory) {
  await env.DB.batch([
    env.DB.prepare("UPDATE memories SET tags=?, memory_type=?, metadata=?, updated_at=? WHERE content_hash=?").bind(
      JSON.stringify(m.tags),
      m.memory_type,
      JSON.stringify(m.metadata),
      m.updated_at,
      m.content_hash,
    ),
    env.DB.prepare("DELETE FROM memory_tags WHERE content_hash=?").bind(m.content_hash),
    ...m.tags.map((t) => env.DB.prepare("INSERT OR IGNORE INTO memory_tags VALUES (?,?)").bind(m.content_hash, t)),
  ]);
}

export async function deleteByHashes(env: Env, hashes: string[]) {
  if (!hashes.length) return;
  for (let i = 0; i < hashes.length; i += 50) {
    const part = hashes.slice(i, i + 50);
    const qs = part.map(() => "?").join(",");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM memory_tags WHERE content_hash IN (${qs})`).bind(...part),
      env.DB.prepare(`DELETE FROM memories WHERE content_hash IN (${qs})`).bind(...part),
    ]);
    await env.VEC.deleteByIds(part);
  }
}

// ---------- 读 ----------
export interface Filter {
  tags?: string[];
  tagMatch?: "any" | "all";
  after?: number; // Unix 秒
  before?: number;
  type?: string;
  excludeType?: string;
  agentId?: string;
}

function whereClause(f: Filter): { sql: string; args: unknown[] } {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (f.type) {
    parts.push("m.memory_type = ?");
    args.push(f.type);
  }
  if (f.excludeType) {
    parts.push("m.memory_type != ?");
    args.push(f.excludeType);
  }
  if (f.after != null) {
    parts.push("m.created_at >= ?");
    args.push(f.after);
  }
  if (f.before != null) {
    parts.push("m.created_at < ?");
    args.push(f.before);
  }
  if (f.agentId) {
    parts.push("(m.agent_id = ? OR EXISTS (SELECT 1 FROM memory_tags t WHERE t.content_hash=m.content_hash AND t.tag=?))");
    args.push(f.agentId, "agent:" + f.agentId);
  }
  if (f.tags?.length) {
    const qs = f.tags.map(() => "?").join(",");
    if (f.tagMatch === "all") {
      parts.push(
        `(SELECT COUNT(DISTINCT t.tag) FROM memory_tags t WHERE t.content_hash=m.content_hash AND t.tag IN (${qs})) = ?`,
      );
      args.push(...f.tags, f.tags.length);
    } else {
      parts.push(`EXISTS (SELECT 1 FROM memory_tags t WHERE t.content_hash=m.content_hash AND t.tag IN (${qs}))`);
      args.push(...f.tags);
    }
  }
  return { sql: parts.length ? "WHERE " + parts.join(" AND ") : "", args };
}

export async function listMemories(env: Env, f: Filter, limit: number, offset: number) {
  const w = whereClause(f);
  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM memories m ${w.sql}`)
    .bind(...w.args)
    .first<{ n: number }>();
  const rows = await env.DB.prepare(`SELECT m.* FROM memories m ${w.sql} ORDER BY m.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...w.args, limit, offset)
    .all<Row>();
  return { total: total?.n ?? 0, items: rows.results.map(fromRow) };
}

export async function exactSearch(env: Env, query: string, f: Filter, limit: number) {
  const w = whereClause(f);
  const cond = (w.sql ? w.sql + " AND " : "WHERE ") + "m.content LIKE ? ESCAPE '\\'";
  const like = "%" + query.replace(/[\\%_]/g, (c) => "\\" + c) + "%";
  const rows = await env.DB.prepare(`SELECT m.* FROM memories m ${cond} ORDER BY m.created_at DESC LIMIT ?`)
    .bind(...w.args, like, limit)
    .all<Row>();
  return rows.results.map((r) => ({ memory: fromRow(r), score: 1 }));
}

export async function semanticSearch(env: Env, query: string, ns: string, f: Filter, limit: number, pre?: number[]) {
  const vec = pre ?? (await embed(env, [query]))[0];
  // 多取一些再在 D1 里按标签/时间过滤
  const topK = Math.min(50, Math.max(limit * 4, 20));
  const res = await env.VEC.query(vec, { topK, namespace: ns, returnMetadata: "none" });
  if (!res.matches.length) return [];
  const ids = res.matches.map((m) => m.id);
  const w = whereClause(f);
  const qs = ids.map(() => "?").join(",");
  const cond = (w.sql ? w.sql + " AND " : "WHERE ") + `m.content_hash IN (${qs})`;
  const rows = await env.DB.prepare(`SELECT m.* FROM memories m ${cond}`)
    .bind(...w.args, ...ids)
    .all<Row>();
  const byId = new Map(rows.results.map((r) => [r.content_hash, fromRow(r)]));
  return res.matches
    .filter((m) => byId.has(m.id))
    .slice(0, limit)
    .map((m) => ({ memory: byId.get(m.id)!, score: m.score }));
}

export async function reindexMissing(env: Env, max = 200) {
  const rows = await env.DB.prepare("SELECT * FROM memories WHERE embedded=0 LIMIT ?").bind(max).all<Row>();
  const mems = rows.results.map(fromRow);
  await upsertVectors(env, mems);
  const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM memories WHERE embedded=0").first<{ n: number }>();
  return { embedded: mems.length, remaining: left?.n ?? 0 };
}
