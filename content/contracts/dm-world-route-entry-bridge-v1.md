# DM ↔ world route entry provenance bridge v1

**Boundary:** Public, spoiler-free, synthetic author-side reference only. No formal plot, NPC identity, hidden truth, solution, or private story identifier belongs in this file or its fixtures. This check is not a runtime guard, private editorial approval, deployment instruction, or permission to import.

The existing `dm-payoff-route-reachability-v1` proof uses author-declared `entrySceneId` values. Two reachable entries can still be assigned to the wrong committed route; a separate graph projection can also invent edges that are absent from the reviewed world skeleton. Both mistakes may produce a false positive in an otherwise correct static reachability test.

`validateDmWorldRouteEntryBridge(world, causal, flow, actions, graph, proof, bridge)` composes the existing world01 causal author validator and the existing two-route payoff reachability validator. After both pass, it checks that:

- The two committed DM routes are each mapped once to distinct world route commit IDs and trace references.
- Each proof's `entrySceneId` is exactly the target of its mapped committed world route, rather than an arbitrary reachable scene or the opposite branch.
- The separate payoff graph contains exactly the same scene IDs and directed exits as the reviewed world skeleton; node and exit order is irrelevant, invented or omitted edges fail.
- The world, DM flow, proof, and bridge agree on their world and DM revision scopes.

The bridge shape is exactly `{schemaVersion:"dm-world-route-entry-bridge-v1",synthetic:true,worldId,dmRevision,routeBindings}`, where `routeBindings` contains exactly two entries of `{routeBeatId,routeCommitId,traceRef}`. Identifiers must follow the existing author ID syntax. Diagnostic codes are fixed and non-echoing: `bridge_invalid`, `world_contract_invalid`, `payoff_contract_invalid`, `scope_mismatch`, `projection_mismatch`, `route_binding_mismatch`, or `invalid_input`.

Run `node --test test/dm-world-route-entry-bridge.test.mjs` on Node 22. The fixtures contain only invented demo data, including positive route reorderings and negative cases for swapped branches, pre-choice entry, fabricated exits/scenes, duplicate mappings, mismatched revisions, and invalid source contracts. The design-branch CI auto-discovers `test/*.test.mjs`.

**Remaining trust boundary:** The route-to-commit mapping is still a reviewed *author declaration*. Cross-checking two static sources cannot attest that the Worker actually commits that route, that the runtime graph has identical exits or guards, or that a nonacademic exit is available. Claude must verify actual route/guard/trace mapping with synthetic Worker/D1 and model/browser tests in a fresh test database. This check does not replace full DM beat validation, private field-by-field story review, or Catherine's explicit in-person authorization. First formal world: **DO-NOT-IMPORT**.
