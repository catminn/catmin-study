import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 对真实模块 src/review.ts 运行契约 dungeon-public-field-review-v1 的合成负例（占位内容）。
const out = join(mkdtempSync(join(tmpdir(), 'rv-')), 'review.mjs');
execSync(`npx esbuild src/review.ts --bundle --format=esm --platform=node --outfile=${out} --log-level=error`, { stdio: 'inherit' });
const M = await import(pathToFileURL(out).href);
const { projectedFields, reviewPreflight, recordDigest, sha256Hex, canonicalJson } = M;
const digest = (v) => sha256Hex(canonicalJson(v));
async function syntheticSidecar(record) {
  const fields = [];
  for (const f of projectedFields(record)) fields.push({ path: f.path, digest: await digest(f.value), gate: f.gate });
  return { schema: 'dungeon-public-field-review-v1', recordId: record.id, contentDigest: await recordDigest(record), fields };
}
const preflight = async (record, sidecar) => ({ errors: await reviewPreflight(record, sidecar) });

const sample = () => ({
  kind: 'dungeon', id: 'synthetic-lesson',
  content: { subject: 'sample-course', after: null, dungeon: {
    id: 'synthetic-lesson', name: 'Demo', tint: 'neutral', st: 'practice',
    desc: 'Neutral overview', mission: 'Learn', rule: 'Try again', pen: 0,
    pre: 'DIRECTOR_PRIVATE_SENTINEL', hidden: 'DIRECTOR_PRIVATE_SENTINEL',
    pub: { open: 'Welcome', clear: 'Finished', zero: 'Memory', hidden: 'Bonus' },
    cast: [['Demo person', 'Public role', 'PRIVATE_SENTINEL', 1]],
    fork: { ch: 1, price: 2, t: 'Choice', q: 'Choose', b: 'PRIVATE_SENTINEL' },
    ch: [
      { t: 'Chapter one', k: 'Concept one', s: 'PRIVATE_SENTINEL',
        pub: { intro: 'Start', recap: 'Reviewed' },
        skill: { id: 'demo-a', name: 'Demo skill', effect: 'Demo effect' },
        practice: [{ id: 'q1', q: 'Sample question?', a: 'SECRET_ANSWER', hint: 'SECRET_HINT' }] },
      { t: 'Neutral future title', k: 'Concept two', s: 'PRIVATE_SENTINEL',
        skill: { id: 'demo-b', name: 'Second skill', effect: 'Second effect' },
        practice: [{ id: 'q2', q: 'Second question?', a: 'SECRET_ANSWER' }] },
    ],
  } },
});
const copy = (x) => structuredClone(x);
const check = async (mutate) => {
  const record = sample(), approval = await syntheticSidecar(record);
  mutate(record, approval);
  const errors = await reviewPreflight(record, approval);
  return { ok: errors.length === 0, errors };
};
const fails = async (mutate, code) => assert.ok((await check(mutate)).errors.includes(code), code);

test('fully reviewed synthetic record passes', async () =>
  assert.equal((await check(() => {})).ok, true));
test('missing sidecar fails closed', async () =>
  assert.ok((await preflight(sample(), null)).errors.includes('missing_sidecar')));
test('forged inline review is not an approval', async () => {
  const r = sample(); r.content.dungeon.review = { 'name': true };
  assert.ok((await preflight(r, null)).errors.includes('missing_sidecar'));
});
test('changed public dungeon name invalidates approval', async () =>
  await fails((r) => { r.content.dungeon.name += '!'; }, 'stale_content'));
test('changed future title invalidates approval', async () =>
  await fails((r) => { r.content.dungeon.ch[1].t += '!'; }, 'field_changed'));
test('future title must be safe at listing, not chapter unlock', async () =>
  await fails((r, a) => { a.fields.find(x => x.path === 'dungeon.ch[1].t').gate = 'chapter:1'; }, 'wrong_gate'));
test('missing public-field approval rejected', async () =>
  await fails((r, a) => { a.fields.pop(); }, 'missing_approval'));
test('unknown path cannot expand the public surface', async () =>
  await fails((r, a) => { a.fields.push({ path: 'dungeon.pre', digest: 'x', gate: 'listing' }); }, 'unknown_path'));
test('duplicate approval path rejected', async () =>
  await fails((r, a) => { a.fields.push(copy(a.fields[0])); }, 'duplicate_or_bad_path'));
test('field digest must match exact value', async () =>
  await fails((r, a) => { a.fields[0].digest = '0'; }, 'field_changed'));
test('wrong dungeon id rejected', async () =>
  await fails((r, a) => { a.recordId = 'other'; }, 'wrong_record'));
test('wrong whole-record digest rejected', async () =>
  await fails((r, a) => { a.contentDigest = '0'; }, 'stale_content'));
test('unknown schema rejected', async () =>
  await fails((r, a) => { a.schema = 'unversioned'; }, 'bad_schema'));
test('director-only changes invalidate old record approval', async () =>
  await fails((r) => { r.content.dungeon.pre += '!'; }, 'stale_content'));
test('cast public identity edit invalidates approval', async () =>
  await fails((r) => { r.content.dungeon.cast[0][1] += '!'; }, 'field_changed'));
test('zero copy must require completion plus grant', async () =>
  await fails((r, a) => { a.fields.find(x => x.path === 'dungeon.pub.zero').gate = 'all_done'; }, 'wrong_gate'));
test('hidden copy cannot unlock just from completion', async () =>
  await fails((r, a) => { a.fields.find(x => x.path === 'dungeon.pub.hidden').gate = 'all_done'; }, 'wrong_gate'));
test('new public field needs new approval', async () =>
  await fails((r) => { r.content.dungeon.ch[1].pub = { intro: 'New' }; }, 'missing_approval'));
test('server-generated fallback practice ids also require review', async () => {
  const r = sample(); delete r.content.dungeon.ch[0].practice[0].id;
  const paths = projectedFields(r);
  assert.ok(paths.some(x => x.path === 'dungeon.ch[0].practice[0].id' && x.value === 'c1'));
});
test('answer, hint, director script and private cast field are never approvable', () => {
  const paths = projectedFields(sample()).map(x => x.path);
  for (const secret of ['dungeon.pre', 'dungeon.hidden', 'dungeon.ch[0].s',
    'dungeon.ch[0].practice[0].a', 'dungeon.ch[0].practice[0].hint',
    'dungeon.cast[0][2]', 'dungeon.fork.b'])
    assert.ok(!paths.includes(secret), secret);
});
test('preflight errors never include text, identity, digest or field path', async () => {
  const result = await check((r) => { r.content.dungeon.cast[0][0] = 'PRIVATE_SENTINEL'; });
  const output = JSON.stringify(result);
  for (const forbidden of ['PRIVATE_SENTINEL', 'dungeon.cast', 'sha256', 'Demo person'])
    assert.ok(!output.includes(forbidden), forbidden);
});
