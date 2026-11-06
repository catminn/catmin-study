import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const path = new URL('../content/contracts/world01-opening-skeleton.json', import.meta.url);
const expectedBlob = 'd47474604926ef0ad8763b36fa543b283557ba32';
const sha = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
const gitBlob = bytes => sha('sha1', Buffer.concat([
  Buffer.from(`blob ${bytes.length}\0`, 'ascii'), bytes,
]));
const parseBytes = bytes => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return JSON.parse(text);
};
const canonical = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
};

test('actual repository fixture matches pinned public Git blob bytes', () => {
  const bytes = readFileSync(path);
  assert.equal(gitBlob(bytes), expectedBlob);
  const value = parseBytes(bytes);
  assert.equal(value.schemaVersion, 'story-structure-0.1');
  assert.equal(value.visibility, 'mechanics_only');
});

test('canonical SHA-256 is stable across JSON whitespace and object key order', () => {
  const value = parseBytes(readFileSync(path));
  const reverse = Object.fromEntries(Object.entries(value).reverse());
  assert.equal(sha('sha256', canonical(value)), sha('sha256', canonical(reverse)));
  assert.equal(sha('sha256', canonical(value)), sha('sha256', canonical(JSON.parse(JSON.stringify(value, null, 3)))));
});

test('fixture mutation changes both raw blob and canonical digest', () => {
  const bytes = readFileSync(path);
  const value = parseBytes(bytes);
  const changed = structuredClone(value);
  changed.warning += ' ';
  assert.notEqual(gitBlob(Buffer.from(JSON.stringify(changed))), expectedBlob);
  assert.notEqual(sha('sha256', canonical(changed)), sha('sha256', canonical(value)));
});

test('strict UTF-8 byte entry rejects malformed sequences', () => {
  assert.throws(() => parseBytes(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d])), TypeError);
});

test('Git blob byte binding detects whitespace-only changes even when canonical digest does not', () => {
  const bytes = readFileSync(path);
  const value = parseBytes(bytes);
  const reformatted = Buffer.from(JSON.stringify(value));
  assert.notEqual(gitBlob(reformatted), gitBlob(bytes));
  assert.equal(sha('sha256', canonical(parseBytes(reformatted))), sha('sha256', canonical(value)));
});
