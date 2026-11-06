import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Synthetic author-side byte parser; never accepts private story input.
export function parseStrict(bytes) {
  const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let i = 0;
  const ws = () => { while (/\s/.test(s[i] ?? '') && i < s.length) i++; };
  const fail = () => { throw new SyntaxError('json_invalid'); };
  function str() {
    if (s[i] !== '"') fail();
    const start = i++;
    while (i < s.length) {
      if (s[i] === '"') return JSON.parse(s.slice(start, ++i));
      if (s[i] === '\\') { i++; if (s[i] === 'u') { if (!/^[0-9a-fA-F]{4}$/.test(s.slice(i+1,i+5))) fail(); i += 5; } else { if (!'"\\/bfnrt'.includes(s[i] ?? '')) fail(); i++; } }
      else { if (s.charCodeAt(i) < 32) fail(); i++; }
    }
    fail();
  }
  function value() {
    ws();
    if (s[i] === '"') return str();
    if (s[i] === '{') {
      i++; ws(); const obj = Object.create(null), keys = new Set();
      if (s[i] === '}') { i++; return obj; }
      while (true) {
        ws(); const key = str(); if (keys.has(key)) fail(); keys.add(key);
        ws(); if (s[i++] !== ':') fail(); obj[key] = value(); ws();
        if (s[i] === '}') { i++; return obj; }
        if (s[i++] !== ',') fail();
      }
    }
    if (s[i] === '[') {
      i++; ws(); const arr = []; if (s[i] === ']') { i++; return arr; }
      while (true) { arr.push(value()); ws(); if (s[i] === ']') { i++; return arr; } if (s[i++] !== ',') fail(); }
    }
    const rest = s.slice(i), match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(rest);
    if (!match) fail(); i += match[0].length;
    const out = JSON.parse(match[0]); if (typeof out === 'number' && !Number.isFinite(out)) fail();
    return out;
  }
  const out = value(); ws(); if (i !== s.length) fail(); return out;
}
const b = x => Buffer.from(x, 'utf8');
test('valid nested synthetic JSON and decoded escaped keys', () => {
  assert.equal(parseStrict(b('{"a":{"b":[1,true,null,"x"]}}')).a.b[0], 1);
  assert.equal(parseStrict(b('{"a":1,"\\u0062":2}')).b, 2);
});
for (const [name, source] of [
  ['top-level duplicate','{"a":1,"a":2}'],
  ['escaped equivalent duplicate','{"a":1,"\\u0061":2}'],
  ['nested duplicate','{"a":{"x":1,"x":2}}'],
  ['prototype key duplicate','{"__proto__":1,"__proto__":2}'],
  ['trailing comma','{"a":1,}'],
  ['trailing token','{"a":1} true'],
  ['invalid escape','{"a":"\\q"}'],
  ['unescaped control','{"a":"\n"}'],
  ['nonfinite exponent','{"a":1e999}'],
  ['invalid number','{"a":01}'],
]) test(`reject ${name}`, () => assert.throws(() => parseStrict(b(source)), SyntaxError));
test('reject invalid UTF-8', () => assert.throws(() => parseStrict(Buffer.from([0xc3,0x28])), TypeError));
test('JSON.parse would silently accept duplicate keys', () => assert.equal(JSON.parse('{"a":1,"a":2}').a, 2));

// Real public fixture integration: no private narrative or approval sidecar.
const fixtureUrl = new URL('../content/contracts/world01-opening-skeleton.json', import.meta.url);
const expectedBlob = 'd47474604926ef0ad8763b36fa543b283557ba32';
const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const blobHash = bytes => sha('sha1', Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, 'ascii'), bytes]));
const canonical = value => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
test('real public fixture strict parse and byte/digest binding', () => {
  const bytes = readFileSync(fixtureUrl);
  assert.equal(blobHash(bytes), expectedBlob);
  const parsed = parseStrict(bytes);
  assert.equal(parsed.schemaVersion, 'story-structure-0.1');
  assert.equal(parsed.visibility, 'mechanics_only');
  const digest = sha('sha256', canonical(parsed));
  assert.match(digest, /^[0-9a-f]{64}$/);
  const reordered = Object.fromEntries(Object.entries(parsed).reverse());
  assert.equal(digest, sha('sha256', canonical(reordered)));
  const changed = structuredClone(parsed);
  changed.warning += ' ';
  assert.notEqual(digest, sha('sha256', canonical(changed)));
});
test('real fixture mutation with duplicate decoded key fails closed', () => {
  const source = readFileSync(fixtureUrl).toString('utf8');
  const mutated = source.replace(/^\s*\{/, '{"schemaVersion":"shadow",');
  assert.notEqual(mutated, source);
  assert.throws(() => parseStrict(Buffer.from(mutated)), SyntaxError);
});
