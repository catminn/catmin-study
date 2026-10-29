# Dungeon public-field approval manifest v1 (spoiler-free)

Status: authoring/security contract only. This does not authorize import, deployment, migration, or disclosure. All example names and values in the companion tests are synthetic.

## Decision for Claude #46

Do **not** trust `dungeon.review={fieldPath:true}` or `reviewedRevision` embedded in the imported content: the same importer could forge them or change the text after review. Use a **separate, private, trusted author-approved sidecar**. It is not placed in the public GitHub branch, player bundle, shared mailbox, model prompt, or public API.

Shape: `{schema:"dungeon-public-field-review-v1",recordId,contentDigest,approvedBy,approvedAt,fields:[{path,digest,gate}]}`. `contentDigest` is SHA-256 over the canonical UTF-8 JSON of the exact content record to persist, including its kind, id, and content; each field `digest` uses the same canonicalization on the projected value. The authoritative canonicalization, exact bracket-path syntax, wire gate identifiers and author provenance requirements are specified in `dungeon-public-field-review-wire-v1.md` and tested with real Node SHA-256 in `test/dungeon-public-field-review-wire.test.mjs`. Generate candidate hashes in a private preflight, but only the author can approve them after inspecting actual copy and its earliest exposure. The sidecar must arrive through a separately authenticated/authorized private author channel, with its provenance bound to the import operation. A self-supplied or unauthenticated sidecar is not approval.

## Required gates, based on current GET projection

- `listing`: wrapper subject/after (if returned), dungeon id/name/desc/mission/rule/pen/tint/st, every chapter title `ch[i].t` (including **future** titles), and fork chapter/price. Since these are currently exposed before chapter unlock, their text must be safe on the initial list.
- `chapter:i`: chapter `k`, practice question and id, skill id/name/effect, fork t/q at its chapter, and revealed cast name/role/reveal index. No unapproved value is shown even if the chapter is unlocked.
- `chapter_verified:i`: `ch[i].pub.recap`.
- `all_done`: `dungeon.pub.clear`.
- `all_done+zero_grant`: `dungeon.pub.zero`.
- `hidden_grant`: `dungeon.pub.hidden`.
- `listing` for `dungeon.pub.open`; `chapter:i` for `ch[i].pub.intro`.

For every field the server actually projects, an exact approved path, value digest, and **the earliest actual gate** are required. No approval, unknown/duplicate path, stale digest, wrong record, changed text, mismatched gate, or changed record digest => fail closed at import. If a record already exists without a trusted approval, GET must omit that unapproved field (or omit the whole dungeon) rather than expose it. A future title cannot claim `chapter:i` while current GET sends it at `listing`. Either approve a neutral title safe at listing or change the server projection to defer it and update the gate contract/tests first.

Director-only `pre/recap/zero/clear/hidden`, `ch[].s/sb/tn`, `cast[][2]`, `fork.b`, answer `practice[].a`, and preloaded hints remain forbidden in client projection regardless of any approval. The review manifest never turns a director field public. Approvals are revision/content-specific; do not silently carry them to edited records. A sidecar is an assertion of human review, not proof that prose contains no spoilers; the author must inspect each value at its earliest reveal moment.

## Safe workflow and acceptance

1. Private preflight enumerates public fields, their hashes, and exposure gates without printing prose in logs or shared channels. Human reviewer reads the private source and approves exact values; the trusted sidecar is stored in a private, access-controlled location.
2. Import verifies sidecar provenance, record digest, every projected field, and no unexpected field, **before** any production write. Do not use this contract to authorize the current private v2 candidate: it remains DO-NOT-IMPORT until Catherine is present and explicitly approves.
3. Runtime projection enforces gates independently; approval alone never unlocks a chapter, NPC, reward, or hidden discovery. Error responses/logs expose only error codes and counts, not values, field digests, identities, or trigger refs.
4. Claude owns implementation and real Worker/D1 tests: forged inline review, untrusted sidecar, stale approval after one-character edit, missing field, future-title early exposure, wrong dungeon, cross-revision reuse, unknown fields, and authorized public copy. The companion Node test is a **synthetic reference**, not proof of server integration.

No real plot, character, secret, trigger, answer, or private content hash appears in this public document.
