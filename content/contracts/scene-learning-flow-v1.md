# Chapter beat and learning opportunity flow — author acceptance v1 (spoiler-free)

This is a **synthetic author-side chapter-beat validator**, not a production engine, a private-world manifest, a real content approval, or permission to import anything. The test fixtures use invented IDs and contain no real story, characters, puzzles, answers, or hidden facts. ChatGPT owns the narrative/learning experience; Claude owns persistence, learning verification, model behavior, and Worker/D1 integration.

## Narrative-learning invariants

1. Every beat has a stable opaque `objectiveKey`, so a player always has a concrete current objective. This validator checks that a key exists, **not** that the corresponding prose is engaging or approved.
2. Every nonterminal beat has at least one **story-only** exit, and all beats can reach a terminal beat without answering a practice question. Exercises are optional opportunities, never mandatory passage fees.
3. Every chapter-beat node is reachable from the entry; an unknown destination, missing terminal, dead end, or cycle is rejected. This contract models an **acyclic beat outline**, not a free-roaming world map, which may contain exploration loops.
4. An offered practice ID must be registered to a stable curriculum skill ID. The relevant skill must already have been introduced on **every** story-only path to that beat. At a branch reunion, knowledge guaranteed on all incoming routes is the **intersection**, not the union. Teaching and then offering a practice in the same beat is valid only if presentation order is teaching first.
5. At least one practice opportunity must exist in the chapter to keep the learning-first design meaningful, while the player can still finish the story route without taking it. The real learning validator must independently verify academic work; this author graph does not award credit, unlock actual skills, or change story state.
6. Failure results contain only stable error codes, never IDs, objectives, story text or private metadata. No player-facing preview or story projection is implemented here; the engine must independently enforce current-frontier visibility and field review.

## Executable acceptance

`node --test test/scene-learning-flow.test.mjs` (Node 22) runs 19 synthetic tests for valid branching, route-specific teaching, practice at a join, unknown IDs, duplicate IDs, malformed data, unreachable beats, cycles, optional exits and fixed-code failure output. The validator is `scripts/validate-scene-learning-flow.mjs` and returns `{ok:true,nodeCount,practiceCount}` only on success.

This does **not** prove actual chapter prose, approved knowledge content, real learning assessment, private first-world behavior, production APIs or Worker/D1. A future private author review must check objective clarity, pacing, pedagogical accuracy and DM dialogue before any authorized import. First formal world remains **DO-NOT-IMPORT** until Catherine is present and approves it.

## Strict author-only schema (addendum)

This validator accepts **exactly** the declared keys. Root: `start`, `skills`, `practices`, `nodes`; each practice: `id`, `skillId`; each beat: `id`, `objectiveKey`, `end`, `teaches`, `offers`, `exits`. Required keys cannot be omitted. Extra keys are rejected with `shape_invalid`, `catalog_invalid`, or `node_invalid`, respectively, without returning the offending value.

All `exits` in this **author-only outline** mean unconditional story-only transitions. Fields such as `exitGates`, `requiresPractice`, `requiresVerifiedPractice`, `practiceMandatory`, or an unknown custom field are not silently ignored: they invalidate the outline. A richer authored format must be explicitly mapped to this narrow projection and separately checked for whether every projected story exit truly stays ungated. The current validator cannot inspect external runtime gates, prose presentation order, or other systems' interpretations of these IDs; a passing outline is **not** proof that the production story can progress without practice.

Additional executable acceptance: `node --test test/scene-learning-flow.test.mjs test/scene-learning-schema.test.mjs` runs the original 19 synthetic tests and 15 strict-schema tests (34 total), including hidden gate metadata and fixed-code no-echo behavior. This is a reference-only contract; it does not authorize production changes or private content import.

## Every-route opportunity coverage (addendum)

A single practice somewhere in the chapter is insufficient: a player who chooses a different story route might encounter no learning opportunity at all. For **each story-only route from `start` to any terminal beat**, at least one *optional practice offer* must be encountered **before** the terminal beat. An offer made only at the ending does not count as pre-ending integration. This is a coverage requirement, not an obligation to answer, verify, score or complete a practice. Unconditional story exits remain available.

The validator computes a Boolean guarantee in topological order: a beat inherits an opportunity only when **all** its incoming story paths have already encountered one; a nonterminal beat with `offers` can establish that guarantee locally. Every terminal beat must inherit it, otherwise the result is the fixed code `learning_path_missing`. Branches may use different registered practice IDs, provided each offer still meets the all-path prior-teaching invariant. No author IDs, text, private metadata or branch names are returned in errors.

The pre-existing same-beat-teaching acceptance fixture now offers the practice on both branches when removing the shared post-join opportunity; otherwise it would rightly leave one route without any practice offer. `node --test test/scene-learning-flow.test.mjs test/scene-learning-schema.test.mjs test/scene-learning-path-coverage.test.mjs` executes 44 synthetic tests in Node 22 (19 existing with that fixture adjustment, 15 strict-schema, 10 new coverage tests). This remains an **author-only outline**: it cannot prove runtime UI displays an offer, that a player notices it, that the academic material is correct, or that external engine transitions are truly ungated. No real-world import or production change is authorized.
