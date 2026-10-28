// Validate a private story bundle without printing any story text or secret identifiers.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateBundle(bundle) {
  const errors = [];
  const allowed = new Set(['world', 'npc', 'event', 'knowledge-link', 'scene']);
  if (!bundle || !Array.isArray(bundle.records)) return { ok: false, errors: ['missing records'] };
  const seen = new Set();
  const byKind = Object.fromEntries([...allowed].map(k => [k, new Set()]));
  for (const r of bundle.records) {
    if (!r || !allowed.has(r.kind) || typeof r.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/.test(r.id) || !r.content || typeof r.content !== 'object') {
      errors.push('invalid record'); continue;
    }
    const key = r.kind + ':' + r.id;
    if (seen.has(key)) errors.push('duplicate record');
    seen.add(key); byKind[r.kind].add(r.id);
    if (Buffer.byteLength(JSON.stringify(r), 'utf8') > 65536) errors.push('record exceeds 64KiB');
    if (r.content.id !== r.id || r.content.kind !== r.kind) errors.push('record metadata mismatch');
  }
  for (const r of bundle.records) {
    if (!r || !r.content) continue;
    if (r.kind === 'scene') {
      if (!Array.isArray(r.content.choices)) errors.push('scene choices missing');
      else for (const id of r.content.choices) if (!byKind.scene.has(id)) errors.push('unknown scene destination');
      for (const concept of r.content.knowledgeLinks ?? []) {
        if (!bundle.records.some(x => x.kind === 'knowledge-link' && x.content?.conceptId === concept)) errors.push('unknown scene concept');
      }
    }
    if (r.kind === 'npc' && !byKind.scene.has(r.content.initial?.locationId)) errors.push('unknown npc location');
    if (r.kind === 'event') {
      const t = r.content.trigger ?? {};
      if (t.sceneId && !byKind.scene.has(t.sceneId)) errors.push('unknown event scene');
      if (t.npcId && !byKind.npc.has(t.npcId)) errors.push('unknown event npc');
    }
    if (r.kind === 'knowledge-link') {
      for (const id of r.content.sceneIds ?? []) if (!byKind.scene.has(id)) errors.push('unknown knowledge scene');
    }
  }
  if (byKind.world.size !== 1) errors.push('expected exactly one world');
  const count = Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.size]));
  return { ok: errors.length === 0, errors, count };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) { process.stderr.write('Usage: node validate-story-bundle.mjs <private-bundle.json>\\n'); process.exit(2); }
  try {
    const result = validateBundle(JSON.parse(readFileSync(path, 'utf8')));
    process.stdout.write(JSON.stringify(result) + '\\n');
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stderr.write('Could not read or parse bundle (content not displayed).\\n');
    process.exitCode = 1;
  }
}
