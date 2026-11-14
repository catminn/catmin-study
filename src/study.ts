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
    name: "study_log_add",
    description:
      "Record that Catherine just learned something with you, so her 学习空间 site (study.catmin.io) awards points. " +
      "Call it ONLY after she answered the final checkpoint question of the session correctly (right >= 1); never for a lesson she only read. " +
      "kind: 'daily' = today's small daily lesson (counts as her daily check-in); 'lesson' = a whole lecture/section on her progress list " +
      "(ref = the node ref the site gave you, e.g. 'math:161'); 'mistake' = she beat a revived mistake (ref = mistake id); " +
      "'plan' = a day of her exam review plan (ref = the plan key the site gave you). If the site's prompt gave a ref, pass it exactly. " +
      "subj: math / chem / engri / engl. topic: short Chinese name of what was learned. right/total: checkpoint questions answered correctly / asked. " +
      "Duplicate refs for the same day are ignored by the site. Returns the saved entry.",
    inputSchema: {
      type: "object",
      required: ["kind", "subj", "topic", "right", "total"],
      properties: {
        kind: { type: "string", enum: ["daily", "lesson", "mistake", "plan"] },
        subj: { type: "string", enum: ["math", "chem", "engri", "engl"] },
        topic: { type: "string" },
        ref: { type: "string", description: "Node/mistake/plan ref from the site prompt; omit if none was given" },
        right: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 1 },
        note: { type: "string", description: "Optional one line: what she still finds shaky" },
        source: { type: "string", description: "claude / chatgpt" },
      },
    },
    async run(env: Env, a: Args) {
      const kind = String(a.kind ?? "");
      if (!["daily", "lesson", "mistake", "plan"].includes(kind)) throw new Error("kind must be daily / lesson / mistake / plan");
      const subj = String(a.subj ?? "");
      if (!["math", "chem", "engri", "engl"].includes(subj)) throw new Error("subj must be math / chem / engri / engl");
      const total = Math.max(1, Math.min(50, Math.round(Number(a.total) || 0)));
      const right = Math.max(0, Math.min(total, Math.round(Number(a.right) || 0)));
      if (right < 1) throw new Error("only log after she answered at least the final checkpoint correctly (right >= 1)");
      const entry: Record<string, unknown> = {
        id: "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        at: Date.now(),
        kind,
        subj,
        topic: String(a.topic ?? "").trim().slice(0, 60),
        right,
        total,
      };
      if (a.ref) entry.ref = String(a.ref).slice(0, 80);
      if (a.note) entry.note = String(a.note).slice(0, 200);
      entry.source = a.source ? String(a.source).slice(0, 20) : "claude";
      // 追加到 learnlog（只留最近 200 条），带版本号重试，防止和网站同时写
      for (let i = 0; i < 5; i++) {
        const cur = await env.DB.prepare("SELECT value, version FROM study_state WHERE key='learnlog'").first<{ value: string; version: number }>();
        let list: unknown[] = [];
        try {
          const v = cur ? JSON.parse(cur.value) : [];
          if (Array.isArray(v)) list = v;
        } catch {}
        list = list.concat([entry]).slice(-200);
        const text = JSON.stringify(list);
        const t = now();
        const res = cur
          ? await env.DB.prepare("UPDATE study_state SET value=?, version=version+1, updated_at=?, updated_by=? WHERE key='learnlog' AND version=?")
              .bind(text, t, entry.source as string, cur.version)
              .run()
          : await env.DB.prepare("INSERT OR IGNORE INTO study_state (key,value,version,updated_at,updated_by) VALUES ('learnlog',?,1,?,?)")
              .bind(text, t, entry.source as string)
              .run();
        if (res.meta.changes) return JSON.stringify({ ok: true, entry, note: "Saved. Her site picks it up within a few seconds and awards the points." });
      }
      throw new Error("busy, try again");
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
