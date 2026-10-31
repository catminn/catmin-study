# World 01 route agency cross-check v1 — synthetic authoring only

This is a **spoiler-free, offline** consistency check for the public first-world mechanical skeleton (`world01-opening-skeleton.json`) and its synthetic causal outline (`world01-causal-authoring-v1.json`). It is not a runtime validator, private-world review, story storage mechanism, production authorization, or import gate.

`validateWorld01RouteAgency(world, causal)` requires two distinct committed exits from one choice scene, exactly matching that scene's outgoing options. Each branch must reach a shared convergence without visiting the other branch beforehand, and every pre-convergence continuation must have a path to that reunion. The two committed events need unique identities and route traces. Each event must produce its own NPC relationship state, and the post-convergence outcome mapping must preserve those differences and the committed event history.

Optional learning must be offered in **both** route scenes, with explicit player consent and a nonacademic continuation. This does not mean the player must complete a practice or that the academic work has been verified. The author-side check also rejects fabricated measurements and narrator-committed effects. All errors are fixed codes without IDs or text; input is not mutated.

Run `node --test test/world01-route-agency.test.mjs` under Node 22. The 19 synthetic tests cover successful and reversed-route registration, collapsed choices, mismatched exits, invalid commits, cross-route bleed, missing convergence, NPC state erasure, incorrect consequence attribution, lost route memory, one-sided learning and forced academic gates. This is a **separate cross-check**, not a replacement for the existing world01 causal lint, DM/NPC bridge, scene-learning validation, real Worker/D1 tests or model experience review.

The first formal world remains **DO-NOT-IMPORT**. No private plot, character identity, hidden fact, answer, approved dialogue, or production state belongs in this contract or its tests. Real per-field private review and Catherine's explicit authorization are required before any official-world import.
