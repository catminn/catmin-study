// 公开字段审批侧车（content/contracts/dungeon-public-field-review-v1）。
// 侧车是独立的、经管理员通道提交的作者审批断言，不是导入内容里自报的 review 标记。
// 摘要 = SHA-256( JSON.stringify(值) )（UTF-8，十六进制小写）；整条记录摘要对 {kind,id,content}。
// 错误只返回错误码，绝不回显文字、路径、摘要。
export const REVIEW_SCHEMA = "dungeon-public-field-review-v1";

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const dig = (v: unknown) => sha256Hex(JSON.stringify(v));
export const recordDigest = (record: { kind: string; id: string; content: unknown }) => dig({ kind: record.kind, id: record.id, content: record.content });

type PF = { path: string; value: unknown; gate: string };
// 与 projectDungeon 实际下发的字段一一对应（导演字段永不在此列）。
export function projectedFields(record: { content: any }): PF[] {
  const out: PF[] = [];
  const put = (path: string, value: unknown, gate: string) => { if (value !== undefined) out.push({ path, value, gate }); };
  const c = record.content, d = c.dungeon;
  put("record.subject", c.subject, "listing");
  put("record.after", c.after, "listing");
  for (const k of ["id", "name", "tint", "st", "desc", "mission", "rule", "pen"]) put("dungeon." + k, d[k], "listing");
  const topPub: Record<string, string> = { open: "listing", clear: "all_done", zero: "all_done+zero_grant", hidden: "hidden_grant" };
  for (const [k, gate] of Object.entries(topPub)) put("dungeon.pub." + k, d.pub?.[k], gate);
  (d.ch ?? []).forEach((ch: any, i: number) => {
    const p = "dungeon.ch[" + i + "]";
    put(p + ".t", ch.t, "listing"); // 当前 GET 对未来章标题也下发 → 必须按 listing 审批
    put(p + ".k", ch.k, "chapter:" + i);
    put(p + ".pub.intro", ch.pub?.intro, "chapter:" + i);
    put(p + ".pub.recap", ch.pub?.recap, "chapter_verified:" + i);
    for (const k of ["id", "name", "effect"]) put(p + ".skill." + k, ch.skill?.[k], "chapter:" + i);
    (ch.practice ?? []).forEach((q: any, j: number) => {
      put(p + ".practice[" + j + "].id", q.id ?? "c" + (j + 1), "chapter:" + i);
      put(p + ".practice[" + j + "].q", q.q, "chapter:" + i);
    });
  });
  (d.cast ?? []).forEach((x: any, i: number) => {
    const p = "dungeon.cast[" + i + "]", gate = "chapter:" + x[3];
    put(p + "[0]", x[0], gate); put(p + "[1]", x[1], gate); put(p + "[3]", x[3], gate);
  });
  if (d.fork) {
    put("dungeon.fork.ch", d.fork.ch, "listing"); put("dungeon.fork.price", d.fork.price, "listing");
    put("dungeon.fork.t", d.fork.t, "chapter:" + d.fork.ch); put("dungeon.fork.q", d.fork.q, "chapter:" + d.fork.ch);
  }
  return out;
}

// 返回错误码集合（空 = 通过）。record = {kind,id,content}；调用方须先确认侧车来自受信的管理员通道。
export async function reviewPreflight(record: { kind: string; id: string; content: any }, sidecar: any): Promise<string[]> {
  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) return ["missing_sidecar"];
  const errors = new Set<string>();
  if (sidecar.schema !== REVIEW_SCHEMA) errors.add("bad_schema");
  if (sidecar.recordId !== record.id) errors.add("wrong_record");
  if (sidecar.contentDigest !== (await recordDigest(record))) errors.add("stale_content");
  if (!Array.isArray(sidecar.fields)) { errors.add("bad_fields"); return [...errors]; }
  const actual = projectedFields(record);
  const expected = new Map<string, { digest: string; gate: string }>();
  for (const a of actual) expected.set(a.path, { digest: await dig(a.value), gate: a.gate });
  const seen = new Set<string>();
  for (const x of sidecar.fields) {
    if (!x || typeof x !== "object" || typeof x.path !== "string" || seen.has(x.path)) { errors.add("duplicate_or_bad_path"); continue; }
    seen.add(x.path);
    const e = expected.get(x.path);
    if (!e) errors.add("unknown_path");
    else { if (x.digest !== e.digest) errors.add("field_changed"); if (x.gate !== e.gate) errors.add("wrong_gate"); }
  }
  for (const a of actual) if (!seen.has(a.path)) errors.add("missing_approval");
  return [...errors];
}

// 归属信息（审批者与时间）：来自管理员通道；缺失即拒。
export function provenanceOk(p: any): p is { approvedBy: string; approvedAt: string } {
  return !!p && typeof p.approvedBy === "string" && p.approvedBy.trim().length > 0 && p.approvedBy.length <= 80
    && typeof p.approvedAt === "string" && !Number.isNaN(Date.parse(p.approvedAt)) && p.approvedAt.length <= 40;
}
