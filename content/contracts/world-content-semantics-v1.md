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

## Chapter-opening continuity snapshot (narrative contract; not implemented)

A later chapter may inherit consequences only from the **successfully committed** ending, never from a preview, narration, an unconfirmed plan, or an uncommitted academic answer. This defines the smallest spoiler-free semantic interface requested by the engine owner. Snapshot creation, storage, versioning and public projection are engineering responsibilities.

**Creation boundary.** Capture an immutable, server-private snapshot after the terminal travel and its matching `scene_entered` ending-lock event have committed atomically. Require the current `ending_locked` value to match the committed terminal scene's `ending.id`. An unsuccessful, declined, stale or conflicting ending creates no snapshot. Replaying the same ending commit returns the same snapshot identity; it must not append a second history entry or replay any cost.

**Required fields** (references, not narrative prose):

| Field | Meaning |
| --- | --- |
| `snapshotSchemaVersion` | Version of this transfer contract, independent of chapter content versions. |
| `sourceWorldRef`, `sourceWorldVersion`, `sourceContentRevision` | Authoritative origin and version to prevent cross-revision mixing. |
| `endingRef`, `endingCommitRef` | The locked ending and its successful commit reference; both server-private. |
| `confirmedFacts[]` | Fact references with provenance: originating committed event, discovering actor, and visibility/audience scope. |
| `npcContinuity[]` | NPC reference, last committed relation band, relationship history references, and **separate** heard claims, beliefs, and confirmed knowledge references. |
| `inventory[]` | Currently owned item references and their last authoritative grant/removal provenance; no hypothetical items. |
| `openThreads[]` | Unresolved clue or obligation references, each with authorization scope and an unresolved marker; no inferred solutions. |
| `learningEvidenceRefs[]` | Existing verified learning-event references, concept references and verification status; never fabricated mastery or a second reward. |
| `carryoverPolicyVersion` | Explicit policy for which fields the next chapter may read; no implicit global memory import. |

**Projection and continuity rules.** The full snapshot remains server-only. A chapter-opening narrator receives a filtered, purpose-limited view: only facts already authorized for that player, visible relation summaries, owned visible items, and explicitly selected open threads. NPC private beliefs and knowledge, hidden ending metadata, unresolved solutions, internal identifiers and other chapters' secrets never appear in the player projection. A narrator's statement cannot elevate a rumor into a confirmed fact. The next chapter may *react* to earlier choices, but must not rewrite the historical commit, erase verified MATH 1920 learning, or award an old evidence reference again. Any new carryover reward or cost needs its own server-authorized event.

**Consistency boundary.** Preserve provenance and per-field visibility when merging chapter state; contradictory NPC claims remain claims. If the source ending, world version, content revision or provenance cannot be verified, fail closed and request an engineering recovery path rather than inventing a default ending. A new chapter may select which authorized references to use, but must never infer unrecorded facts from an ending label. The snapshot is not an instruction to generate Chapter 2 or to expose its content.

**Authoring handoff.** The narrative author supplies which classes of consequences are eligible to persist and how they may influence opening narration; Claude decides physical schema, atomic write timing, replay keys, retention and APIs. These requirements are acceptance criteria only. No snapshot migration or real user state modification is authorized by this document.


## Unresolved thread authoring and carryover (v1; spoiler-free content contract)

This resolves the \`openThreads\` authoring question from the chapter snapshot handoff. It is a **content contract proposal for engine integration**, not a claim that the runtime already supports these fields. A thread is an unresolved clue, obligation or consequence **reference**, not a quest summary or a guessed answer.

Minimal content declarations, with placeholder ids:

\`\`\`json
{
  "scene": {
    "id": "demo-arrival",
    "openThreads": [
      {"id": "demo-question-a", "authorizedAudience": "player", "carryover": "eligible"}
    ]
  },
  "event": {
    "id": "demo-discovery",
    "openThreads": [
      {"id": "demo-question-b", "authorizedAudience": "server_private", "carryover": "eligible"}
    ]
  },
  "resolutionEvent": {
    "id": "demo-resolution",
    "resolvesThreads": ["demo-question-a"]
  }
}
\`\`\`

**Meaning and timing.** \`scene.openThreads\` opens a thread only after that scene is **actually entered by a committed server transition**; use it only when entering the scene itself establishes the unresolved matter. If a player must inspect, ask, discover or choose first, attach \`openThreads\` to the corresponding **committed event**, not to the scene. \`event.openThreads\` takes effect only when that event commits. \`event.resolvesThreads\` closes previously opened threads only after that event commits. Neither a preview, offered route, dialogue draft, narrator suggestion, failed action nor a mathematical answer by itself can open or resolve a thread. This is narrative meaning; Claude owns the atomic storage and trigger implementation.

**Fields.** Each thread declaration has a stable, opaque, non-spoiler \`id\` (unique definition per world), \`authorizedAudience\` in \`player | server_private\`, and explicit \`carryover\` in \`eligible | local_only\`. No default eligibility is inferred: missing or invalid \`carryover\` fails preflight. \`resolvesThreads\` is an array of declared thread ids, not prose or hidden solutions. Unknown or duplicate declarations, incompatible audience changes, and unsupported field shapes are blocking authoring errors. An event resolving a not-yet-open thread must not invent its existence or silently mark it resolved. A closed thread does not reopen on scene revisit or event replay; a genuinely new recurring obligation needs a new id and a new committed opening.

**Snapshot selection.** At a successfully locked ending, collect only threads whose opening was committed, whose resolution was **not** committed, and whose \`carryover\` is \`eligible\`. Each snapshot reference records \`threadRef\`, \`status: "unresolved"\`, \`audience\`, and \`openedByCommitRef\`; it never includes the thread's hidden solution or story prose. \`local_only\` threads remain part of the source-world history but are not copied into the next-chapter snapshot. Snapshot replay must preserve the same set, never reopen or double-close a thread. Source revision mismatches or missing opening provenance fail closed.

**DM visibility.** A \`player\` thread may be included in the next chapter's authorized narration context only if the opening commit is recorded and the carryover policy permits it. A \`server_private\` thread may be retained as a private reference for future server rules, but is **never** included in player-facing DM context or public metadata. An authorized thread reference is not permission to invent its answer, infer hidden motives, or promote a rumor to a confirmed fact. The next chapter may naturally recall an unresolved question when relevant; it must not force a recap or a quiz.

**Boundary for implementation.** These authoring fields do not themselves grant facts, items, rewards or learning mastery. Claude decides persistence, event ordering, import validation and the actual projection API. The content author must only supply the references and authorizations. No real story ids or secret descriptions belong in this public contract.


## NPC testimony, consent and knowledge boundaries (narrative authoring v1)

This is a spoiler-free **DM and content authoring contract**. It does not introduce new runtime fields or ask the model to decide committed world state. Use synthetic examples only in public fixtures; actual NPC identities, knowledge and motives belong in the private content package.

**Separate what a character can say from what the world confirms.** An NPC may recount a direct observation, repeat a claim they heard, offer an inference, or disclose a server-confirmed fact that they are authorized to know and share. Their confidence, social status and eloquence do not convert a claim into world truth. When the source is uncertain, write the line as attributed testimony ("I heard..." / "I think..."), never as omniscient narration. The DM must not infer a hidden answer from the NPC profile or from a private fact visible to a server process.

**Knowledge does not teleport.** The player learning something does not update an absent NPC's knowledge. Telling an NPC about it may create a *heard claim* only after a real committed communication event; it is not automatically that NPC's confirmed knowledge. The same applies in reverse: NPC beliefs do not automatically become player-confirmed facts. NPC location, availability, prior dialogue and relationship history constrain responses; the DM may not retroactively invent an encounter to bypass those limits.

**Respect social agency.** Asking, inspecting a dialogue option or discussing a possible bargain is not the same as selecting and committing it. A character may decline to answer, express uncertainty or withdraw without revealing a hidden reason. Repeated questioning alone must not force disclosure, change relationship bands, spend items or silently advance the world. A change of trust or willingness requires a relevant committed event; narrate only its authorized public consequence. When a social route closes, preserve any legitimate alternative investigation route established by the content, including a non-mathematical one where feasible.

**Let learning arise from testimony rather than replace it.** A character's uncertain claim can motivate an optional measurement, comparison or MATH 1920 inference if the scene already provides sufficient *public* data. Do not fabricate coordinates, derivatives, elevations or an artificial exam gate to make the lesson happen. A mathematically sound deduction remains a deduction until the relevant world fact is verified through the server-authorized action. If the player declines tutoring, continue the social scene without penalty.

**Acceptance boundary.** Test distinct cases for rumor attribution, a claimed certainty without evidence, committed versus merely proposed conversation, an absent NPC's lack of knowledge, respectful refusal, and a voluntary quantitative check. The DM may vary prose, but must preserve those epistemic and consent distinctions. Claude owns the action routing, persistence, fact provenance and runtime harness; these paragraphs authorize no new API or state mutation.


## Narrative continuation and scene momentum (DM acceptance v1)

This is a **spoiler-free narration behavior contract**, not a new event type or a request to let the model mutate world state. It addresses the player's ordinary “继续刚才的 / 继续 / 看看四周” without turning an RPG into a compulsory math exercise. Claude owns any server-side cursor, transport and model integration.

**Resume from authorized continuity.** Interpret “continue” against the most recent *committed* scene and authorized public outcome, plus the most recent player-visible, unresolved conversation beat. Distinguish a committed action from a discussed draft or an offered choice. The DM may describe the current surroundings, an already-committed consequence, an NPC's already-authorized reaction or a newly worded invitation to act; it may not fabricate a new event, reveal a private fact, choose a route or apply effects merely to create momentum. A read-only observation can be vivid and specific using the scene's public text; it never requires an action commit or academic verification.

**Give the player something to do.** After a neutral “continue” with no unique, previously authorized action, narrate the next available *public* beat and offer one or two grounded, editable directions if helpful. If no further public beat exists, ask a short in-world question about what the player tries next; do not repeat internal engine diagnostics (“no concrete world action committed”), invent a blocking mathematical prerequisite or fabricate an inaccessible destination. An offered direction is not a command or an irreversible confirmation.

**Preserve consequences and agency.** After successful travel or a committed event, the next continuation acknowledges its public outcome **once** and remains in the actual destination/state; repeated “continue” never re-triggers entry effects, clue openings, relation changes or rewards. After a failed action, narrate the *authorized* failure and remaining legal possibilities rather than silently undoing it or demanding a math solution. Where two pending plans or destinations remain, “continue the previous one” is ambiguous: ask which one or describe them without selecting. An ending's cost notice always requires separate explicit confirmation; “continue” is not consent.

**Teaching boundary.** A player who asks for a lesson can continue that lesson without committing a world action. A player who wants to resume the story after an optional explanation can do so without a quiz. Mathematics may be offered only when public, relevant information makes it useful; a correct calculation never grants the narrator permission to invent world facts or move the player.

**Acceptance:** Test the same neutral continuation after (1) read-only observation, (2) committed travel, (3) ambiguous offered choices, and (4) a failed action. Assert both grounded prose and server-owned state: no unauthorized mutation, no repeated effects, no hidden identifiers, and no compulsory mathematics. The synthetic sequences in `test/fixtures/dm-multiturn-contract-v1.json` specify the expected turns; they are not claims of live-model passing.
