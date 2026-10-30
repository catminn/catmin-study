# NPC public-copy director delimiter preflight — author-side addendum (spoiler-free)

This is a synthetic authoring check only, not a review signature, production content gate, or model-output sanitizer. It contains no first-world content or private NPC identifiers. The existing `npcPublicCopySafe` remains the shared predicate used by the author NPC reference and DM/NPC bridge.

## Acceptance boundary

A public NPC line must never include either of the reserved director-expansion delimiters `⟦` or `⟧`, regardless of case, spaces, missing prefix, or fullwidth spelling inside them. The old check only rejected the exact substring `⟦DG:` and therefore accepted visually similar director placeholders. The new rule rejects the delimiters themselves, rather than attempting to parse or guess whether their contents are sensitive. This conservative author-only restriction may reject harmless literal use of these unusual brackets; authors should rewrite such public prose without the reserved syntax.

The check also rejects malformed UTF-16 (unpaired surrogate code units), preventing downstream replacement-character rendering of unreviewed malformed strings. Correctly paired supplementary characters, normal emoji and ZWJ emoji sequences remain accepted. Existing length, schema, approval-flag, knowledge-gate, and forbidden-control-character checks remain in force. Failure is a boolean only; no submitted text or author IDs are returned.

`node --test test/npc-public-copy-safety.test.mjs test/npc-director-delimiter.test.mjs` executes 32 synthetic cases in Node 22. The 13 new cases passed 4/13 before the fix and 13/13 after; combined with 19 existing tests, 32/32 passed in Node.js 22.16.0. This does not establish semantic leak prevention, genuine author approval, real Worker/D1 behavior, or the safety of private story content. A malicious model can generate arbitrary prose without using reserved delimiters; real projections require separate trusted approval and private review.

First formal world remains DO-NOT-IMPORT until private field-by-field review, real engineering validation, and Catherine's explicit authorization while present. Do not change production, stored player state, permissions, PR merge status, or deployment as part of this author-side test.
