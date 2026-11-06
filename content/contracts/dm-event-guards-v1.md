# DM causal event guards v1 — spoiler-free synthetic author preflight

**Boundary:** An offline, author-owned *synthetic* causal-graph reference. Every scene ID, route flag, event reference and copy slot is invented. This is neither a real first-world plot map nor a runtime guard, a trusted approval artifact, an identity check, or a production import format. **DO NOT IMPORT** the fixture or treat the boolean `synthetic` as proof of authorization.

## What is checked

The scene order is strictly forward for committed actions. The finite-state walk starts with no route flags and explores all enabled committed transitions; every authored scene and committed action must be reachable, every reachable nonterminal state must have a continuation, and every reachable state must be able to reach the terminal scene. The walk is bounded to 128 states and fails closed if the bound is exceeded.

Two independently committed choices leave the fork and enter the merge. Their route flags must be mutually exclusive and durable. At the merge, each callback is gated by the corresponding committed route flag and excludes the competing flag. No extra unmapped branch action may bypass the intended choice/callback path. The terminal states must retain two distinct route/callback histories. This guards against route erasure, cross-route narration, unreachable actions and accidental dead ends; it does **not** certify the quality of any dialogue.

A committed transition has a unique event reference and a distinct public copy slot listed in the synthetic copy-slot registry. That registry is a fixture allowlist only: it **does not establish real editorial approval**. The real trusted review sidecar must independently approve each player-visible field, with the appropriate scope and earliest-visible stage. Unrecognized source fields are rejected; the validator returns only fixed error codes and counts, never source values or content.

ASK and preview are self-loops without event references, copy slots or state effects. The isolated reference action runner demonstrates no-op previews, server-labelled commits, stale-version rejection, same-commit replay and conflicting replay rejection. Its `source: 'server'` is only a *test assertion*, not authentication. Claude owns any real event identity, authorization, session scope, atomic D1 commit, concurrency safety and Worker integration.

The reference grammar deliberately excludes academic-pass predicates. Knowledge may motivate a voluntary choice but may not become a mandatory gate to story progress. Private NPC facts, hidden flags, secret route maps, answer keys and private hashes must never be placed in the public design branch or in shared project-status.

## Verification

From the repository root:

```sh
node scripts/validate-dm-event-guards.mjs test/fixtures/dm-event-guards-synthetic-v1.json
node --test test/dm-event-guards.test.mjs
```

These checks cover guard contradictions, forged or erased route evidence, wrong callback, aliasing, unregistered copy slots, unreachable scenes/actions, softlocks, branch bypass, preview mutation, stale requests, idempotent replay and fixed-code privacy. They do not run the real Worker/D1, real model narration or the private first-world content. Formal v2 stays **DO-NOT-IMPORT** pending private per-field review and Catherine's explicit authorization in her presence.

## Bounded author registries and guard arrays

The reference rejects oversized arrays **before** scanning their contents: at most 16 scenes, 12 flags, and 128 registered public copy-slot IDs per synthetic sheet; each transition guard/effect ID list has a 12-item limit. The 48-transition and 128-state limits remain unchanged. These authoring QA resource limits are not narrative or gameplay restrictions. Registry overflow returns `invalid_registry`, and transition guard/effect overflow returns `invalid_transition`, with fixed diagnostics that do not echo IDs. Run `node --test test/dm-event-guard-array-bounds.test.mjs` for the new synthetic regression. This does not constitute real Worker/D1 or production security testing.
