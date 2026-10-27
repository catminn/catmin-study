// 主神空间 / 网站共用的学习进度：存档（带版本号防止两边互相覆盖）和对话摘要
import type { Env } from "./store";

const MAX_BYTES = 1_800_000; // D1 单个值上限约 2MB，留余量
const KEY_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
const now = () => Date.now() / 1000;
const iso = (s: number) => new Date(s * 1000).toISOString();

type Row = { key: string; value: string; version: number; updated_at: number; updated_by: string | null };
type Args = Record<string, any>;

function checkKey(k: unknown): string {
  const key = String(k ?? "");
  if (!KEY_RE.test(key)) throw new Error("invalid key: use letters, digits, - _ . : (max 64)");
  return key;
}

export const STUDY_TOOLS = [
  {
    name: "study_state_get",
    description:
      "Read a 主神空间 study-progress document (e.g. key 'state' for points/check-ins/quests, 'chat-math' for a subject chat). " +
      "Returns {exists, key, value, version, updated_at, updated_by}. Pass the version back as base_version when saving.",
    inputSchema: { type: "object", required: ["key"], properties: { key: { type: "string" } } },
    annotations: { readOnlyHint: true },
    async run(env: Env, a: Args) {
      const key = checkKey(a.key);
      const r = await env.DB.prepare("SELECT * FROM study_state WHERE key=?").bind(key).first<Row>();
      if (!r) return JSON.stringify({ exists: false, key, version: 0 });
      return JSON.stringify({
        exists: true,
        key,
        value: JSON.parse(r.value),
        version: r.version,
        updated_at: r.updated_at,
        updated_at_iso: iso(r.updated_at),
        updated_by: r.updated_by,
      });
    },
  },
  {
    name: "study_state_put",
    description:
      "Save a study-progress document. value is any JSON. base_version must equal the version you last read " +
      "(0 for a new key); if someone else saved in between, nothing is written and {ok:false, conflict:true, current} is returned. " +
      "force=true skips the check (overwrite). source names who is writing (artifact / site / claude / chatgpt).",
    inputSchema: {
      type: "object",
      required: ["key", "value"],
      properties: {
        key: { type: "string" },
        value: { description: "Any JSON value" },
        base_version: { type: "integer", minimum: 0 },
        force: { type: "boolean", default: false },
        source: { type: "string" },
      },
    },
    async run(env: Env, a: Args) {
      const key = checkKey(a.key);
      const text = JSON.stringify(a.value ?? null);
      if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error("value too large (max ~1.8MB)");
      const source = a.source ? String(a.source).slice(0, 40) : null;
      const t = now();
      const cur = await env.DB.prepare("SELECT version, updated_at, updated_by FROM study_state WHERE key=?")
        .bind(key)
        .first<{ version: number; updated_at: number; updated_by: string | null }>();
      const curVer = cur?.version ?? 0;
      if (!a.force && a.base_version != null && Number(a.base_version) !== curVer) {
        return JSON.stringify({
          ok: false,
          conflict: true,
          current: { version: curVer, updated_at: cur?.updated_at ?? null, updated_at_iso: cur ? iso(cur.updated_at) : null, updated_by: cur?.updated_by ?? null },
        });
      }
      // 条件更新：版本没变才写，防止并发
      const next = curVer + 1;
      const res = cur
        ? await env.DB.prepare("UPDATE study_state SET value=?, version=?, updated_at=?, updated_by=? WHERE key=? AND version=?")
            .bind(text, next, t, source, key, curVer)
            .run()
        : await env.DB.prepare("INSERT OR IGNORE INTO study_state (key,value,version,updated_at,updated_by) VALUES (?,?,?,?,?)")
            .bind(key, text, next, t, source)
            .run();
      if (!res.meta.changes) return JSON.stringify({ ok: false, conflict: true, current: { version: null } });
      return JSON.stringify({ ok: true, key, version: next, updated_at: t, updated_at_iso: iso(t) });
    },
  },
  {
    name: "study_state_list",
    description: "List saved study-progress keys with their version, size and last update (no values).",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    async run(env: Env) {
      const r = await env.DB.prepare(
        "SELECT key, version, updated_at, updated_by, length(value) AS bytes FROM study_state ORDER BY updated_at DESC",
      ).all<{ key: string; version: number; updated_at: number; updated_by: string | null; bytes: number }>();
      return JSON.stringify({ items: r.results.map((x) => ({ ...x, updated_at_iso: iso(x.updated_at) })) }, null, 2);
    },
  },
  {
    name: "chat_summary_add",
    description: "Save a short summary of one study conversation, so another mode or model can pick up where it left off.",
    inputSchema: {
      type: "object",
      required: ["subject", "summary"],
      properties: { subject: { type: "string", description: "math / chem / engri / engl / other" }, summary: { type: "string" }, source: { type: "string" } },
    },
    async run(env: Env, a: Args) {
      const subject = String(a.subject ?? "").slice(0, 40);
      const summary = String(a.summary ?? "").trim().slice(0, 8000);
      if (!subject || !summary) throw new Error("subject and summary are required");
      const t = now();
      const r = await env.DB.prepare("INSERT INTO chat_summaries (subject, summary, source, created_at) VALUES (?,?,?,?)")
        .bind(subject, summary, a.source ? String(a.source).slice(0, 40) : null, t)
        .run();
      return JSON.stringify({ ok: true, id: r.meta.last_row_id, created_at_iso: iso(t) });
    },
  },
  {
    name: "chat_summary_list",
    description: "Recent study-conversation summaries, newest first, optionally for one subject.",
    inputSchema: {
      type: "object",
      properties: { subject: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 5 } },
    },
    annotations: { readOnlyHint: true },
    async run(env: Env, a: Args) {
      const limit = Math.min(50, Math.max(1, Number(a.limit) || 5));
      const q = a.subject
        ? env.DB.prepare("SELECT * FROM chat_summaries WHERE subject=? ORDER BY created_at DESC LIMIT ?").bind(String(a.subject), limit)
        : env.DB.prepare("SELECT * FROM chat_summaries ORDER BY created_at DESC LIMIT ?").bind(limit);
      const r = await q.all<{ id: number; subject: string; summary: string; source: string | null; created_at: number }>();
      return JSON.stringify({ items: r.results.map((x) => ({ ...x, created_at_iso: iso(x.created_at) })) }, null, 2);
    },
  },
];
