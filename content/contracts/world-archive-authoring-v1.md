# World Archive & Global Story Bible — public contract v1

This file defines authoring semantics only. It contains no canonical plot, NPC secrets or private world content.

## Layers and authority
- **Global Story Bible (shared)**: narration style, player agency, authorized knowledge integration, NPC epistemic discipline. Apply to every world.
- **World Bible (private, versioned per world)**: premise, dramatic arcs, scenes, NPC motives and knowledge, hints, ending cost notices, canon references and world-specific learning affordances. This data belongs in a private server store or encrypted private authoring repository, NOT public GitHub.
- **Player run (server-owned)**: selected worldId, pinned canonical revision, session commits, acquired evidence, relationship history and snapshot. The DM must never fabricate a commit.
- **Course packs (cross-world)**: independently versioned concepts and stable narrative application tags in `content/contracts/application-taxonomy-v1.json`. A world opts into selected applications via its current authorized scene cues.
- **Optional generated side quests**: proposals only. Require source review, in-world causal review, spoiler/continuity review and a deliberate publication decision. An AI suggestion is not canon.

## Global narrative principles
1. Direct observation, conversation, lawful travel, and neutral continuation work without mathematics. Respond immersively; never demand “submit a world action” for looking around.
2. Math arises only when observable clues and an approved application naturally justify it. No invented measurements, artificial quiz gates or repeated unsolicited offers.
3. Maintain scene continuity; give each NPC stable objectives, location, relationship history and distinct private/public knowledge. Rumor != witnessed evidence != confirmed world fact.
4. Only verified server commits affect facts, locations, inventory, endings and consequences. DM narration cannot change these.
5. Do not leak unrevealed lore, future plot beats or private NPC beliefs in a player prompt, logs, public exports or Google Drive.
6. Meaningful choices should lead to believable alternatives, including a nonacademic path. Mathematical sophistication can provide insight, not compulsory access.
7. Authoring and tests should detect unsupported lore additions, repeated exposition, mechanical system wording, unearned twists and inconsistent NPC memory.

## Identity and version boundaries (engineering contract)
- Every active run selects exactly one `worldId` and pins `canonicalRevision` on initialization; ambiguous legacy runs fail closed.
- Every world-owned scene/event/NPC/fact/flag/thread/ending references a world namespace, at minimum `worldId:localId` within authoring manifests or a compound DB key. Identical local IDs across worlds are legal.
- New revisions do not retroactively rewrite committed sessions; migration is an explicit, validated transaction.
- World-specific private facts are isolated. Cross-world transfer defaults to nothing unless an explicit versioned transfer contract enumerates authorized player-visible evidence and consent.
- A private World Bible has author, revision, parent revision, content hash, review state, engine compatibility and immutable publication history.
- Player responses only contain the subset authorized for current world, scene, player and turn; a named world elsewhere is never an implicit lookup fallback.

## World Bible required authoring sections
`worldId`, `bibleRevision`, `canonicalStoryVersion`, `globalRulesVersion`, `status`, `premise`, `publicPremise`, `themes`, `tone`, `historicalTruths`, `storyArc`, `actOutlines`, `sceneRefs`, `npcRefs`, `eventRefs`, `knowledgeApplications`, `unresolvedThreads`, `endings`, `authoringConstraints`, `provenance`.

Story beats should record: scene causality, player-visible setup, hidden author-only truth, NPC motivations, reversible/irreversible choice effects, prerequisite evidence, alternative outcomes, and rollback-safe references. Public projections must strip all private sections.

## Acceptance gates before publishing a world or generated side quest
- World ID and references resolve only within that world's revision.
- NPC presence, knowledge and relationship state remain causally justified.
- Every plot revelation has an authorized trigger and sufficient foreshadowing.
- Learning application IDs are registered; sources are approved; scene public cues and any quantities exist and are player-visible.
- There is a playable non-math path unless a player explicitly opted into a learning challenge.
- World effects and ending locks are validated by the server; no narrative text grants a hidden flag or item.
- Generated drafts do not silently alter canon. Failed checks preserve the previous published revision.

Detailed executable synthetic examples also ship in the private user-delivered `world-archive-v1.zip`; private plot must never be copied here.
