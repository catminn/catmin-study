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

## Ending commitment contract (v1 proposal confirmed by narrative author)

This section specifies **authoring and DM consent semantics**, not implementation, UI or story content. It uses synthetic ids only.

A terminal scene may declare:

```json
{
  "ending": {
    "id": "ending-demo-a",
    "costNotice": "Continuing will close other routes in this world. Do you want to commit?"
  },
  "entryRequirements": {
    "all": [
      {"flag": "demo-route-ready", "equals": true}
    ]
  }
}
```

- `ending.id` is a stable, non-revealing token. Every terminal scene must have a distinct id. The same value is written through the **terminal commit event** as `lock_flag {target:"ending_locked", value:"ending-demo-a"}`; **never** write the ending lock as a scene-entry effect.
- `costNotice` is mandatory for **each** ending, concise and truthful about meaningful irreversible consequences, and safe to show **before** commitment. It must not disclose a hidden resolution, future scene or private condition. The notice is not a prediction of a particular roll or an invented state change.
- `entryRequirements` is a server-evaluated precondition expression using existing `all`/`any`/`not` and supported leaves. Failure blocks every entry path, including direct travel, event-driven `advance_scene`, and replays; it is never satisfied by narration alone. A failed gate must return a spoiler-free, in-world explanation, not raw flags or ids.
- Reaching a terminal route is **not** the same as committing its ending. First show the applicable `costNotice` in the current player's session; then require a separate, explicit, unambiguous player confirmation for that **same** ending and current world state. Preview, discussion, silence, a generic "continue", or merely clicking a destination must not commit.
- The engine may use `confirmEndingId` plus a server-side record of which notice was shown, bound to session, target and world version. The exact transport, token and concurrency implementation belong to Claude. A stale confirmation, a changed target, or a notice not shown to that player must fail closed and permit a new preview. Do not put private conditions in client-visible confirmation data.
- Only after valid requirements and confirmation should the server atomically apply the ending event, lock and resulting state. If another ending is already locked, reject the conflicting commit without partial effects. Duplicate confirmation must be idempotent; retry must not charge or narrate the consequence twice.
- If the player declines or asks to reconsider, preserve the world and learning state, allow ordinary exploration and alternative routes where still viable, and do not force a quiz. Academic evidence can inform a choice but never substitutes for consent.
- Post-ending continuity is derived from **committed** state, not a narrator's hypothetical ending. The shape of any later chapter snapshot remains an open implementation interface.

**Content preflight boundary:** Invalid `ending` shape, missing/blank `costNotice`, missing or unsupported `entryRequirements`, duplicate ending ids, a terminal scene with an eager ending lock in `stateEffects`, or an ending with no matching lock commit are **blocking content errors**. Unknown referenced scene/NPC/fact ids and structurally invalid `stateEffects` are also blocking errors. A `remove_item` whose item has no known grant path is a **warning for author review**, not an unconditional error, because an item may be granted at world initialization or in another permitted flow. Do not print private ids, notices or condition values in diagnostics; report only category and count. This defines authoring expectations, not a claim that the current preflight implements them.
