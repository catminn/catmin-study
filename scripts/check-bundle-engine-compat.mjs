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
  // ---- 场景与结局契约（world-content-semantics-v1）：只输出分类计数 ----
  const warns = {};
  const warn = (k) => { warns[k] = (warns[k] ?? 0) + 1; };
  const npcIds = new Set(by('npc').map(r => r.id));
  const revealed = new Set();
  const granted = new Set();
  for (const e of by('event')) {
    for (const f of e.content.revealsFacts ?? []) revealed.add(f);
    for (const ef of e.content.effects ?? []) {
      if (ef.type === 'record_fact_discovery') revealed.add(ef.target);
      if (ef.type === 'grant_item') granted.add(ef.target);
    }
  }
  const seenEnding = new Set();
  for (const [sid, sc] of scenes) {
    for (const ch of sc.choices ?? []) if (!scenes.has(ch)) bad('scene.choices 引用了不存在的场景');
    const se = sc.stateEffects;
    if (se !== undefined) {
      if (!Array.isArray(se)) bad('scene.stateEffects 结构非法（不是数组）');
      else for (const ef of se) {
        if (!ef || typeof ef !== 'object' || !EFFECTS.has(ef.type) || typeof ef.target !== 'string') bad('scene.stateEffects 结构非法（会被整体忽略）');
        else if (ef.type === 'advance_scene') bad('scene.stateEffects 含 advance_scene（不允许）');
        else if (ef.type === 'set_npc_location' && !scenes.has(ef.value)) bad('stateEffects/effects 引用了不存在的场景');
        else if (ef.type === 'change_npc_relation' && !npcIds.has(ef.target)) bad('effect 引用了不存在的 NPC');
        else if ((ef.type === 'lock_flag' || ef.type === 'set_flag') && ef.target === 'ending_locked') bad('场景入场效果提前写入 ending_locked');
      }
    }
    if (sc.entryRequirements !== undefined && !leavesOk(sc.entryRequirements)) bad('scene.entryRequirements 含引擎不认识的条件写法');
    if (sc.ending !== undefined) {
      const en = sc.ending;
      if (!en || typeof en !== 'object' || typeof en.id !== 'string' || !en.id) bad('结局缺少 id');
      else {
        if (seenEnding.has(en.id)) bad('结局 id 重复'); seenEnding.add(en.id);
        if (typeof en.costNotice !== 'string' || !en.costNotice.trim()) bad('结局缺少 costNotice');
        const er = sc.entryRequirements;
        if (er === undefined || er === null || (Array.isArray(er) && er.length === 0) || !leavesOk(er)) bad('结局缺少可验证的 entryRequirements');
        const hasLock = by('event').some(e => e.content.trigger?.type === 'scene_entered' && e.content.trigger.sceneId === sid
          && (e.content.effects ?? []).some(x => x.type === 'lock_flag' && x.target === 'ending_locked' && x.value === en.id));
        if (!hasLock) bad('结局缺少匹配的终局锁事件（scene_entered + lock_flag ending_locked）');
      }
    }
  }
  for (const e of by('event')) {
    const c = e.content, t = c.trigger ?? {};
    if (t.sceneId && !scenes.has(t.sceneId)) bad('事件触发场景不存在');
    for (const ef of c.effects ?? []) {
      if (ef.type === 'advance_scene' && scenes.get(ef.target)?.ending !== undefined) bad('事件的 advance_scene 指向结局场景（运行时会被拒绝，须经显式确认的 travel）');
      if (ef.type === 'set_npc_location' && !scenes.has(ef.value)) bad('stateEffects/effects 引用了不存在的场景');
      if (ef.type === 'change_npc_relation' && !npcIds.has(ef.target)) bad('effect 引用了不存在的 NPC');
      if (ef.type === 'remove_item' && !granted.has(ef.target)) warn('remove_item 找不到 grant 来源（可能是初始授予）');
    }
    if (t.type === 'fact_discovered' && t.factId && !revealed.has(t.factId)) bad('fact_discovered 引用了从未被揭示的事实');
  }
  process.stdout.write(JSON.stringify({ ok: Object.keys(errs).length === 0, errors: errs, eventsWithoutPublicOutcome: noPublic, warnings: warns, eventsWithTriggerTypeIgnoredByV0: unsupportedTrigger, scenes: scenes.size, events: by('event').length }) + '\n');
} catch { process.stderr.write('读取或解析失败（未显示内容）\n'); process.exitCode = 1; }
