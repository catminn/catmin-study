import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Synthetic reference only. Production must verify an independently trusted
// private author sidecar, not an approval flag embedded in imported JSON.
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const put = (out, path, value, gate) => {
  if (value !== undefined) out.push({ path, digest: digest(value), gate });
};

export function projectedFields(record) {
  const out = [];
  const d = record.content.dungeon;
  put(out, 'record.subject', record.content.subject, 'listing');
  put(out, 'record.after', record.content.after, 'listing');
  for (const k of ['id', 'name', 'tint', 'st', 'desc', 'mission', 'rule', 'pen'])
    put(out, 'dungeon.' + k, d[k], 'listing');
  const topPub = { open: 'listing', clear: 'all_done',
    zero: 'all_done+zero_grant', hidden: 'hidden_grant' };
  for (const [k, gate] of Object.entries(topPub))
    put(out, 'dungeon.pub.' + k, d.pub?.[k], gate);
  (d.ch ?? []).forEach((ch, i) => {
    const p = 'dungeon.ch[' + i + ']';
    put(out, p + '.t', ch.t, 'listing'); // Current GET exposes future titles.
    put(out, p + '.k', ch.k, 'chapter:' + i);
    put(out, p + '.pub.intro', ch.pub?.intro, 'chapter:' + i);
    put(out, p + '.pub.recap', ch.pub?.recap, 'chapter_verified:' + i);
    for (const k of ['id', 'name', 'effect'])
      put(out, p + '.skill.' + k, ch.skill?.[k], 'chapter:' + i);
    (ch.practice ?? []).forEach((q, j) => {
      put(out, p + '.practice[' + j + '].id', q.id, 'chapter:' + i);
      put(out, p + '.practice[' + j + '].q', q.q, 'chapter:' + i);
    });
  });
  (d.cast ?? []).forEach((c, i) => {
    const p = 'dungeon.cast[' + i + ']';
    const gate = 'chapter:' + c[3];
    put(out, p + '[0]', c[0], gate);
    put(out, p + '[1]', c[1], gate);
    put(out, p + '[3]', c[3], gate);
  });
  if (d.fork) {
    put(out, 'dungeon.fork.ch', d.fork.ch, 'listing');
    put(out, 'dungeon.fork.price', d.fork.price, 'listing');
    put(out, 'dungeon.fork.t', d.fork.t, 'chapter:' + d.fork.ch);
    put(out, 'dungeon.fork.q', d.fork.q, 'chapter:' + d.fork.ch);
  }
  return out;
}

// Test fixture factory, NOT a production approval generator. A generated
// manifest is pending until a real author explicitly reviews and signs off.
function syntheticSidecar(record) {
  return {
    schema: 'dungeon-public-field-review-v1',
    recordId: record.id,
    contentDigest: digest(record),
    fields: projectedFields(record),
  };
}

export function preflight(record, sidecar, trusted) {
  const errors = [];
  if (trusted !== true) errors.push('untrusted_sidecar');
  if (!sidecar || typeof sidecar !== 'object') return { ok: false, errors: [...errors, 'missing_sidecar'] };
  if (sidecar.schema !== 'dungeon-public-field-review-v1') errors.push('bad_schema');
  if (sidecar.recordId !== record.id) errors.push('wrong_record');
  if (sidecar.contentDigest !== digest(record)) errors.push('stale_content');
  const actual = projectedFields(record);
  const approvals = Array.isArray(sidecar.fields) ? sidecar.fields : [];
  if (!Array.isArray(sidecar.fields)) errors.push('bad_fields');
  const seen = new Set();
  const expected = new Map(actual.map((x) => [x.path, x]));
  for (const x of approvals) {
    if (!x || typeof x.path !== 'string' || seen.has(x.path)) {
      errors.push('duplicate_or_bad_path');
      continue;
    }
    seen.add(x.path);
    const e = expected.get(x.path);
    if (!e) errors.push('unknown_path');
    else {
      if (x.digest !== e.digest) errors.push('field_changed');
      if (x.gate !== e.gate) errors.push('wrong_gate');
    }
  }
  for (const x of actual) if (!seen.has(x.path)) errors.push('missing_approval');
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

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
const check = (mutate, trusted = true) => {
  const record = sample(), approval = syntheticSidecar(record);
  mutate(record, approval);
  return preflight(record, approval, trusted);
};
const fails = (mutate, code, trusted = true) =>
  assert.ok(check(mutate, trusted).errors.includes(code), code);

test('fully reviewed synthetic record passes', () =>
  assert.equal(check(() => {}).ok, true));
test('missing sidecar fails closed', () =>
  assert.ok(preflight(sample(), null, true).errors.includes('missing_sidecar')));
test('sidecar requires independently trusted channel', () =>
  fails(() => {}, 'untrusted_sidecar', false));
test('forged inline review is not an approval', () => {
  const r = sample(); r.content.dungeon.review = { 'name': true };
  assert.ok(preflight(r, null, true).errors.includes('missing_sidecar'));
});
test('changed public dungeon name invalidates approval', () =>
  fails((r) => { r.content.dungeon.name += '!'; }, 'stale_content'));
test('changed future title invalidates approval', () =>
  fails((r) => { r.content.dungeon.ch[1].t += '!'; }, 'field_changed'));
test('future title must be safe at listing, not chapter unlock', () =>
  fails((r, a) => { a.fields.find(x => x.path === 'dungeon.ch[1].t').gate = 'chapter:1'; }, 'wrong_gate'));
test('missing public-field approval rejected', () =>
  fails((r, a) => { a.fields.pop(); }, 'missing_approval'));
test('unknown path cannot expand the public surface', () =>
  fails((r, a) => { a.fields.push({ path: 'dungeon.pre', digest: 'x', gate: 'listing' }); }, 'unknown_path'));
test('duplicate approval path rejected', () =>
  fails((r, a) => { a.fields.push(copy(a.fields[0])); }, 'duplicate_or_bad_path'));
test('field digest must match exact value', () =>
  fails((r, a) => { a.fields[0].digest = '0'; }, 'field_changed'));
test('wrong dungeon id rejected', () =>
  fails((r, a) => { a.recordId = 'other'; }, 'wrong_record'));
test('wrong whole-record digest rejected', () =>
  fails((r, a) => { a.contentDigest = '0'; }, 'stale_content'));
test('unknown schema rejected', () =>
  fails((r, a) => { a.schema = 'unversioned'; }, 'bad_schema'));
test('director-only changes invalidate old record approval', () =>
  fails((r) => { r.content.dungeon.pre += '!'; }, 'stale_content'));
test('cast public identity edit invalidates approval', () =>
  fails((r) => { r.content.dungeon.cast[0][1] += '!'; }, 'field_changed'));
test('zero copy must require completion plus grant', () =>
  fails((r, a) => { a.fields.find(x => x.path === 'dungeon.pub.zero').gate = 'all_done'; }, 'wrong_gate'));
test('hidden copy cannot unlock just from completion', () =>
  fails((r, a) => { a.fields.find(x => x.path === 'dungeon.pub.hidden').gate = 'all_done'; }, 'wrong_gate'));
test('new public field needs new approval', () =>
  fails((r) => { r.content.dungeon.ch[0].pub.recap = 'Changed'; }, 'field_changed'));
test('answer, hint, director script and private cast field are never approvable', () => {
  const paths = projectedFields(sample()).map(x => x.path);
  for (const secret of ['dungeon.pre', 'dungeon.hidden', 'dungeon.ch[0].s',
    'dungeon.ch[0].practice[0].a', 'dungeon.ch[0].practice[0].hint',
    'dungeon.cast[0][2]', 'dungeon.fork.b'])
    assert.ok(!paths.includes(secret), secret);
});
test('preflight errors never include text, identity, digest or field path', () => {
  const result = check((r) => { r.content.dungeon.cast[0][0] = 'PRIVATE_SENTINEL'; });
  const output = JSON.stringify(result);
  for (const forbidden of ['PRIVATE_SENTINEL', 'dungeon.cast', 'sha256', 'Demo person'])
    assert.ok(!output.includes(forbidden), forbidden);
});
