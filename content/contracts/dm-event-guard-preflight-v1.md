# DM event-guard combined authoring preflight v1

This spoiler-free synthetic-only helper runs the three existing checks in a fixed order:
`validateDmBeatFlow(flow)` → `validateDmEventGuards(guards)` → `validateDmEventGuardBridge(flow, guards, bridge)`.

Call `validateDmEventGuardPreflight(flow, guards, bridge)` from `scripts/validate-dm-event-guard-preflight.mjs`. It accepts the existing v1 beat-flow, event-guard and bridge structures without extending their schemas. Only `{ok:true,matchedRoutes:2}` means the **three authoring checks** passed. Failure returns a fixed code: `dm_flow_invalid`, `guard_plan_invalid`, `bridge_invalid`, or `invalid_input`. The helper intentionally does not echo IDs, public copy or any source payload.

`test/dm-event-guard-preflight.integration.test.mjs` imports all three real validators and uses only the existing synthetic fixtures. It verifies both routes, order independence, source-only failures, bridge-only failures, fail-closed behavior and no input mutation. This prevents treating a standalone bridge pass as complete approval.

**Limits:** no event execution, server-authenticated commits, Worker/D1 state, actual copy approval, model narration, hidden-content review, or CI integration is implied. In particular, the synthetic flag simulation is not evidence that real runtime guards match. Never use this helper as import authorization. The first official world remains **DO-NOT-IMPORT** pending private field review, engineering tests and Catherine's explicit in-person approval. No private narrative or NPC identity belongs in this public branch.
