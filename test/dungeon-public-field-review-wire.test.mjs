import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Synthetic interoperability reference. No real author approval is created here.
export function canonical(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_json_number');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('non_json_value');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new TypeError('non_json_object');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) throw new TypeError('sparse_array');
        items.push(canonical(value[i], ancestors));
      }
      return '[' + items.join(',') + ']';
    }
    const keys = Object.keys(value).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k], ancestors)).join(',') + '}';
  } finally { ancestors.delete(value); }
}
export const digest = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const index = '(?:0|[1-9][0-9]*)';
const allowedPath = new RegExp('^(?:record\\.(?:subject|after)|dungeon\\.(?:id|name|tint|st|desc|mission|rule|pen)|dungeon\\.pub\\.(?:open|clear|zero|hidden)|dungeon\\.ch\\[' + index + '\\]\\.(?:t|k|pub\\.(?:intro|recap)|skill\\.(?:id|name|effect)|practice\\[' + index + '\\]\\.(?:id|q))|dungeon\\.cast\\[' + index + '\\]\\[(?:0|1|3)\\]|dungeon\\.fork\\.(?:ch|price|t|q))$');
export const isAllowedPath = path => typeof path === 'string' && allowedPath.test(path);
export const isWireGate = gate => typeof gate === 'string' && /^(?:listing|chapter:(?:0|[1-9][0-9]*)|chapter_verified:(?:0|[1-9][0-9]*)|all_done|all_done\+zero_grant|hidden_grant)$/.test(gate);
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isUtcTime = value => {
  if (typeof value !== 'string' || /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) === false) return false;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const normalized = new Date(timestamp).toISOString();
  return normalized.slice(0, 19) === value.slice(0, 19);
};

// expectedFields MUST come from the actual server public projection, not the sidecar.
// trusted + authorConfirmed MUST come from a separate authority, not sidecar fields.
export function verifyWire(record, sidecar, expectedFields, { trusted = false, authorConfirmed = false } = {}) {
  const fail = code => ({ ok: false, code });
  if (!trusted || !authorConfirmed) return fail('unapproved');
  if (!sidecar || typeof sidecar !== 'object' || Array.isArray(sidecar)) return fail('invalid_sidecar');
  if (sidecar.schema !== 'dungeon-public-field-review-v1' ||
      sidecar.recordId !== record.id ||
      typeof sidecar.approvedBy !== 'string' || !sidecar.approvedBy.trim() ||
      !isUtcTime(sidecar.approvedAt) ||
      !isDigest(sidecar.contentDigest) || !Array.isArray(sidecar.fields)) return fail('invalid_sidecar');
  if (sidecar.contentDigest !== digest(record)) return fail('stale_record');
  if (!Array.isArray(expectedFields)) return fail('invalid_projection');
  const expected = new Map();
  for (const x of expectedFields) {
    if (!isAllowedPath(x?.path) || !isWireGate(x?.gate) || expected.has(x.path)) return fail('invalid_projection');
    expected.set(x.path, x);
  }
  const seen = new Set();
  for (const x of sidecar.fields) {
    if (!isAllowedPath(x?.path) || !isWireGate(x?.gate) || !isDigest(x?.digest) || seen.has(x.path)) return fail('invalid_approval');
    seen.add(x.path);
    const e = expected.get(x.path);
    if (!e || x.gate !== e.gate || x.digest !== digest(e.value)) return fail('mismatch');
  }
  if (seen.size !== expected.size) return fail('missing_approval');
  return { ok: true };
}

const fixture = () => {
  const record = { kind: 'dungeon', id: 'synthetic-lesson', content: { dungeon: { name: 'Neutral', ch: [{ t: 'Chapter 1' }, { t: 'Neutral chapter 2' }] } } };
  const expected = [
    { path: 'dungeon.name', value: 'Neutral', gate: 'listing' },
    { path: 'dungeon.ch[1].t', value: 'Neutral chapter 2', gate: 'listing' },
    { path: 'dungeon.ch[0].t', value: 'Chapter 1', gate: 'listing' },
  ];
  const sidecar = {
    schema: 'dungeon-public-field-review-v1', recordId: record.id, contentDigest: digest(record),
    approvedBy: 'synthetic-author', approvedAt: '2026-10-29T00:00:00Z',
    fields: expected.map(x => ({ path: x.path, digest: digest(x.value), gate: x.gate })),
  };
  return { record, expected, sidecar };
};
const verify = (mutate = () => {}, options = { trusted: true, authorConfirmed: true }) => {
  const x = fixture(); mutate(x); return verifyWire(x.record, x.sidecar, x.expected, options);
};
const rejects = (mutate, code) => assert.equal(verify(mutate).code, code);

test('actual SHA-256 lowercase hex for canonical JSON', () => {
  assert.equal(digest({ b: 2, a: '中' }), createHash('sha256').update('{"a":"中","b":2}', 'utf8').digest('hex'));
  assert.match(digest({ a: 1 }), /^[a-f0-9]{64}$/);
});
test('recursive object key order and input whitespace do not affect hash', () => {
  const a = JSON.parse('{"z":{"b":1,"a":2},"a":[{"y":3,"x":4}]}');
  const b = JSON.parse(' { "a": [ { "x":4, "y":3 } ], "z": { "a":2,"b":1 } } ');
  assert.equal(digest(a), digest(b));
});
test('array order and string values remain significant', () => {
  assert.notEqual(digest([1, 2]), digest([2, 1]));
  assert.notEqual(digest('A'), digest('a'));
});
test('non-JSON values, sparse arrays and cycles rejected', () => {
  for (const v of [undefined, NaN, Infinity, new Date(), [, 1]]) assert.throws(() => canonical(v));
  const cyclic = {}; cyclic.self = cyclic; assert.throws(() => canonical(cyclic));
});
test('exact bracket paths accepted', () => {
  for (const p of ['record.subject', 'dungeon.ch[2].practice[0].q', 'dungeon.cast[0][1]', 'dungeon.fork.price', 'dungeon.pub.zero'])
    assert.ok(isAllowedPath(p), p);
});
test('aliases, private fields, leading-zero indexes and prefix paths rejected', () => {
  for (const p of ['ch.2.t', 'dungeon.ch[02].t', 'dungeon.cast[0][2]', 'dungeon.pre', 'dungeon.ch[0].practice[0].a', 'dungeon.ch[0]', 'dungeon.ch[*].t', 'dungeon.fork.b'])
    assert.ok(!isAllowedPath(p), p);
});
test('exact gate vocabulary accepted', () => {
  for (const g of ['listing', 'chapter:0', 'chapter:12', 'chapter_verified:1', 'all_done', 'all_done+zero_grant', 'hidden_grant'])
    assert.ok(isWireGate(g), g);
});
test('informal gate aliases and invalid indexes rejected', () => {
  for (const g of ['chapterDone:1', 'chapter:01', 'chapter:-1', 'allDone', 'zeroUnlocked', 'hiddenUnlocked', 'all_done+hidden_grant'])
    assert.ok(!isWireGate(g), g);
});
test('synthetic fully authorized sidecar passes', () => assert.deepEqual(verify(), { ok: true }));
test('no trusted author channel fails even if sidecar claims approval', () =>
  assert.equal(verify(() => {}, { trusted: false, authorConfirmed: true }).code, 'unapproved'));
test('no explicit human confirmation fails even on admin channel', () =>
  assert.equal(verify(() => {}, { trusted: true, authorConfirmed: false }).code, 'unapproved'));
test('missing approvedBy or approvedAt fails', () => {
  rejects(x => { delete x.sidecar.approvedBy; }, 'invalid_sidecar');
  rejects(x => { x.sidecar.approvedAt = 'not-a-date'; }, 'invalid_sidecar');
  rejects(x => { x.sidecar.approvedAt = '2026-02-30T00:00:00Z'; }, 'invalid_sidecar');
});
test('edited director-only content invalidates whole record approval', () =>
  rejects(x => { x.record.content.dungeon.privateDirector = 'changed'; }, 'stale_record'));
test('future chapter title must be approved at listing gate', () =>
  rejects(x => { x.sidecar.fields[1].gate = 'chapter:1'; }, 'mismatch'));
test('unapproved newly projected field fails closed', () =>
  rejects(x => { x.expected.push({ path: 'dungeon.desc', value: 'New public text', gate: 'listing' }); }, 'missing_approval'));
test('duplicate, private and unknown sidecar paths rejected', () => {
  rejects(x => { x.sidecar.fields.push({ ...x.sidecar.fields[0] }); }, 'invalid_approval');
  rejects(x => { x.sidecar.fields[0].path = 'dungeon.pre'; }, 'invalid_approval');
  rejects(x => { x.sidecar.fields[0].path = 'dungeon.desc'; }, 'mismatch');
});
test('projection must itself be an allowlisted, unique set', () => {
  rejects(x => { x.expected[0].path = 'dungeon.pre'; }, 'invalid_projection');
  rejects(x => { x.expected.push({ ...x.expected[0] }); }, 'invalid_projection');
});
test('field digest and whole-record digest must be correct lowercase hex', () => {
  rejects(x => { x.sidecar.fields[0].digest = 'A'.repeat(64); }, 'invalid_approval');
  rejects(x => { x.sidecar.contentDigest = '0'.repeat(64); }, 'stale_record');
});
test('errors expose no private text, paths, hashes or author identifier', () => {
  const result = verify(x => { x.sidecar.fields[0].digest = 'f'.repeat(64); });
  const output = JSON.stringify(result);
  for (const secret of ['Neutral', 'dungeon.name', 'synthetic-author', 'fffff']) assert.ok(!output.includes(secret));
});
