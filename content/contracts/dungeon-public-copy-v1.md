# Dungeon approved public copy v1 (spoiler-free author contract)

Status: proposed additive authoring contract for Claude's implementation. This is NOT a production schema change, approval of existing private content, or permission to import. Examples and tests are synthetic. Supplements dungeon-client-projection-v1.md.

## Fields

An optional, explicitly author-approved dungeon.pub object may contain only these string keys:

- open: player-facing opening copy, visible when the dungeon is available; never substitute raw pre.
- clear: player-facing completion copy, visible only after ALL chapter challenges are persisted as verified; never substitute raw clear or recap.
- zero: player-facing memory/reward copy, visible only after all chapters are verified AND the server has persisted a separate zeroUnlocked grant for this dungeon; never substitute raw zero.
- hidden: player-facing hidden-achievement copy, visible only after a separately persisted hiddenUnlocked event for this dungeon; chapter completion alone never grants it; never substitute raw hidden.

Each optional dungeon.ch[i].pub object may contain only:

- intro: player-facing chapter opening/urgency text, visible when chapter i is reached by server-verified progress; never substitute s, sb, or tn.
- recap: player-facing retrospective text, visible only when chapter i has been server-verified as complete; never substitute director recap.

pub is an opt-in PUBLIC-COPY NAMESPACE, not a sanitizer for arbitrary author text. Absence means omit or show a neutral UI label; never infer from director fields, including after completion. Every public string must be reviewed by the story author against its EARLIEST disclosure gate before a real package is approved. Structural tests cannot detect semantic spoilers. Omit empty keys. Limit each string to 1–1200 Unicode code points; reject control characters, director markers beginning with ⟦DG:, unknown keys and non-string values. Public copy is not a template; never expand director placeholders in it.

## Server projection and gating

GET may add dungeon.pub and dungeon.ch[i].pub only via a server allowlist. Use persisted dungeon_progress to compute current and allDone. ch[i].pub.intro requires i <= current; ch[i].pub.recap requires i <= current and every practice challenge in that chapter verified. pub.clear requires allDone. pub.zero requires allDone AND zeroUnlocked. pub.hidden requires a verified dungeon-scoped hiddenUnlocked event; it is NOT unlocked by allDone alone. If there is no persisted zero/hidden grant, OMIT those fields. A client claim, model utterance or attempted answer is never a grant. Keep grants scoped by dungeon id.

Never reveal ch[i].pub for future chapters, including hidden JSON placeholders or a page bundle. Never return raw pre/recap/zero/clear/hidden, ch[].s/sb/tn, cast secrets, fork alternate text, answers or preloaded hints. Keep server-only director markers and model context out of public copy. Fresh GET can reveal chapter intro after verification; recap does not substitute for chapter advancement.

## Existing public-looking fields need editorial audit

The current projector also returns name, desc, mission, rule, pen, tint, st, chapter title t (including future titles), current topic k, current practice question q, skill display text, revealed cast name/role and an authorized fork prompt. None is automatically safe because its field is public. Before importing a real dungeon, review ALL these fields against earliest exposure or withhold/replace them. The new pub namespace must not justify releasing legacy metadata without review. UI that previously read tn/s/clear/zero/hidden should use the approved pub counterpart or remain blank. Private candidate v2 stays DO-NOT-IMPORT pending this audit, grant persistence, real Worker/D1 negative tests and Catherine's explicit authorization.

## Hand-off / acceptance

Claude owns import validation, persisted grant semantics, GET projection, UI binding and Worker/D1 tests. The companion Node tests use synthetic text and by default exercise a reference projector, NOT the real service. To exercise an implementation, set DUNGEON_PUBLIC_PROJECTOR_MODULE to a module exporting projectDungeon(dungeon, verifiedSet, grants). Add server-level negative tests for spoofed grants, progress transitions, separate dungeons, missing grants and malformed pub. No automatic migration from legacy author strings to pub is permitted.
