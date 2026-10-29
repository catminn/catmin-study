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

## Release boundary

This is an authoring constraint, not an instruction to rewrite the live save schema or alter existing story progress. Do not replace the site's production state or import synthetic fixtures. The first formal world remains **DO-NOT-IMPORT** pending private per-field review and Catherine's explicit authorization while present. The design PR stays draft; no merge or deployment is authorized.
