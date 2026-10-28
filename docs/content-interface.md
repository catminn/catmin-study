# 内容接口约定 v0.1（Claude → ChatGPT）

目的：ChatGPT 独立写正式世界/剧情/NPC，Claude 独立做回合引擎，二者只通过本约定对接。

## 1. 剧透保护
- 正式剧情、隐藏设定、NPC 秘密**不进 GitHub、不进共享记忆**。
- 唯一入口：`PUT /api/adventure/content`（存进网站私有 D1）。**管理员通道**：除登录会话外，请求头必须再带 `X-Owner-Password`（主口令），否则 403；失败 5 次锁 15 分钟。`GET` 只返回元数据，正文永不经 HTTP 返回；引擎用服务端内部函数读取，且不得把原文放进玩家可见响应。导出接口不含内容库。
- 请求：`{kind, id, content}`；kind ∈ world / npc / event / knowledge-link / scene；id 为小写字母数字 `._-`；单条 ≤ 64KB；同 id 重复写入自动增加版本（rev），内容未变不增版本。
- 引擎目前**不读取**内容（沙盒用占位）；正式内容的字段结构由 ChatGPT 定义，Claude 再接入。

## 2. 谁说了算
- **世界事实只由服务器提交**（骰点成败、事件触发、NPC 状态变化、物品增减）。主持人模型只叙述已提交的事实，不能自己编后果。
- 因此内容层请把“后果”写成**可提交的结构化事实**，而不是只写散文：例如事件 `{id, trigger, effects:[{type, target, value}], revealsFacts:[...]}`。散文描述另放 `narrationHints`。

## 3. 知识如何影响行动（已实现的机制）
- 行动有模板（actionTemplate），每个模板声明 `requiredConcepts`（概念 id，如 `math1920.gradient`）。
- 只有**同会话、已确认、正确、推理有效、未用过、首次洞见、概念匹配**的证据才给 +3 加成；不匹配 → 行动照常判定，加成 0；普通行动永不吃数学加成。
- 请 ChatGPT 提供：概念列表、每个行动模板的 `requiredConcepts` 与“知识如何用在这个行动里”的叙事意图（application）。这些是配置，不用改引擎代码。

## 4. 需要 ChatGPT 决定的开放项
1. 事件触发条件的最小集合（比如：进入场景 / 行动成功 / 行动失败 / 发现）。
2. NPC 状态字段（关系值？已知事实？位置？）。
3. 世界变化由谁确认：我建议服务器规则确认，模型只叙述。

## 5. 世界引擎 world-1.1.0（Claude，无剧透）
- 触发器：`scene_entered` `action_resolved`（可带 `fallback:true`：仅当同一次行动没有任何事件给出公开结果时才触发）`fact_discovered{factId}` `dialogue_choice_committed{choiceId,npcId?,sceneId?}` `world_flag_changed{flagKey,nextValue?}`。循环由 maxChain=4 与“同一次提交里同一事件只应用一次”共同限制。
- effects：`set_flag` `lock_flag`（一次写入：未设置→设置；同值→无操作；不同值→整条事件拒绝，用于结局锁）`advance_scene` `set_npc_location` `change_npc_relation`（value=档位字符串，同时追加 relationshipHistory）`record_fact_discovery` `grant_item` `remove_item`（没有该物品则整条事件拒绝）`record_npc_memory{target:npc, layer:heardClaims|npcBeliefs|confirmedNpcKnowledge, value}`。`revealsFacts` 自动等价于 record_fact_discovery 并触发 `fact_discovered`。
- 条件叶子新增：`{hasItem}` `{npcMemory:{npc,layer,item}}`。NPC 的转述/信念不会变成玩家或世界事实。
- publicOutcome：字符串，或 `{text, ...授权元数据}`（元数据留在服务端，玩家只拿到 text）。
- scene.stateEffects：数组，写法同 effects（不含 advance_scene）；进入该场景时应用一次，非法则整体忽略。
- 玩家提交入口（登录会话）：`POST /api/adventure/travel {sessionId, commitId, target, expectedVersion?}`；`POST /api/adventure/choice {sessionId, commitId, choiceId, npcId?, expectedVersion?}`。列出 choices、讨论、ASK 都不改变世界；同 commitId 同内容重放返回原结果，不同内容 409；版本过期 409；不可用的目标/选择统一 422 `not_available`。

## 6. 结局同意契约与场景准入（world-1.2.0，Claude，无剧透）
- `scene.entryRequirements`：条件（同 preconditions 写法）。所有进入场景的入口（travel、事件的 advance_scene）都先校验；不满足 → travel 返回 422 `not_available`，advance_scene 事件整条拒绝；未满足准入的目的地不出现在玩家可前往列表里。
- `scene.ending = {id, costNotice}`：结局场景。进入只能经 `POST /api/adventure/travel`；事件的 advance_scene 指向结局场景一律拒绝。
  1. 未确认的 travel（缺 `confirmEnding:true`，或此前没有针对同一目标、同一世界版本展示过）→ 422 `ending_confirmation_required`，响应带 `costNotice`（唯一向玩家展示的文字，结局 id 不外泄），并记录“已展示”（有效期 600 秒）。不提交任何东西。
  2. 展示之后，用新的 commitId 再发 `confirmEnding:true`（必须是布尔 true）→ 才提交；确认只对被展示的那个目标有效，世界版本变了需要重新展示。
  3. 已有 `ending_locked` 且与目标结局 id 不同 → 409 `ending_locked`（不展示 costNotice）。同 commitId 重放幂等，同 commitId 不同内容 409。
  4. 自由文本路径：DM 先把 costNotice 原样告诉玩家；只有玩家明确说“确认进入结局”（且刚展示过）才带确认提交。普通“继续”、拒绝、预览、数学证据都不能提交结局。
- 结局场景的 `stateEffects` 不得预设 `ending_locked`；终局锁由 `scene_entered` 该结局场景的事件里的 `lock_flag{target:"ending_locked", value:<ending.id>}` 完成。
- 导入前用 `scripts/check-bundle-engine-compat.mjs` 预检（只输出分类计数）：结局缺 costNotice / id 重复 / 无可验证 entryRequirements / 场景入场预锁 / 无匹配终局锁事件 / stateEffects 非法或含 advance_scene / 引用不存在的 scene·npc·fact / 事件 advance_scene 指向结局，均为 error；remove_item 找不到 grant 来源为 warning。

## 7. 章节开场快照（world-1.2.0 起，服务端私有）
- 终局 travel 成功提交、且 `ending_locked` 等于该结局 `ending.id` 后创建，表 `adventure_world_ending_snapshot`（每会话一份，INSERT OR IGNORE；重放、被拒、未确认、冲突都不建、不重复）。
- 字段（全部是引用/计数来源，无叙述文字）：snapshotSchemaVersion、sourceWorldRef/Version/ContentRevision、endingRef/endingCommitRef、confirmedFacts（玩家已知事实，audience=player）、npcContinuity（关系档位、历史引用、heardClaims/beliefs/confirmedKnowledge 分层）、inventory、openThreads（引擎不推断，目前为空）、learningEvidenceRefs（学习事件未与会话绑定，目前为空，不会重复发奖）、carryoverPolicyVersion。
- 世界内容不能唯一确认来源时失败关闭，不建快照。快照本体不经 HTTP；管理员 GET /api/adventure/ending-snapshot?id= 只返回分类计数。`snapshotProjection` 是给下一章开场叙述的授权视图（事实、关系档位、物品；无结局 id、NPC 私有信念）。

## 8. 未解线索 openThreads / resolvesThreads（world-1.2.0 起，服务端私有）
- 声明：`scene.openThreads` 或 `event.openThreads` = `[{id, authorizedAudience:"player"|"server_private", carryover:"eligible"|"local_only"}]`（三个键缺一不可，不推断默认值）；`event.resolvesThreads` = `[线索 id]`。
- 时机：场景声明只在该场景被**已提交的**转场进入（或起始场景开场）时开启；事件声明只在事件**提交**时开启/关闭。预览、列出 choices、失败行动、讨论、数学答案本身都不开启也不关闭。
- 规则：已关闭的线索不会因重访或重放重开；关闭从未开启的线索、受众/携带策略与已有记录冲突、同一事件既开又关、结构非法 → 事件整条拒绝（场景声明整体忽略），不部分应用。表 `adventure_world_threads`（含 opened_by 提交引用、resolved_by）。
- 快照：终局锁成功后，`openThreads` 只带“已开启、未解决、carryover=eligible”的 `{threadRef,status:"unresolved",audience,openedByCommitRef}`；local_only 不带；缺开启来源 → 不建快照。授权投影 `snapshotProjection.openThreads` 只含 audience=player；server_private 永不进入玩家/DM 视图。管理员计数视图含 openThreadsPlayer/Private/projectedOpenThreads（仅计数）。
- 预检脚本新增 error：openThreads/resolvesThreads 结构非法、缺 authorizedAudience/carryover、线索 id 重复声明、resolvesThreads 引用未声明线索、同一事件既开又关。
