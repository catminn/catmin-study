# Failure-forward DM consequences — spoiler-free author acceptance v1

**Scope:** This is an author-side synthetic acceptance harness for the first formal world's *failure experience*. It is not the real plot, a runtime engine, a secret-content store, a live review approval, or permission to import. All `demo.*` references in the tests are invented.

## Narrative decision

A failed attempt must not turn the infinite-flow world into a quiz gate or an arbitrary reload. The player may succeed, incur a genuine setback, or intentionally refuse the action. A setback has a distinct committed cost and a subsequent recovery route; a refusal does not automatically inherit the setback's penalty. Neither outcome erases the player's agency. The story may later remember each route through a different approved public copy slot, but the narrator cannot invent a cost, retroactively assert an event, or leak a future revelation.

An ASK, preview, or declined *optional lesson* does not commit a world action. By contrast, an explicit in-world refusal can be a committed choice if the player confirms it. This distinction prevents casual questions from being misread as irreversible decisions. Learning may provide an optional enhancement; it is never the sole path to recovery. An ordinary nonacademic recovery must remain available after a setback or refusal, even when no skill has been verified.

## Machine-checkable author preflight

The synthetic `dm-failure-forward-v1` input has three ordered scene references (entry, recovery, later-chapter aftermath), a single attempt with success/setback/refusal outcomes, one or more recovery actions, and two later callbacks. Each outcome requires an opaque committed event reference and a distinct public-copy slot. Setback alone requires a cost reference. The two callbacks must be tied to the exact committed setback/refusal events and occur at the later aftermath scene. No freeform story text, NPC profile, hidden clue, director fact or unapproved copy can appear in this schema. The validator only returns error codes and counts.

The structural tests deliberately reject forced quiz/skill recovery, no-cost setbacks, punitive refusal, uncommitted outcomes, same-chapter premature aftermath, orphaned callbacks, loops, alias collisions and state-changing ASK/preview. This checks the author contract, **not** whether the cost feels fair, the choice is emotionally compelling, or the writing is good. A private human DM review must still evaluate those qualities using the authorized story package.

## Integration boundary and safety

Claude owns authenticated event commits, server-owned provenance, session/revision pinning, atomic cost application, idempotent replay, approval-sidecar checks and Worker/D1 regression. The `committed:true` strings in this synthetic sheet are author assertions, never authentication. Player-visible copy requires separate independent approval and stage gating; a callback cannot be released just because the client or model says an event happened. These tests do not exercise the actual DM model, browser, concurrency, private world, or production database.

Run `node --test test/dm-failure-forward.test.mjs`. No `demo.*` reference is a production action key, event ID, NPC or plot point. Do not import the synthetic example. First formal-world private material remains **DO-NOT-IMPORT** until Catherine is present for explicit authorization after private field-by-field review. Keep Draft PR #1 unmerged and do not alter production, real saves, permissions or deployment.
