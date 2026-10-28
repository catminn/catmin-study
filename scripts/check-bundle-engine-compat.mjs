// 检查私有内容包能不能被服务器世界引擎 v0 接受。只输出计数和错误类别，不输出任何剧情文字或内容 id。
// 用法：node scripts/check-bundle-engine-compat.mjs <private-bundle.json>
import { readFileSync } from 'node:fs';
const TRIGGERS = new Set(['scene_entered', 'action_resolved', 'dialogue_choice_committed', 'world_flag_changed', 'fact_discovered']); // v1 patch
const EFFECTS = new Set(['set_flag', 'advance_scene', 'set_npc_location', 'change_npc_relation', 'record_fact_discovery']);
const LEAVES = ['flag', 'scene', 'npcRelation', 'npcLocation', 'factKnown'];
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
  const npcs = new Map(by('npc').map(r => [r.id, r.content]));
  const errs = {};
  const bad = (k) => { errs[k] = (errs[k] ?? 0) + 1; };
  const worlds = by('world');
  for (const scene of scenes.values()) if (scene.stateEffects && (!Array.isArray(scene.stateEffects) || !scene.stateEffects.every(x => typeof x === 'string' && /^[a-z0-9._-]{1,80}$/.test(x)))) bad('scene.stateEffects 必须是合法标记列表');
  if (worlds.length !== 1) bad('world 记录不是恰好 1 条');
  else if (typeof worlds[0].content.startSceneId !== 'string' || !scenes.has(worlds[0].content.startSceneId)) bad('world.startSceneId 缺失或不是已有场景');
  let noPublic = 0, unsupportedTrigger = 0;
  for (const e of by('event')) {
    const c = e.content, t = c.trigger ?? {};
    if (!TRIGGERS.has(t.type)) unsupportedTrigger++;
    if (t.type === 'dialogue_choice_committed') {
      if (typeof t.npcId !== 'string' || !npcs.has(t.npcId) || !npcs.get(t.npcId)?.dialogueCards?.some(c => c.id === t.choiceId)) bad('对话触发器无对应 NPC 对话卡');
    }
    if (t.type === 'world_flag_changed' && typeof t.flagKey !== 'string') bad('标记变化触发器缺少 flagKey');
    if (t.type === 'fact_discovered' && typeof t.factId !== 'string') bad('事实发现触发器缺少 factId');
    if (t.type === 'scene_entered' && (!t.sceneId || !scenes.has(t.sceneId))) bad('场景进入触发器缺少有效 sceneId');
    if (!Array.isArray(c.revealsFacts ?? []) || !(c.revealsFacts ?? []).every(x => typeof x === 'string')) bad('revealsFacts 不是字符串列表');
    if (typeof c.publicOutcome !== 'string' || !c.publicOutcome.trim()) noPublic++;
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
  process.stdout.write(JSON.stringify({ ok: Object.keys(errs).length === 0 && unsupportedTrigger === 0, errors: errs, eventsWithoutPublicOutcome: noPublic, eventsWithUnsupportedTriggers: unsupportedTrigger, scenes: scenes.size, events: by('event').length }) + '\n');
} catch { process.stderr.write('读取或解析失败（未显示内容）\n'); process.exitCode = 1; }
