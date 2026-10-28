// 检查私有内容包能不能被服务器世界引擎 v0 接受。只输出计数和错误类别，不输出任何剧情文字或内容 id。
// 用法：node scripts/check-bundle-engine-compat.mjs <private-bundle.json>
import { readFileSync } from 'node:fs';
const TRIGGERS = new Set(['scene_entered', 'action_resolved', 'fact_discovered', 'dialogue_choice_committed', 'world_flag_changed']); // world-1.1.0
const EFFECTS = new Set(['set_flag', 'lock_flag', 'advance_scene', 'set_npc_location', 'change_npc_relation', 'record_fact_discovery', 'grant_item', 'remove_item', 'record_npc_memory']);
const LEAVES = ['flag', 'scene', 'npcRelation', 'npcLocation', 'factKnown', 'hasItem', 'npcMemory'];
function leavesOk(c) {
  if (c === undefined || c === null) return true;
  if (Array.isArray(c)) return c.every(leavesOk);
  if (typeof c !== 'object') return false;
  if ('all' in c) return leavesOk(c.all);
  if ('any' in c) return Array.isArray(c.any) && c.any.every(leavesOk);
  if ('not' in c) return leavesOk(c.not);
  return LEAVES.some(k => k in c);
}
try {
  const b = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const by = (k) => b.records.filter(r => r.kind === k);
  const scenes = new Map(by('scene').map(r => [r.id, r.content]));
  const errs = {};
  const bad = (k) => { errs[k] = (errs[k] ?? 0) + 1; };
  const worlds = by('world');
  if (worlds.length !== 1) bad('world 记录不是恰好 1 条');
  else if (typeof worlds[0].content.startSceneId !== 'string' || !scenes.has(worlds[0].content.startSceneId)) bad('world.startSceneId 缺失或不是已有场景');
  let noPublic = 0, unsupportedTrigger = 0;
  for (const e of by('event')) {
    const c = e.content, t = c.trigger ?? {};
    if (!TRIGGERS.has(t.type)) unsupportedTrigger++;
    const po = c.publicOutcome;
    if (!((typeof po === 'string' && po.trim()) || (po && typeof po === 'object' && typeof po.text === 'string' && po.text.trim()))) noPublic++; // 字符串，或 {text,...授权元数据}
    if (!leavesOk(c.preconditions)) bad('事件有引擎不认识的前置条件写法');
    for (const ef of c.effects ?? []) {
      if (!EFFECTS.has(ef.type)) bad('事件使用 v0 未支持的 effect 类型（该事件会被整条拒绝）');
      else if (ef.type === 'advance_scene') {
        const from = t.sceneId && scenes.get(t.sceneId);
        if (!from || !Array.isArray(from.choices) || !from.choices.includes(ef.target)) bad('advance_scene 的目标不在触发场景的 choices 里（该事件会被拒绝）');
      }
      if ((ef.type === 'set_flag' || ef.type === 'change_npc_relation' || ef.type === 'set_npc_location') && typeof ef.target !== 'string') bad('effect.target 不是字符串');
      if (ef.type === 'change_npc_relation' && typeof ef.value !== 'string') bad('change_npc_relation.value 必须是字符串档位');
    }
  }
  process.stdout.write(JSON.stringify({ ok: Object.keys(errs).length === 0, errors: errs, eventsWithoutPublicOutcome: noPublic, eventsWithTriggerTypeIgnoredByV0: unsupportedTrigger, scenes: scenes.size, events: by('event').length }) + '\n');
} catch { process.stderr.write('读取或解析失败（未显示内容）\n'); process.exitCode = 1; }
