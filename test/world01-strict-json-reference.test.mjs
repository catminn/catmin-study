import test from 'node:test';
import assert from 'node:assert/strict';

// Synthetic author-side byte parser; never accepts private story input.
function parseStrict(bytes) {
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
