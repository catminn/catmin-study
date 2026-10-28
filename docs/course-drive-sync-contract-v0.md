# Course Drive Sync → Knowledge Pack → Optional Story Opportunities (v0 proposal)

Status: architecture contract only; not deployed. Ownership: DM/learning design by ChatGPT; Google API, session, storage and story runtime integration by Claude.

## Current baseline
- `src/google.ts` already has Google OAuth, encrypted refresh token and read-only Google Drive search/list/read through `googleTool`.
- Existing `src/learning-adapter.ts` accepts versioned CoursePack / player-visible cues and makes OPTIONAL suggestions; it has no Drive fetching, background sync, retrieval index or generative story publication.
- ChatGPT connected Google Drive (if present) and independent `study.catmin.io` OAuth are separate authorizations. Never reuse tokens or imply they share connections.

## User experience
1. User opts in on website and chooses **one or more course folders** with class labels (e.g. MATH 1920 Fall, MATH 2940 Spring), course validity dates and a sync preference. Do not silently ingest unrelated Drive.
2. On new or changed syllabus, lecture notes, problem set, slides or handout, refresh only changed files. Show last successful sync and file errors. A manual Sync now action exists.
3. Ingestion performs extraction with source pointers, formulas/figures retained where possible, separate source passages from instructions. Mark unsupported formats and scanned/math-image low-confidence sections for review.
4. Build a per-course versioned index: fileId, revision/modifiedTime, chunk pointer, text hash, title, subject, concepts, prereqs, examples, units, source quality. Deletions/tombstones invalidate old chunks; revoke of access removes active retrieval.
5. `CoursePack` is created as PROPOSAL, not trusted fact. Knowledge definitions are grounded in source excerpts with citations and validated for correctness, concept ID stability, duplicates and prerequisites. Source materials may contain mistakes; do not treat them as authoritative arithmetic.
6. At each DM turn, active course version + current scene's *server-authorized public cues* + player's lesson/opt-out preferences yield affordances. Never reveal private plot, make up measurements or lock main-plot progression behind studying.
7. On demand the DM can introduce an optional physical observation, contextual question or side quest. Any generated story is first a **draft**. Before committing to canonical world, validate references, chronology, lore, NPC knowledge, mathematical requirements, state transitions and spoiler policy. Generating a suggestion is not committing an event.
8. Player may choose non-math solutions. If they choose to solve, formal mathematical verifier (separate from narrator) must check before server changes the learning evidence/knowledge bonuses. Document alone cannot certify mastery.

## Sync engineering
- Use `changes.getStartPageToken` / `changes.list` (Drive API) for incremental updates; optional `changes.watch` notification just tells server changes exist, then query changes feed. Renew expiring channels. Alternative: Cloudflare scheduled trigger at modest cadence e.g. 15–60 min. Not guaranteed instant.
- Persist folder allowlist + `pageToken`, file revisions and hashes, course settings, job status, resumable cursor, tombstones and ingestion errors. Idempotency: same file revision + processor version yields same index.
- Google OAuth: existing `drive.readonly` covers broad Drive access and requires careful restricted-scope/privacy handling; consider Picker and `drive.file` for selected-file least privilege where feasible. Folder-wide monitoring scope behavior must be validated with Google permissions model; do not overpromise `drive.file` magically covers an entire pre-existing folder.
- Read-only source access; no writes to syllabus or folders. Tokens stored server side encrypted, never sent to the model or browser.
- Cloudflare Worker should cap download bytes, file counts, indexing costs and tokens. Process large documents asynchronously in bounded batches, not a single request.
- Prompt injection: imported course text is data, never privileged instructions; no retrieval of unrelated accounts/private world lore into player-facing replies.
- The original file is not public knowledge. Keep extracted material and summaries private to the user's session/account; citations to course file/chunk remain private metadata.
- Changes to semester or syllabus must not rewrite already committed world events or awarded evidence. New course revisions affect future opportunities, and any published side quests need explicit provenance/version.

## Test cases for implementation
1. After initial consent, add a new lecture note to selected folder; only new revision indexed, prior documents untouched.
2. Modify a PDF; index version updates, and stale chunks disappear. Delete/unshare file; old chunks stop appearing.
3. Add an unrelated file outside allowlist; no ingest.
4. File contains "ignore system rules" text; it is treated as quoted untrusted content.
5. A file explains linear systems while user enrolled in MATH 2940. A story with authorized multiple measurements allows an optional linear-system opportunity; no rewrite of canonical story.
6. User is currently exploring with learning suppressed; no unsolicited quiz, even if all supporting documents exist.
7. A formula is present only in an inaccessible image; do not fabricate verified mathematical data.
8. Google API/refresh token failure, rate limit or lost access; preserve last good state + show stale status, don't invent a recent update.
9. Drive notifications arrive duplicated or out of order; reprocessing is idempotent.
10. Generate side-quest draft with references; canonical publish requires explicit validation and approval policy.
