# Dungeon public-field review wire format v1 (spoiler-free interoperability addendum)

This addendum is authoritative for serialization, exact path spelling and gate identifiers in `dungeon-public-field-review-v1.md`. It is a synthetic authoring/security contract, **not** an authorization to import any private dungeon. No private plot, character, answer, trigger, or digest belongs in this repository or in shared memory.

## Exact schema and trust boundary

A separately submitted, privately stored review sidecar has the shape:

```json
{"schema":"dungeon-public-field-review-v1","recordId":"synthetic-example","contentDigest":"<64 lowercase hex chars>","approvedBy":"<authenticated author identifier>","approvedAt":"2026-10-29T00:00:00Z","fields":[{"path":"dungeon.name","digest":"<64 lowercase hex chars>","gate":"listing"}]}
```

`approvedBy` (nonempty author identifier) and `approvedAt` (valid RFC 3339 UTC timestamp ending `Z`) are required **provenance assertions**, never evidence of authorization by themselves. The sidecar must be separately submitted through an authenticated administrator/author-only channel and explicitly confirmed by Catherine after reviewing the private values at their earliest visibility stage. A server-created candidate sidecar, imported `review` flags, a password-only automatic stamp, or an ordinary model-generated message **cannot** grant approval. No user-facing GET, logging, or error may disclose the sidecar, identities, paths, hashes, or content. A failed check rejects the whole import before any write; existing unreviewed records must be omitted or field-filtered at GET.

## Digest interoperability

Use lowercase hexadecimal SHA-256 of UTF-8 **canonical JSON** for the exact persisted top-level content record (`kind`, `id`, `content`, etc.), excluding the sidecar. Each field digest uses the same canonical JSON function on the exact value the GET projector would send (including server-generated fallback practice IDs). This supersedes the ambiguous phrase "exact UTF-8 serialized" in the earlier contract; raw input whitespace and JSON object insertion order do not change the digest, while any actual value or hidden director field change does. The importer must compare its parsed and persisted records against the same canonical representation. Reject duplicate object keys at the JSON ingestion boundary rather than silently keeping one.

Canonical JSON for this v1 schema: recursively emit JSON primitives using ECMAScript `JSON.stringify` scalar encoding; emit arrays in original index order; emit object properties sorted by ascending UTF-16 code-unit order, with no whitespace. Keys and strings are JSON-escaped; reject `undefined`, holes, nonfinite numbers, functions, symbols, cycles and non-JSON objects. The supported source is strict JSON; do not normalize Unicode strings, translate line endings or coerce types. This is a deliberately narrow contract, **not** a claim of full RFC 8785/JCS conformance. The companion Node test uses actual `node:crypto` SHA-256, not a test hash substitute.

## Exact path grammar and gates

Use **zero-based** indexes and full paths, e.g. `dungeon.ch[2].practice[0].q`, `dungeon.cast[0][1]`, `dungeon.pub.zero`, `record.subject`. No aliases, dot-number shorthand (`ch.2.t`), leading-zero indexes (`ch[02]`), wildcards, prefix approvals, or path escaping. A path must be both syntactically allowed and exactly present in the projector's enumerated public-field set; syntax alone never makes a field public. `cast[][2]`, director text, answers and preloaded hints are never approvable. The full enumerated path set is in `projectedFields()` of the original synthetic contract test, and must be kept synchronized with the actual Worker GET projection.

The only gate strings are `listing`, `chapter:i`, `chapter_verified:i`, `all_done`, `all_done+zero_grant`, and `hidden_grant` (where `i` is a zero-based decimal chapter index with no leading zeros). **Do not** use `chapterDone:i`, `allDone`, `zeroUnlocked`, or `hiddenUnlocked` as wire gate values; those are informal names for state conditions. Chapter titles currently exposed before unlock require `listing`, even for future chapters. Cast reveal gates derive from the tuple's fourth element; fork prompt gates derive from its chapter. For every field, the sidecar gate must equal the *earliest actual* GET exposure gate, not merely a later gate chosen by the author. A content approval never overrides a separate server progress/grant gate.

## Validation and integration

Reject the sidecar if any required metadata is absent, malformed, unauthenticated or not explicitly author-confirmed; if record id, whole-record digest, per-field digest, path set, or gate differs; if there are duplicate/unknown approvals; or if the actual public projector has added an unenumerated field. Validate every public field including optional `pub` values, future titles, visible cast tuples and fallback IDs. Any new projector field or gate change requires a versioned contract/test update before use. Tests in `test/dungeon-public-field-review-wire.test.mjs` verify wire normalization and negative cases with synthetic values; they do not exercise the production Worker, D1, authorization or editorial spoiler review. Claude owns those integrations and end-to-end tests. The first private candidate remains **DO-NOT-IMPORT** until real server tests, private field-by-field author review and Catherine's explicit in-person authorization.
