# Dungeon story-grant event semantics v1 (spoiler-free)

Status: proposed authoring and narrative-authorization contract; no production mutation, secret trigger disclosure, or permission to import. Supplements dungeon-public-copy-v1.md. All identifiers and fixtures here are synthetic.

## Meaning of the two grants

`zeroUnlocked` is earned only when the player has *causally completed an author-approved, non-quiz narrative memory milestone* for this specific dungeon. The milestone may be recorded before the final exercise, but `pub.zero` stays hidden until **both** the milestone grant and all chapters' server-verified challenges are complete. Finishing the syllabus, passing a challenge, receiving a skill, or seeing the relevant scene alone never grants it.

`hiddenUnlocked` is earned only when an *independently authored, optional discovery milestone* has been completed by a committed player action and validated against its private world-event prerequisites. It is not a synonym for dungeon completion, route visit, NPC dialogue, or model-generated praise. `pub.hidden` may be revealed before full dungeon completion if the milestone is genuinely met; never reveal its trigger or unearned text.

Both are monotonic, durable, idempotent **per dungeon** grants, backed by server-owned evidence. They are not inferred by the browser, LLM, answer checker, or a client-provided flag. Grant revocation/correction is a separate audited administrative process, not a player-facing action.

## Server-only trigger registry and committed event

Keep a private author-reviewed trigger registry outside client-visible dungeon JSON and outside the public design branch. Each entry binds opaque `triggerRef` to `{worldId, dungeonId, manifestRevision, kind}` where kind is exactly `zeroUnlocked` or `hiddenUnlocked`. The real predicate/identity of the event and evidence stay private. A public package may contain approved display copy but must not include this registry or the event's hidden prerequisites.

The world engine, after committing a consequential action, may emit an authoritative event with `eventId`, `source:'world-event-log'`, `committed:true`, `worldId`, `dungeonId`, `manifestRevision`, `triggerRef`, `kind`, and at least one durable `evidenceRef` to the validated causal record. The grant writer MUST verify the registry match and the authoritative event record before inserting a unique `(dungeonId, kind)` grant with provenance `(eventId, triggerRef, manifestRevision)`. Event replay, concurrent delivery, and repeated visits cannot duplicate rewards. A grant for another dungeon or revision cannot cross-unlock this one.

Fail closed for missing/unknown trigger, uncommitted or synthetic/model/client events, absent evidence, mismatched world/dungeon/revision/kind, or stale unpinned authoring rules. An event that merely reports a challenge answer, chapter completion, skill award, or page view is not valid evidence for either story grant. Do not expose evidence refs, trigger refs, eligibility booleans, or near-miss progress to GET/UI/LLM-facing public copy.

## Narrative acceptance

A grant changes only eligibility for its explicitly approved `pub.zero` or `pub.hidden` string. It does not retroactively change scene history, imply a character's hidden motives, reveal future chapters, or cause an uncommitted action. The existing public-copy projector still independently enforces `allDone` for `pub.zero`. Absence of a grant is a neutral omission, not a spoiler-bearing hint. If the author has not reviewed the display text for its earliest reveal point, omit it even when the grant exists.

## Engineering handoff

Claude owns durable event-log verification, grant table, atomic/idempotent writes, GET projection and Worker/D1 negative tests. This contract does not prescribe an HTTP grant endpoint; **there must be none**. The companion Node tests exercise a synthetic reference reducer, not the deployed engine. Acceptance in the real implementation requires tests for forged client/model events, replay/concurrency, cross-dungeon and cross-revision isolation, independent zero/hidden unlock, zero's completion gate, and GET never exposing trigger metadata. Private v2 candidate remains DO-NOT-IMPORT until Catherine explicitly authorizes import after field-by-field public disclosure review.
