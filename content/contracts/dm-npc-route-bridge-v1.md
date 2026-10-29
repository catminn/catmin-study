# DM/NPC route-continuity bridge v1 — synthetic authoring contract

**Scope:** A spoiler-free, offline, author-side consistency check for the first formal world's scene structure. The JSON fixture contains invented IDs and no official plot, identities, clues, hidden facts, answers, or private content hashes. **DO NOT IMPORT** it. This is not a runtime guard, an approval record, a security audit, or a DM-model quality test.

## Author invariants

1. Run `validateDmBeatFlow` before linking the scene beats. The two committed route beats must lead to the same convergence scene, with distinct trace refs and separately reviewed callback slots. The optional lesson must remain skippable.
2. Bind each route beat to exactly one NPC reference-state route. The NPC route's origin must be the actual choice scene, its destination must be the committed route beat, and its trace must equal the scene trace. Never infer an NPC's route from narration alone.
3. The NPC's arrival at convergence must preserve the relation produced by the committed route; each relation selects its own approved public dialogue. Before the NPC is present, dialogue is unavailable. Neither route may silently display the other route's dialogue.
4. The author must review each public dialogue independently. A synthetic `approved: true` value is only a test assertion, **not** real author approval. Real content requires the separate trusted review-sidecar workflow and Catherine's explicit in-person authorization before any import.
5. ASK and previews do not commit world state. Replaying an already committed route event is idempotent. No dialogue, actor identity, fact ID, internal trace, or event evidence should be returned by the validator: diagnostics contain fixed codes and counts only.
6. This bridge's `route_committed` / `scene_entered` events are **reference-model** events, not the production engine's `action_resolved` wire format. Claude owns any real Worker/D1 mapping, session-scoped persistence, authorization, and multi-turn tests.

## Synthetic acceptance

Run `node --test test/dm-npc-route-bridge.test.mjs` from the repository root. The bridge imports the existing `scripts/validate-dm-beat-flow.mjs` and `scripts/npc-testimony-reference.mjs`; it never writes a save, accesses a network endpoint, or calls an admin API. Its two routes must each reach the convergence with different relations and distinct approved dialogue. Negative tests cover wrong scopes, route/callback aliases, missing approval, invalid graph, premature dialogue, and erased route consequences.

**Unverified:** Real private NPC identities and world scenes, actual dialogue quality, trusted review provenance, production authorization, D1/Worker state transitions, concurrent submissions, model narration, and real-world gameplay. Keep the formal v2 world **DO-NOT-IMPORT** until private review and Catherine's authorization.
