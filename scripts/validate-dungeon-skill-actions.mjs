import { readFileSync } from 'node:fs';

const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const keys = (x, names) => x && !Array.isArray(x) && typeof x === 'object' && Object.keys(x).sort().join('|') === [...names].sort().join('|');
const validId = x => typeof x === 'string' && ID.test(x);
const unique = a => new Set(a).size === a.length;

// Errors deliberately omit source values and paths: this can process private author inputs.
export function validateSkillActionBindings(b, graph) {
  const err = [];
  const add = code => { if (!err.includes(code)) err.push(code); };
  if (!keys(b, ['schema','scope','worldId','dungeonId','manifestRevision','skills','bindings']) || b.schema !== 'dungeon-skill-action-binding-v1' || !validId(b.worldId) || !validId(b.dungeonId) || !Number.isSafeInteger(b.manifestRevision) || b.manifestRevision < 1) add('invalid_header');
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.every(n => validId(n?.id) && Array.isArray(n?.next) && n.next.every(validId))) add('invalid_graph');
  const nodes = new Map((Array.isArray(graph?.nodes) ? graph.nodes : []).filter(n => validId(n?.id)).map(n => [n.id,n]));
  const skills = Array.isArray(b?.skills) ? b.skills : [];
  if (skills.length !== 4 || !skills.every(s => keys(s,['chapter','skillId']) && Number.isInteger(s.chapter) && s.chapter >= 0 && s.chapter < 4 && validId(s.skillId)) || !unique(skills.map(s=>s?.chapter)) || !unique(skills.map(s=>s?.skillId))) add('invalid_skills');
  if (!Array.isArray(b?.bindings) || b.bindings.length !== 4) add('invalid_bindings');
  else {
    const skillSet = new Set(skills.filter(s=>s && typeof s === 'object').map(s=>s.skillId));
    const actionKeys=[], baseKeys=[], boundSkills=[];
    for (const x of b.bindings) {
      if (!keys(x,['actionKey','from','to','skillId','baseActionKey','advantage']) || ![x?.actionKey,x?.from,x?.to,x?.skillId,x?.baseActionKey].every(validId) || !['evidence_option','risk_context'].includes(x?.advantage) || x.actionKey === x.baseActionKey) { add('invalid_binding_shape'); continue; }
      actionKeys.push(x.actionKey); baseKeys.push(x.baseActionKey); boundSkills.push(x.skillId);
      if (!skillSet.has(x.skillId)) add('unknown_skill');
      if (!nodes.get(x.from)?.next?.includes(x.to) || !nodes.has(x.to)) add('not_a_scene_exit');
    }
    if (!unique(actionKeys) || !unique(baseKeys) || actionKeys.some(k=>baseKeys.includes(k))) add('duplicate_action_key');
    if (!unique(boundSkills) || boundSkills.length !== skillSet.size) add('skill_coverage');
  }
  return { ok: err.length === 0, errors: err, skillCount: Array.isArray(b?.skills) ? b.skills.length : 0, bindingCount: Array.isArray(b?.bindings) ? b.bindings.length : 0 };
}

// Pure reference gate: this never commits travel, events, effects, or awards.
export function optionalAdvantageEligible(b, req) {
  const x = b?.bindings?.find(v => v.actionKey === req?.actionKey);
  if (!x || req.worldId !== b.worldId || req.dungeonId !== b.dungeonId || req.manifestRevision !== b.manifestRevision || req.from !== x.from || req.to !== x.to) return false;
  const skill = Array.isArray(b.skills) ? b.skills.find(s=>s?.skillId === x.skillId) : null;
  return !!skill && req.verifiedChapters instanceof Set && req.unlockedSkillIds instanceof Set && req.verifiedChapters.has(skill.chapter) && req.unlockedSkillIds.has(x.skillId) && req.useAdvantage === true;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw Error('invalid_arguments');
    const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const g = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const r = validateSkillActionBindings(b,g);
    process.stdout.write(JSON.stringify(r) + '\n');
    if (!r.ok) process.exitCode = 1;
  } catch { process.stdout.write('{"ok":false,"errors":["invalid_input"]}\n'); process.exitCode = 1; }
}
