# Deferred callback trace continuity — spoiler-free author reference v1

**Scope:** Offline synthetic author QA only, building on cross-chapter-consequence-v1. This deterministic trace is not a real Worker/D1 event processor, trusted authorization mechanism, production migration, import format, or proof that an NPC remembers anything. Every fixture uses invented demo identifiers. The first formal world remains DO-NOT-IMPORT.

## Proposed narration versus confirmed delivery

The previous reference counted render() as delivery. A renderer can produce a proposal without the player receiving it. Now render() returns only {ok:true,visibleCount} and holds a scene-scoped pending offer; repeated offers remain eligible and do not increase snapshot().renderedCount. A separate acknowledge({chapterId,nodeId,commitId,source:'server'}) requires a pending offer at the current scene, rejects malformed/untrusted/stale assertions, consumes the offered callbacks once and records an idempotent commit. The existing renderedCount field now counts **confirmed** callbacks, not proposed ones. Neither response includes author IDs, keys or dialogue.

A successful scene transition discards an unconfirmed offer, so a later eligible scene can re-offer it. A failed transition does not discard the offer. advance() checks confirmed callbacks by their deadline, not mere proposals; a missing confirmation is callback_not_confirmed in author QA only. **Never use this QA failure to block live story progress.** preview() and ask() do not confirm anything. Commit IDs share one session-wide namespace across step/acknowledge/advance; exact replays are idempotent, conflicts rejected. Sessions are isolated and original outline mutation does not affect the copy.

## Trust and gameplay boundaries

The literal source:'server' is forgeable test input, not authentication. Even the synthetic acknowledgement is only an asserted condition, **not proof that a real player saw text**. A real engine needs a trusted session-bound receipt policy, server-derived cursor/revision, durable idempotent event ledger, and renderer/transport failure recovery. Actual client receipt cannot always be guaranteed. Claude owns Worker/D1 and UI semantics. Story progression must remain possible if narration fails, with QA/telemetry rather than a player softlock.

Run node --test test/deferred-callback-trace-reference.test.mjs test/deferred-callback-once.test.mjs test/deferred-callback-delivery-ack.test.mjs from the repository root. These are synthetic Node.js tests, not Worker/D1, model narration, real UI display, or private review. Do not merge Draft PR #1, deploy, change permissions, or import the first formal world without private per-field review, real engineering validation, and Catherine's explicit authorization while present.
