/** Spoiler-free, synthetic authoring reference. NOT a production state engine. */
import { readFileSync } from 'node:fs';

const isId = x => typeof x === 'string' && /^demo\.[a-z0-9][a-z0-9.-]*$/.test(x);
const exactKeys = (x, allowed) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(k => allowed.includes(k));
const distinct = xs => new Set(xs).size === xs.length;
const fail = code => ({ ok: false, code });
const success = state => ({ ok: true, code: 'OK', state });

export function validateManifest(m) {
  const errors = new Set();
  if (!exactKeys(m, ['worldId', 'revision', 'chapters', 'dungeons']) || !isId(m?.worldId) || !isId(m?.revision)) errors.add('MANIFEST_SHAPE');
  if (!Array.isArray(m?.chapters) || m.chapters.length < 2 || !Array.isArray(m?.dungeons) || !m.dungeons.length) errors.add('MANIFEST_COLLECTIONS');
  if (errors.size) return { ok: false, codes: [...errors].sort(), errorCount: errors.size };
  const ds = m.dungeons.map(d => d?.id), cs = m.chapters.map(c => c?.id);
  if (!distinct(ds) || !distinct(cs) || ds.some(x => !isId(x)) || cs.some(x => !isId(x))) errors.add('DUPLICATE_OR_BAD_ID');
  for (const d of m.dungeons) {
    if (!exactKeys(d, ['id', 'practiceId', 'conceptId']) || !isId(d.practiceId) || !isId(d.conceptId)) errors.add('DUNGEON_SHAPE');
  }
  if (!distinct(m.dungeons.map(d => d.practiceId))) errors.add('PRACTICE_REUSE');
  for (let i = 0; i < m.chapters.length; i++) {
    const c = m.chapters[i];
    if (!exactKeys(c, ['id', 'predecessor', 'dungeonId', 'storyEntry', 'publicCopySlot']) ||
        !isId(c?.storyEntry) || !isId(c?.publicCopySlot) || !ds.includes(c?.dungeonId)) errors.add('CHAPTER_SHAPE');
    if (c?.predecessor !== (i === 0 ? null : m.chapters[i - 1].id)) errors.add('STORY_CHAIN');
  }
  if (!distinct(m.chapters.map(c => c.storyEntry)) || !distinct(m.chapters.map(c => c.publicCopySlot))) errors.add('CHAPTER_REF_REUSE');
  return { ok: errors.size === 0, codes: [...errors].sort(), errorCount: errors.size };
}

export function initialState(m) {
  if (!validateManifest(m).ok) return null;
  return {
    worldId: m.worldId, revision: m.revision, frontier: m.chapters[0].id,
    committedChapters: [], committedEvents: [], storyCursor: null,
    studySelection: null, verifiedPractices: [], studyVisits: []
  };
}

const stateKeys = ['worldId', 'revision', 'frontier', 'committedChapters', 'committedEvents', 'storyCursor', 'studySelection', 'verifiedPractices', 'studyVisits'];
export function validateState(m, s) {
  if (!validateManifest(m).ok) return false;
  if (!exactKeys(s, stateKeys) || s.worldId !== m.worldId || s.revision !== m.revision) return false;
  if (![null, ...m.chapters.map(c => c.id)].includes(s.frontier)) return false;
  if (![null, ...m.chapters.map(c => c.storyEntry)].includes(s.storyCursor)) return false;
  if (![null, ...m.dungeons.map(d => d.id)].includes(s.studySelection)) return false;
  for (const k of ['committedChapters', 'committedEvents', 'verifiedPractices', 'studyVisits']) if (!Array.isArray(s[k]) || !distinct(s[k]) || s[k].some(x => !isId(x))) return false;
  const expected = m.chapters.slice(0, s.committedChapters.length).map(c => c.id);
  if (JSON.stringify(expected) !== JSON.stringify(s.committedChapters)) return false;
  if (s.frontier !== (m.chapters[s.committedChapters.length]?.id ?? null)) return false;
  const current = m.chapters[s.committedChapters.length];
  if (s.storyCursor !== null && s.storyCursor !== (current?.storyEntry ?? null)) return false;
  if (s.committedEvents.length !== s.committedChapters.length) return false;
  if (s.verifiedPractices.some(x => !m.dungeons.some(d => d.practiceId === x))) return false;
  if (s.studyVisits.some(x => !m.dungeons.some(d => d.id === x))) return false;
  if (s.studySelection !== null && !s.studyVisits.includes(s.studySelection)) return false;
  return true;
}

/**
 * Synthetic server-owned event assumptions: source === 'trusted-demo' is NOT authentication.
 * Never connect this module to a real player endpoint.
 */
export function applySyntheticAction(m, s, a) {
  if (!validateManifest(m).ok) return fail('MANIFEST_INVALID');
  if (!validateState(m, s)) return fail('STATE_INVALID');
  if (!exactKeys(a, ['mode', 'type', 'dungeonId', 'practiceId', 'chapterId', 'eventId', 'source'])) return fail('ACTION_SHAPE');
  if (a.mode !== 'study' && a.mode !== 'story') return fail('MODE_INVALID');
  const next = structuredClone(s);
  if (a.mode === 'study') {
    if (!['select', 'practice_verified', 'exit'].includes(a.type)) return fail('MODE_ACTION_INVALID');
    if (a.type === 'select') {
      if (!m.dungeons.some(d => d.id === a.dungeonId)) return fail('STUDY_UNKNOWN');
      next.studySelection = a.dungeonId;
      if (!next.studyVisits.includes(a.dungeonId)) next.studyVisits.push(a.dungeonId);
    } else if (a.type === 'practice_verified') {
      const d = m.dungeons.find(d => d.id === s.studySelection);
      if (!d || d.practiceId !== a.practiceId || a.source !== 'trusted-demo') return fail('EVIDENCE_NOT_VERIFIED');
      if (!next.verifiedPractices.includes(a.practiceId)) next.verifiedPractices.push(a.practiceId);
    } else next.studySelection = null;
  } else {
    if (!['ask', 'preview', 'enter', 'commit'].includes(a.type)) return fail('MODE_ACTION_INVALID');
    if (a.type === 'ask' || a.type === 'preview') return success(next);
    const c = m.chapters.find(c => c.id === a.chapterId);
    if (!c || c.id !== s.frontier) return fail('STORY_LOCKED');
    if (a.type === 'enter') next.storyCursor = c.storyEntry;
    else {
      if (s.storyCursor !== c.storyEntry || a.source !== 'trusted-demo' || !isId(a.eventId)) return fail('COMMIT_NOT_VERIFIED');
      if (s.committedEvents.includes(a.eventId)) return fail('EVENT_REPLAY_SCOPE');
      next.committedChapters.push(c.id);
      next.committedEvents.push(a.eventId);
      next.frontier = m.chapters[next.committedChapters.length]?.id ?? null;
      next.storyCursor = null;
    }
  }
  return validateState(m, next) ? success(next) : fail('STATE_INVALID');
}

if (process.argv[1]?.endsWith('validate-study-story-isolation.mjs')) {
  let result;
  try { result = validateManifest(JSON.parse(readFileSync(process.argv[2], 'utf8'))); }
  catch { result = { ok: false, codes: ['INPUT_INVALID'], errorCount: 1 }; }
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.ok) process.exitCode = 1;
}
