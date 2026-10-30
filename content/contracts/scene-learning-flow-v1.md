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
