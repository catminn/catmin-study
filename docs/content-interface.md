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
