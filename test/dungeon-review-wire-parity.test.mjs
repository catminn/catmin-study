// Spoiler-free review wire parity gate. No private content, approvals, or production writes.
// Reference: node --test test/dungeon-review-wire-parity.test.mjs
// Real module: REVIEW_IMPL=./src/review.ts node --experimental-strip-types --test test/dungeon-review-wire-parity.test.mjs
// A failing real-module run is a CONTRACT FAILURE, not evidence of a live data leak.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = s => createHash('sha256').update(s, 'utf8').digest('hex');
function canonical(v, seen = new Set()) {
  if (v === null || ['string', 'boolean'].includes(typeof v)) return JSON.stringify(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError('non_json_number');
    return JSON.stringify(v);
  }
  if (typeof v !== 'object' || seen.has(v)) throw new TypeError('non_json_value');
  const proto = Object.getPrototypeOf(v);
  if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) throw new TypeError('non_json_object');
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const items = [];
      for (let i = 0; i < v.length; i++) {
        if (!Object.hasOwn(v, i)) throw new TypeError('sparse_array');
        items.push(canonical(v[i], seen));
      }
      return '[' + items.join(',') + ']';
    }
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k], seen)).join(',') + '}';
  } finally { seen.delete(v); }
}
const digest = v => hash(canonical(v));
const record = () => ({
  kind: 'dungeon', id: 'synthetic-lesson',
  content: { subject: 'Synthetic', dungeon: {
    id: 'synthetic-lesson', name: 'Neutral title', desc: 'Neutral description',
    ch: [
      { t: 'Chapter 1', practice: [{ q: '2 + 2?' }] },
      { t: 'Neutral chapter 2' }
    ],
    cast: [['Synthetic person', 'Visitor', 'PRIVATE_DIRECTOR_SENTINEL', 1]]
  }}
});
const impl = process.env.REVIEW_IMPL
  ? await import(pathToFileURL(resolve(process.env.REVIEW_IMPL)).href)
  : null;

test('reference: canonical SHA-256 ignores object insertion order, including nested keys', () => {
  const a = JSON.parse('{"z":{"b":1,"a":2},"a":[{"y":3,"x":4}]}');
  const b = JSON.parse('{"a":[{"x":4,"y":3}],"z":{"a":2,"b":1}}');
  assert.equal(digest(a), digest(b));
  assert.notEqual(hash(JSON.stringify(a)), hash(JSON.stringify(b)));
});
test('reference: raw JSON.stringify digest is not canonical wire digest', () => {
  const r = record();
  assert.notEqual(hash(JSON.stringify(r)), digest(r));
});
test('reference: changing private director-only content changes whole-record digest', () => {
  const r = record(), before = digest(r);
  r.content.dungeon.cast[0][2] = 'PRIVATE_CHANGED_SENTINEL';
  assert.notEqual(before, digest(r));
});
test('reference: canonical JSON rejects invalid values', () => {
  for (const v of [undefined, NaN, Infinity, new Date(), [,1]]) assert.throws(() => canonical(v));
});

if (impl) {
  test('real module: whole-record digest matches canonical wire format', async () => {
    assert.equal(await impl.recordDigest(record()), digest(record()));
  });
  test('real module: whole-record digest invariant under object-key reorder', async () => {
    const a = record();
    const b = JSON.parse(JSON.stringify(a, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).reverse()) : v));
    assert.equal(digest(a), digest(b));
    assert.equal(await impl.recordDigest(a), await impl.recordDigest(b));
  });
  test('real module: canonical sidecar is accepted by preflight', async () => {
    const r = record();
    const fields = impl.projectedFields(r);
    const sidecar = {
      schema: 'dungeon-public-field-review-v1', recordId: r.id,
      contentDigest: digest(r),
      fields: fields.map(f => ({ path: f.path, gate: f.gate, digest: digest(f.value) }))
    };
    assert.deepEqual(await impl.reviewPreflight(r, sidecar), []);
    r.content.dungeon.cast[0][2] = 'PRIVATE_CHANGED_SENTINEL';
    assert.ok((await impl.reviewPreflight(r, sidecar)).length > 0);
  });
  test('real module: future title listing, fallback practice ID and director privacy', () => {
    const fields = impl.projectedFields(record());
    assert.ok(fields.some(f => f.path === 'dungeon.ch[1].t' && f.gate === 'listing'));
    assert.ok(fields.some(f => f.path === 'dungeon.ch[0].practice[0].id' && f.value === 'c1'));
    assert.ok(fields.some(f => f.path === 'dungeon.cast[0][0]' && f.gate === 'chapter:1'));
    for (const f of fields) {
      assert.ok(!/cast\[\d+\]\[2\]|\.a$|\.hint$|\.pre$/.test(f.path), f.path);
      assert.ok(!JSON.stringify(f.value).includes('PRIVATE_'), f.path);
    }
  });
}
