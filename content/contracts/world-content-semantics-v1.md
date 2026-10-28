# World content semantics v1 — spoiler-free

This is a rules contract, not a fictional world package. Narrative authorship belongs to ChatGPT; persistent state and implementation belong to Claude.

## Event trigger primitives

The first slice accepts the following typed triggers:

- `scene_entered` — after a committed scene transition; includes sceneId and transitionId.
- `action_resolved` — after the action server returns success/failure; includes actionId, actionTemplateId and outcome.
- `fact_discovered` — after an authorized reveal is recorded; includes factId and discoveringActorId.
- `dialogue_choice_committed` — only after a real player choice is committed; includes choiceId, npcId and sceneId.
- `world_flag_changed` — when a server-owned flag changes; includes flagKey, previousValue, nextValue.

Conditions can be combined with `all`, `any`, `not`, and scope keys. All conditions are evaluated against server-owned committed state. Time-based triggers, NPC autonomous schedules, cross-world triggers and randomness beyond the committed action result are deferred until later versions.

Each event definition has `id`, `trigger`, `preconditions`, `effects`, `revealsFacts`, `narrationHints`, `visibility`, `priority`, `repeatPolicy`. `effects` may contain only allowlisted operations: `set_flag`, `advance_scene`, `set_npc_location`, `change_npc_relation`, `grant_item`, `remove_item`, and `record_fact_discovery`. World mutations are atomic with their cause and idempotent by trigger event id. Any illegal or stale transition is rejected without partial application.

## Minimal NPC state

Author-defined immutable profile: `npcId`, `publicProfileRef`, `privateProfileRef`, `knowledgePolicyRef`, `behaviorRulesRef` (server-only as appropriate).

Server-owned mutable state: `locationId`, `availability` (available/unavailable/unknown), `relationBand` (descriptive rather than fixed affinity numbers), `knownToPlayerFactIds`, `worldFactIdsKnownToNpc`, `questFlags`, `lastCommittedEventId`, `version`.

Separate NPC *actual knowledge* from the player's beliefs about that NPC. Never auto-convert an NPC's knowledge into a player-visible fact. An NPC cannot know an unrevealed event merely because the narration model saw it.

## Authority and privacy

Only server rule evaluation may confirm a world mutation. A language model can suggest a draft action and write narration, but cannot grant items, move characters, reveal hidden facts or retroactively set a success state. A committed event's public effect summary is the only factual basis for player-facing narration.

For `revealsFacts`, include explicit visibility and audience rules. Responses to the player must never include `privateProfileRef`, hidden conditions, future NPC intent or unrevealed facts. Read-only public metadata must not reveal spoilers through titles or ids.

## Knowledge integration

Action templates specify `requiredConcepts` with `conceptId`, `application` and `effectType`. Verify actual application against the action; course-level or concept-name-only matches cannot grant a bonus. Equivalent mathematically valid approaches count when evidence supports the same application.

The v1 concept/application pairs are in `docs/math1920-knowledge-mapping.md`. Narration should make the mathematical relevance clear without turning every challenge into an obligatory test. Nonacademic approaches remain possible where world constraints allow.

## Authoring and acceptance

Every meaningful decision has at least two viable branches or a justified single irreversible consequence. A scene must allow ASK and a noncommittal plan without world mutation. Academic learning can pause and resume without advancing story. Failure cannot remove validated academic evidence. The world must still respond to a chosen action when a player declines tutoring.

Before deploying content, validate: referenced IDs exist; triggers are deterministic from committed state; repeated delivery changes state at most once; stale world versions block mutation; secret fact visibility is enforced; narration uses only committed facts; at least one course knowledge application is natural rather than mandatory.
