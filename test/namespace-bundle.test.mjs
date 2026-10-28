// 占位内容：旧包 → 命名空间包 → 兼容预检结果一致；转换只改记录 id；冲突/别的世界前缀被拒；清单结构预检。
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'ns-'));
const LEG = 'test/fixtures/placeholder-legacy-bundle.json';
const run = (s, ...a) => spawnSync('node', [s, ...a], { encoding: 'utf8' });
const check = (f) => JSON.parse(run('scripts/check-bundle-engine-compat.mjs', f).stdout);
test('转换只改记录 id，正文不变；预检结果与旧包一致', () => {
  const out = join(dir, 'a.json');
  const r = JSON.parse(run('scripts/namespace-bundle.mjs', LEG, out, 'world01', 'global-v1').stdout);
  assert.equal(r.ok, true); assert.equal(r.records, 6);
  const a = JSON.parse(readFileSync(LEG, 'utf8')), b = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(b.records.map((x) => x.id), ['world01:world', 'world01:p-a', 'world01:p-b', 'world01:pn', 'world01:pe1', 'world01:pe2']);
  assert.deepEqual(b.records.map((x) => x.content), a.records.map((x) => x.content));
  const c1 = check(LEG), c2 = check(out);
  assert.equal(c2.namespaced, true); assert.equal(c1.namespaced, false);
  delete c1.namespaced; delete c2.namespaced; assert.deepEqual(c2, c1);
  assert.equal(c2.ok, true);
});
test('输出文件已存在不覆盖；别的世界前缀/非法 worldId 被拒', () => {
  const out = join(dir, 'b.json'); writeFileSync(out, '{}');
  assert.equal(run('scripts/namespace-bundle.mjs', LEG, out, 'world01').status, 1);
  const bad = join(dir, 'bad.json'); writeFileSync(bad, JSON.stringify({ records: [{ kind: 'world', id: 'w', content: {} }, { kind: 'scene', id: 'other:x', content: {} }] }));
  assert.equal(run('scripts/namespace-bundle.mjs', bad, join(dir, 'c.json'), 'world01').status, 1);
  assert.equal(run('scripts/namespace-bundle.mjs', LEG, join(dir, 'd.json'), 'Bad World').status, 1);
});
test('预检：混用前缀被拒；内容里写别的世界的限定引用不可解析', () => {
  const b = JSON.parse(readFileSync(LEG, 'utf8'));
  const mixed = join(dir, 'm.json'); writeFileSync(mixed, JSON.stringify({ records: b.records.map((r, i) => ({ ...r, id: (i ? 'world01:' : '') + r.id })) }));
  assert.equal(check(mixed).ok, false);
  const out = join(dir, 'e.json'); run('scripts/namespace-bundle.mjs', LEG, out, 'world01');
  const n = JSON.parse(readFileSync(out, 'utf8')); n.records[0].content.startSceneId = 'otherworld:p-a';
  const f = join(dir, 'f.json'); writeFileSync(f, JSON.stringify(n)); assert.equal(check(f).ok, false);
  n.records[0].content.startSceneId = 'world01:p-a'; writeFileSync(f, JSON.stringify(n)); assert.equal(check(f).ok, true);
});
test('导入脚本 dry-run：命名空间包做清单结构预检，缺 globalRulesVersion 时阻止', () => {
  const ok = join(dir, 'g.json'); run('scripts/namespace-bundle.mjs', LEG, ok, 'world01', 'global-v1');
  assert.equal(spawnSync('python3', ['scripts/import-bundle.py', ok, '--dry-run'], { encoding: 'utf8' }).status, 0);
  const no = join(dir, 'h.json'); run('scripts/namespace-bundle.mjs', LEG, no, 'world01');
  assert.notEqual(spawnSync('python3', ['scripts/import-bundle.py', no, '--dry-run'], { encoding: 'utf8' }).status, 0);
});
