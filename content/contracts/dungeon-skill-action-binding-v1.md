# Dungeon skill → world action binding v1 (spoiler-free)

**Status:** authoring contract and executable synthetic preflight, not a live engine feature or approval to import content. ChatGPT owns the author-approved meaning of each optional use; Claude owns the skill persistence, world action resolution, server gates, UI and real Worker/D1 tests. No story text, NPC identity, hidden condition or answer belongs in this repository.

## Purpose and boundary

A verified dungeon chapter can unlock a stable `skill.id`. The skill may offer an **optional, contextual advantage** on an existing world-scene exit. It must never replace a player choice, force tutoring, unlock a story destination automatically, award a world fact, or silently commit travel. A nonacademic attempt of the underlying exit must remain available whenever the world engine would otherwise permit it. Academic correctness is deterministic; world consequences are decided separately by the server.

A private authoring binding has `worldId`, `dungeonId`, `manifestRevision`, `skills[]` (four `{chapter,skillId}` entries for the first four-chapter candidate) and `bindings[]`. Each binding has an opaque, stable `actionKey`, `from` scene ID, `to` scene ID, `skillId`, `baseActionKey`, and an `advantage` category (`evidence_option` or `risk_context`). The `from→to` pair must already be an allowed directed scene exit. `actionKey` is a **proposed server-side content binding key**, not a claim that the current `src/world.ts` accepts such a field. `baseActionKey` is the ungated ordinary attempt; it does not bypass any existing `entryRequirements`, ending consent, or world version check. All keys in the public fixture are synthetic.

### Server-authoritative eligibility

An optional advantage can be offered only when the current session's **pinned** world ID and manifest revision match the binding; the dungeon identity matches; the relevant chapter's practice has been verified by the server; the same dungeon/chapter has a persisted, matching `skill.id` unlock; and the player's current scene/selected exit match the binding. Missing/ambiguous IDs, cross-world or stale revisions, unverified practice, a different skill, or a scene mismatch all fail closed **for the advantage only**. The base action remains subject to normal world checks and is not disabled by this failure.

The player must deliberately choose to use an eligible advantage. Merely viewing a button, asking the DM, completing a quiz, or possessing a skill cannot commit an event, move an NPC, change a route or reveal a fact. A successful world action is a separate server transaction with the existing commitId/expectedVersion/idempotency rules. Skill eligibility does not assert success; world failure does not revoke verified learning. The DM may narrate an approved application after the world commit but must not invent measurements, evidence, or an event result.

### Authoring review and privacy

Private authoring review must bind the four real skill IDs to four actual, already-declared world exits and check that each advantage is causally relevant to the situation. An abstract math label is not sufficient evidence. Do not expose unrevealed scene labels, future exits, skill-effect spoilers, secret evidence or trigger conditions through a public choice list. The synthetic fixture is **not** the private first-world binding and must not be imported. Public errors and validator output contain only generic error codes/counts, not values from the private file. A real package and any new player-visible copy still require separate trusted author review and Catherine's explicit in-person authorization before import.

### Engineering handoff / acceptance

The existing engine currently commits `travel` using a target in `scene.choices` and `choice` using `choiceId`; it has no `actionKey` routing primitive. Claude should choose a server-side adapter mapping this contract to those existing commits, not treat this JSON as a drop-in engine schema. Persist `skill.id` (not merely display name/effect) with its dungeon/chapter and associate the unlock with the correct world/session scope. Test positive eligibility, wrong world/dungeon/revision, unverified or stale unlock, ASK/preview no-op, nonacademic base travel, duplicate commit replay, failure without learning rollback, and projection without future/hidden metadata. All tests against actual Worker/D1 remain Claude's responsibility.

Run the standalone synthetic authoring check with `node scripts/validate-dungeon-skill-actions.mjs test/fixtures/dungeon-skill-actions-synthetic-v1.json content/contracts/world01-opening-skeleton.json` and the behavior tests with `node --test test/dungeon-skill-actions.test.mjs`. The validator can also accept an **offline private** mapping/graph; do not commit that input or paste its diagnostics into public logs.
