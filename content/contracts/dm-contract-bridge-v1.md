# DM beat × failure-forward integration — spoiler-free author preflight v1

**Scope:** A cross-contract, synthetic author acceptance check. It composes the existing `dm-beat-flow-v1` and `dm-failure-forward-v1` validators. All `demo.*` identifiers are invented. This is neither a production engine nor private story material, field approval, authentication, or an import mechanism.

## Authorial purpose

Two individually valid authoring sheets can contradict each other. For example, a route may remember one trace while a consequence sheet points at a different scene; a public-copy slot may accidentally be reused for unrelated events; or the two sheets may refer to different revisions. This bridge rejects those mismatches before a real world is privately reviewed.

The bridge binds one committed route beat to a failure-forward attempt, its convergence beat to recovery, and the later aftermath beat to both callbacks. It requires the same world and revision, an actual graph path through the named beats, an existing route trace and convergence callback, distinct public-copy slots across the two sheets, and separate identities for route traces versus committed consequence events. The underlying validators independently require optional learning, a nonacademic recovery, and callbacks only for committed consequences. This bridge is a deliberately narrow composition, not a new source of gameplay authority.

The bridge object has exactly six fields: `schemaVersion`, `synthetic`, `routeBeatId`, `routeTraceRef`, `recoveryBeatId`, `aftermathBeatId`. It contains no prose, hidden data, NPC identities, player data, approvals, private evidence, or hashes. The checker returns only error codes and counts; it never echoes source content. No synthetic ID or copy slot should be imported into a real world.

## Run and limits

Run `node --test test/dm-contract-bridge.test.mjs` from the repository root. The tests load the existing synthetic beat fixture and create an invented compatible consequence sheet. The checker calls both existing validators before cross-checking their relationship.

This checks static structural consistency only. It cannot prove that a route is emotionally satisfying, that a penalty is fair, that a DM's prose is good, that a server event actually committed, or that any copy was approved. It does not exercise Worker/D1, real model output, concurrency, private world content, or production. Claude owns any authenticated integration and real-engine regression; private story authoring and human review remain separate. The first formal world remains **DO-NOT-IMPORT** until private field-by-field review and Catherine's explicit authorization while present. Draft PR #1 stays unmerged; no production, real saves, permissions or deployment changes.
