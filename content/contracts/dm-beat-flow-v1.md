# DM beat flow and natural knowledge integration — author preflight v1

**Status:** spoiler-free synthetic authoring contract, not a runtime implementation or permission to import. This defines the *rhythm* of one playable scene: observable stakes, a voluntary learning opportunity, an actual decision, an authoritative consequence, and a later callback that remembers the player's route. It does not define the real first-world plot. All `demo.*` values in the fixture are invented placeholders, not production references.

## Why this separate contract exists

A correct quiz and a valid world transition can still make a poor DM experience: a lesson may arrive without an in-world reason, the narrator may interrupt the player's choice, or two routes may converge with no remembered difference. The author must demonstrate that the concept enters through a **visible observation**, that help can be declined without penalty, and that the story reacts to a **committed** choice rather than an academic score or a model's assertion.

The synthetic beat sheet has eight roles: `entry → observation → lesson_offer → choice → route-a|route-b → convergence → aftermath`. The lesson offer is a narrative invitation, **not a required teaching or practice node**. `skipTo` and `resumeTo` are the same existing choice beat. ASK, optional tutoring and preview do not move the world cursor or change any state. A learner who refuses the lesson still gets both normal choices. An optional verified skill may later supply an additional voluntary approach under `dungeon-skill-action-binding-v1`, but no skill is necessary to attempt a base route.

## Author acceptance rules

1. **World first, concept second.** The observation beat must establish a player-visible reason to consider the concept. `anchorBeat` points to that observation; `applicationRef` identifies an actual in-world use for author review. A course topic label alone does not justify a lesson. The validator checks structural anchoring, **not** whether the explanation is pedagogically good.
2. **Voluntary and resumable.** A `lesson_offer` has `optional:true`, `mutatesWorld:false`, `requiresPass:false`, and `skipTo === resumeTo === next[0]`. Teaching/ASK is a temporary conversational detour; it cannot open a secret, grant a world fact, move an NPC or consume a turn. Declining does not imply incompetence or a story penalty.
3. **Two genuine actions.** The choice has two distinct route beats. Each requires a committed `action_resolved` event and a unique opaque trace. These traces are private references to **actual server outcomes**, not rewards inferred from answers. The author must still review whether the two actions differ meaningfully; topology alone cannot prove this.
4. **Consequences survive convergence.** Both routes reach the same convergence beat, which has a separate approved-copy slot for each committed trace. Without the matching committed trace, neither route-specific callback is eligible. The validator checks callback coverage and uniqueness, not whether the copy itself is approved or truthful.
5. **No public secrets.** This contract stores only opaque copy-slot and evidence references. It prohibits arbitrary prose or extra keys in the synthetic sheet; real public copy must pass the separate trusted field review and stage gate. Do not put future facts, NPC identities, answers, hidden flags, or private story text in this branch, test fixtures, CLI output, or shared-memory handoff.
6. **No engine authority.** A `requiresCommit:true` field is an authoring assertion, not a client-controlled proof. Claude's server must derive commit provenance, session/world/revision scope, actual action outcome and authorized copy projection from trusted state. The validator cannot verify live event signatures, D1 transactions, the model's spoken response, or actual player enjoyment.

## Sequence is part of the narrative contract

All seven beat roles must follow the intended story order: `entry → observation → lesson_offer → choice → route → convergence → aftermath`. The optional learning invitation is a detour **before** the consequential choice, not a retrospective lesson after a committed route or callback. A reachable, acyclic sheet can otherwise move the observation and lesson behind the route while still satisfying the original graph and skip checks. The fixed `beat_sequence_invalid` diagnostic rejects that false positive without exposing any authored beat IDs or text. This is an author-side topology rule, not a real-time model-turn guarantee; the learner may still skip the offer and proceed to the same choice.

## Run and expected limitations

`node scripts/validate-dm-beat-flow.mjs test/fixtures/dm-beat-flow-synthetic-v1.json`

`node --test test/dm-beat-flow.test.mjs`

The preflight returns only `{ok,codes,errorCount}`. No path, field value, hidden reference or user-provided text appears in diagnostics. Tests deliberately mutate a public synthetic fixture. This is a **structural narrative acceptance harness**, not an automated literary critic. Private author review must still check whether the first world has an interesting opening, a plausible concept application, two meaningful routes, consequences proportional to the player's decision, and stage-approved copy. Claude may translate the semantics to existing event/turn APIs after the engineering backlog; no new public fields or production migration are requested by this contract. Real content stays **DO-NOT-IMPORT** until private review and Catherine's explicit in-person authorization.
