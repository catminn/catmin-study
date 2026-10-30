import test from 'node:test';
import assert from 'node:assert/strict';
import {npcDialogueComparisonKey as key} from '../scripts/npc-dialogue-comparison.mjs';

const same = (name, a, b) => test(name, () => assert.equal(key(a), key(b)));
const distinct = (name, a, b) => test(name, () => assert.notEqual(key(a), key(b)));
same('identical synthetic dialogue', 'The door is open.', 'The door is open.');
same('case-only difference is not a consequence', 'The door is open.', 'THE DOOR IS OPEN.');
same('full-width compatibility text is not distinct', 'Ａｎｓｗｅｒ', 'answer');
same('composed and decomposed accents compare equal', 'Café', 'Cafe\u0301');
same('extra ordinary whitespace does not manufacture a difference', 'A   cautious\tanswer', 'a cautious answer');
same('non-breaking space does not manufacture a difference', 'A\u00a0reply', 'a reply');
same('soft hyphen does not manufacture a difference', 're\u00adply', 'reply');
same('zero-width characters do not manufacture a difference', 'a\u200b reply', 'a reply');
same('variation selectors do not manufacture a difference', '⚙️', '⚙');
same('ZWJ emoji are conservatively compared', '👩‍🔬', '👩🔬');
distinct('different responses remain distinct', 'The door is open.', 'The door is closed.');
distinct('a meaningful negation remains distinct', 'You may proceed.', 'You may not proceed.');
distinct('different punctuation remains distinct under lexical QA', 'Wait.', 'Wait!');
test('invalid inputs are never coerced into text', () => {
  for (const value of [null, undefined, 0, true, {}, ['copy']]) assert.equal(key(value), null);
});
test('empty and invisible-only text canonicalize to empty', () => {
  for (const value of ['', ' \t ', '\u200b\u2060']) assert.equal(key(value), '');
});
test('comparison does not mutate input and does not log text', () => {
  const input = 'Ａ  Reply';
  assert.equal(key(input), 'a reply');
  assert.equal(input, 'Ａ  Reply');
});
