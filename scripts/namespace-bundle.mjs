// 把旧版（无前缀）私有内容包转换为多世界命名空间版：只改记录 id，不改任何正文字段。
//   world 记录 → <worldId>:world；其它记录 → <worldId>:<原 id>。内容里的引用保持 localId（引擎在固定的世界内解析；限定写法也兼容）。
// 只输出计数与错误类别，不输出任何正文或 id。
// 用法：node scripts/namespace-bundle.mjs <旧包.json> <输出.json> <worldId> [globalRulesVersion]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const [, , inp, out, worldId, rules] = process.argv;
const WORLD = /^[a-z][a-z0-9_-]{1,63}$/, LOCAL = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const KINDS = new Set(['world', 'scene', 'npc', 'event', 'knowledge-link']);
const fail = (m) => { console.log(JSON.stringify({ ok: false, error: m })); process.exit(1); };
if (!inp || !out || !worldId) fail('用法：node scripts/namespace-bundle.mjs <旧包.json> <输出.json> <worldId>');
if (!WORLD.test(worldId)) fail('worldId 不合法');
if (existsSync(out)) fail('输出文件已存在，不覆盖');
let b; try { b = JSON.parse(readFileSync(inp, 'utf8')); } catch { fail('输入不是合法 JSON'); }
if (!b || !Array.isArray(b.records)) fail('缺少 records 数组');
const errs = {}, bad = (k) => { errs[k] = (errs[k] ?? 0) + 1; };
const seen = new Set(), counts = {};
let already = 0;
const recs = b.records.map((r) => {
  if (!r || !KINDS.has(r.kind)) { bad('记录 kind 不是世界内容（course 等共享库不能进世界包）'); return r; }
  let local = r.id;
  if (typeof local === 'string' && local.startsWith(worldId + ':')) { already++; local = local.slice(worldId.length + 1); }
  else if (typeof local === 'string' && local.includes(':')) { bad('记录 id 已带别的世界前缀'); return r; }
  if (r.kind === 'world') local = 'world';
  else if (typeof local !== 'string' || !LOCAL.test(local)) { bad('记录 id 不符合 localId 规则'); return r; }
  const id = worldId + ':' + local, key = r.kind + ' ' + id;
  if (seen.has(key)) bad('转换后 id 冲突'); seen.add(key);
  counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  return { ...r, id };
});
if ((counts.world ?? 0) !== 1) bad('world 记录不是恰好 1 条');
if (Object.keys(errs).length) { console.log(JSON.stringify({ ok: false, errors: errs })); process.exit(1); }
writeFileSync(out, JSON.stringify({ ...b, worldId, namespaced: true, ...(rules ? { globalRulesVersion: rules } : {}), records: recs }, null, 1));
console.log(JSON.stringify({ ok: true, worldId, records: recs.length, counts, alreadyNamespaced: already, globalRulesVersion: rules ?? b.globalRulesVersion ?? null }));
