// Spoiler-free author QA helper. Never render or persist the comparison key.
// Conservative equivalence: invisible formatting alone is not a narrative difference.
const ignorable = /[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;

export function npcDialogueComparisonKey(text) {
  if (typeof text !== 'string') return null;
  try {
    return text.normalize('NFKC').replace(ignorable, '').trim()
      .replace(/\s+/gu, ' ').toLocaleLowerCase('und');
  } catch {
    return null;
  }
}
