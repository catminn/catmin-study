# Unified DM authoring preflight v1 — synthetic only

Use `validateDmAuthoringPreflight({flow,guards,bridge,chapter,alignment,actions,worldGraph,links,proof})` from `scripts/validate-dm-authoring-preflight.mjs`.

This author-side entry point runs the **real three-stage DM event/guard preflight**, then the **real dual-route optional learning-payoff preflight**, on the **same flow object**. It finally cross-checks both committed route IDs and trace references between the guard bridge and world reachability proof. All three checks must pass for `{ok:true,validatedRoutes:2,validatedLinks:2}`. It rejects extra/missing root fields, partial passes, missing routes and mismatched identities; failures use fixed codes only: `input_invalid`, `event_guard_invalid`, `learning_payoff_invalid`, `route_crosswalk_invalid`, `invalid_input`.

`test/dm-authoring-preflight.integration.test.mjs` exercises the real dependency chain against synthetic positive and negative cases, including both routes, mismatched event guards, optional practice coverage and world action reachability. Run with Node 22: `node --test test/dm-authoring-preflight.integration.test.mjs`.

**Boundaries:** This is not a public-content approval, runtime event gate, server-authenticated route check, proof of mathematical causality, or model narration evaluation. The author-declared world graph may omit runtime gates. No private plot, NPC identities, hidden facts, answers, or real content hashes belong in this repository. The first official world remains **DO-NOT-IMPORT** until private field review, real Worker/D1/model verification, and Catherine's explicit in-person authorization. The script is not wired to CI, import, production or deployment.
