# Free study vs. sequential story — spoiler-free author contract v1

**Status:** synthetic, offline authoring acceptance harness. This is neither an implementation of the live site nor permission to import the first formal world. Every `demo.*` reference is invented. No formal story text, identities, private conditions, puzzles, or answers belong in this contract or its fixture.

## Product semantics

The player has **two independent entry modes**. Study mode may open an available course dungeon/practice set directly, even if its corresponding story chapter has not been reached. Story mode enters only the current **committed saga frontier**; completing a practice set, changing study selection, previewing, or asking questions must never advance the saga. Story chapter progression requires a distinct authoritative story event. Verified academic evidence persists independently and may inform optional approaches, but never acts as a hidden story unlock, auto-success, NPC relationship mutation, or irreversible ending confirmation.

A dungeon can be reused for learning across multiple world phases. A study selection is not a story chapter selection. A chapter's `dungeonId` is an authoring association, **not** a claim that all dungeon story content can be revealed in free-study mode. Study mode must project only already authorized practice questions and public learning metadata. Director-only copy, future chapter titles, unselected forks, NPC secrets, and stage-gated world narration remain behind their separate review and visibility gates. The public copy slot is an opaque pointer, not approval evidence.

## Executable preflight

`node scripts/validate-study-story-isolation.mjs test/fixtures/study-story-isolation-synthetic-v1.json`

`node --test test/study-story-isolation.test.mjs`

The manifest uses an ordered chapter chain with opaque `predecessor`, `storyEntry`, `dungeonId`, and `publicCopySlot` references, plus an independent set of study dungeons and practices. The reference transition function checks that study actions change only study fields, while story commits require a synthetic trusted-event assertion, a matching current chapter, and a prior entry. ASK and preview are read-only. Errors are fixed codes with no input values. The validator refuses unknown keys and non-demo IDs to avoid accidentally using private content in public tests.

**Important limitations:** `source:'trusted-demo'` is an explicit synthetic assumption, **not** real server authentication. This code does not implement session pinning, event signing, real evidence verification, content approval, UI routing, D1 transactions, or concurrency. Claude owns those engineering decisions and real Worker/D1 integration. The narrative author must separately inspect whether practice questions teach real concepts, world decisions remain meaningful when tutoring is declined, and a later story chapter remembers only actually committed events.

### Per-action payload isolation (synthetic reference)

The reference rejects fields belonging to a different action, even when those fields are valid elsewhere in the union of accepted action keys. For example, a free-study selection cannot carry a story chapter or event reference, and ASK/preview cannot carry practice evidence or commit provenance. Such requests return only `ACTION_SHAPE` without applying state changes. This is an authoring boundary against accidental cross-mode payload acceptance, not a substitute for server-side request schemas, authorization, or content filtering.

### Read-only chapter visibility and learning provenance (synthetic reference)

ASK without a chapter target remains read-only. A chapter-targeted ASK or preview is valid only for the current saga frontier; preview must name that chapter. Requests for future, past, or terminal chapters fail with the fixed `STORY_LOCKED` code, even though they would not mutate state. This guards authoring-time chapter visibility and must not be mistaken for a production content projection or authorization check. A recorded verified practice also requires a visit to its owning study dungeon; an unrelated visit cannot justify it. This is a consistency check, not proof of academic completion or trusted evidence.

### State-continuity invariant (synthetic reference)

A non-null story cursor must point to the entry of the **current committed frontier**, never to a future or previously completed chapter; after the final commit it must be null. A selected study dungeon must also appear in the synthetic visit log. These are authoring/reference state-shape checks, not proof that client state is trustworthy. The real service must derive cursor and visit provenance from persisted server state; do not treat a client-supplied cursor, visit log, or `trusted-demo` assertion as authority.

### Malformed nested record handling (synthetic reference)

A parsed manifest may contain `null`, numbers, strings, arrays, or incomplete objects inside its `chapters` or `dungeons` arrays. These are invalid authoring records, not exceptional runtime conditions. Validation, initial-state creation, and synthetic action dispatch must reject them with fixed diagnostic codes or a null initial state, never throw or echo nested content. The 18 regression cases are offline and do not establish real API input safety.

## Release boundary

This is an authoring constraint, not an instruction to rewrite the live save schema or alter existing story progress. Do not replace the site's production state or import synthetic fixtures. The first formal world remains **DO-NOT-IMPORT** pending private per-field review and Catherine's explicit authorization while present. The design PR stays draft; no merge or deployment is authorized.


### Minimum entry-surface product decision (provisional; no production authorization)

Catherine's established direction requires two visible choices: **continue story** (only the current sequential saga frontier) and **free study** (select a course/practice set regardless of story position). Returning from study must resume the same chapter and story cursor; returning to study must retain verified academic work. Declining optional practice cannot block ordinary story progress. This is a narrative UX acceptance decision, not an authorization to alter the live site.

The executable `projectEntrySurface(manifest,state,mode)` reference specifies the **minimum player-facing envelope**. Story entry yields `{mode,currentChapterId,canContinue,resumeActive}`; study entry yields `{mode,selectedDungeonId,availablePractices,verifiedPracticeIds}`. The synthetic fixture exposes every `demo.*` practice for study; a real service must separately enforce enrollment, entitlements, review gates, and authorization. Free study must not return future chapter titles, scene/event refs, director-only copy, NPC identity, hidden conditions, puzzle answers, or unreviewed narration. Story entry must not enumerate future chapters. Both views are read-only and never accept client claims of authoritative progression.

Claude owns endpoint names, frontend controls, authenticated server state, backward-compatible persistence and Worker/D1 tests. The existing site must not infer saga progress from a free-study selection or trust client-submitted `source`, `studyVisits`, or `storyCursor`. This provisional author contract supports synthetic negative tests; it does not approve shipping, data migration, or changing production behavior. Catherine must review the entry UX and save compatibility before release. The first formal world remains DO-NOT-IMPORT.
