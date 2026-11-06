// Spoiler-free author QA helper. Never render or persist the comparison key.
// Conservative equivalence: invisible formatting or terminal punctuation alone is not a narrative difference.
// Keep internal punctuation: it can change meaning. Match route-response author QA semantics.
// Use the same Unicode-wide rule as route-response author QA; a partial list
// misses Hangul fillers and Khmer inherent-vowel signs that render invisibly.
const ignorable = /\p{Default_Ignorable_Code_Point}/gu;

export function npcDialogueComparisonKey(text) {
  if (typeof text !== 'string') return null;
  try {
    return text.normalize('NFKC').replace(ignorable, '').trim()
      .replace(/\s+/gu, ' ').toLocaleLowerCase('und')
      .replace(/[.!?！？。…]+$/gu, '').trim();
  } catch {
    return null;
  }
}
