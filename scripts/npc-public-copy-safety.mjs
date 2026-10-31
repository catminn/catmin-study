// Synthetic author-side public-copy preflight. This is not an approval authority.
// It never returns author text, private identifiers, or source values.
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const id = x => typeof x === 'string' && /^[a-z][a-z0-9._-]{0,79}$/.test(x);
const fields = new Set(['text', 'relation', 'approved', 'requiresNpcKnowledge']);
const unsafe = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
// An otherwise nonempty string can still consist solely of invisible code points.
// This check preserves emoji variation selectors and ZWJ sequences with visible bases.
const defaultIgnorable = /\p{Default_Ignorable_Code_Point}/gu;
// These brackets are reserved for director-only expansions. No author-approved
// public copy may contain either delimiter, even without the exact DG: prefix.
// This avoids case, spacing, and compatibility-character prefix bypasses.
const directorDelimiter = /[⟦⟧]/u;
// Reject malformed UTF-16 rather than letting a downstream renderer replace it.
const unpairedSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u;

export function npcPublicCopySafe(copy) {
  if (!object(copy) || !own(copy, 'text') || !own(copy, 'relation') || !own(copy, 'approved') ||
      Object.keys(copy).some(k => !fields.has(k)) || copy.approved !== true ||
      !id(copy.relation) || typeof copy.text !== 'string') return false;
  const text = copy.text;
  if (!text.trim() || !text.replace(defaultIgnorable, '').trim() ||
      [...text].length > 1200 || unsafe.test(text) ||
      directorDelimiter.test(text) || unpairedSurrogate.test(text)) return false;
  if (own(copy, 'requiresNpcKnowledge')) {
    const gate = copy.requiresNpcKnowledge;
    if (!object(gate) || Object.keys(gate).length !== 2 ||
        !own(gate, 'factId') || !own(gate, 'tier') || !id(gate.factId) ||
        !['heard', 'confirmed'].includes(gate.tier)) return false;
  }
  return true;
}
