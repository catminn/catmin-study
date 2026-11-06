# NPC public-copy director delimiter preflight — author-side addendum (spoiler-free)

This is a synthetic authoring check only, not a review signature, production content gate, or model-output sanitizer. It contains no first-world content or private NPC identifiers. The existing `npcPublicCopySafe` remains the shared predicate used by the author NPC reference and DM/NPC bridge.

## Acceptance boundary

A public NPC line must never include either of the reserved director-expansion delimiters `⟦` or `⟧`, regardless of case, spaces, missing prefix, or fullwidth spelling inside them. The old check only rejected the exact substring `⟦DG:` and therefore accepted visually similar director placeholders. The new rule rejects the delimiters themselves, rather than attempting to parse or guess whether their contents are sensitive. This conservative author-only restriction may reject harmless literal use of these unusual brackets; authors should rewrite such public prose without the reserved syntax.

The check also rejects malformed UTF-16 (unpaired surrogate code units), preventing downstream replacement-character rendering of unreviewed malformed strings. Correctly paired supplementary characters, normal emoji and ZWJ emoji sequences remain accepted. Existing length, schema, approval-flag, knowledge-gate, and forbidden-control-character checks remain in force. Failure is a boolean only; no submitted text or author IDs are returned.

`node --test test/npc-public-copy-safety.test.mjs test/npc-director-delimiter.test.mjs` executes 32 synthetic cases in Node 22. The 13 new cases passed 4/13 before the fix and 13/13 after; combined with 19 existing tests, 32/32 passed in Node.js 22.16.0. This does not establish semantic leak prevention, genuine author approval, real Worker/D1 behavior, or the safety of private story content. A malicious model can generate arbitrary prose without using reserved delimiters; real projections require separate trusted approval and private review.

First formal world remains DO-NOT-IMPORT until private field-by-field review, real engineering validation, and Catherine's explicit authorization while present. Do not change production, stored player state, permissions, PR merge status, or deployment as part of this author-side test.

## Invisible-only and invisible-control copy rejection

A string containing only default-ignorable Unicode code points is not meaningful public NPC dialogue, even when `trim()` considers it nonempty. The author-side predicate now rejects such lines, including standalone variation selectors or zero-width joiners. It also rejects combining grapheme joiners, Mongolian vowel separators and invisible function/bidi controls embedded in otherwise visible copy. Ordinary Chinese text, emoji variation selectors attached to visible symbols, and legitimate ZWJ emoji sequences remain valid.

The new `test/npc-invisible-copy-safety.test.mjs` contains 13 fully synthetic tests: the previous predicate failed 10/13; after the change all 13/13 passed. With the unchanged 19 public-copy and 13 director-delimiter tests, the locally reconstructed, Git-blob-verified source was run with native Node.js 22.16.0: **45/45 passed**, and syntax checks passed. This is an author-side predicate test, not full repository CI, Worker/D1 verification, model-output safety, or approval to import private content.
