# 主神空间：学习型 RPG 架构核查与迁移计划 v1.0

> 设计与审计文档；不包含剧情、NPC 秘密、未来事件；**不代表功能已实施**。
> 核查基线：`page/zhushen.html` (blob `ad83a07517c7fe785044d49b717817780760f158`), `public/platform.js`, `scripts/build-site.py`, `README.md`。2026-10-27。

## 目标与边界

- 冒险中的真实学习是核心；自然语言无缝切换探索、章节教学、提问、练习、行动，无须每轮选模式。
- 采用动态学习导演、自然引导、独立学术评估与游戏世界裁定、混合透明判定，以及“长期掌握小幅修正 + 现场正确应用带来优势/改变行动条件”。
- 不设计具体剧情；客观世界事实、玩家已知与推测分离；导师零无法访问隐藏故事事实。
- 保留签到题、零、10/20/30 分钟专注、周月日历、Google Calendar/Canvas、学科主线、考试 Boss、支线任务、错题图鉴、课程文件、成绩、现实积分与兑换、背包商店、徽章连签、共享记忆同步。换 UI 可以，丢功能和数据不可以。
- `page/zhushen.html` 仍是页面唯一源码，网站通过 `scripts/build-site.py` 注入 `/platform.js` 生成 `public/index.html`。避免双份页面漂移。

## 现状核查：可直接复用

| 组件 | 当前代码位置 | 迁移意见 |
| --- | --- | --- |
| UI 和现有游戏主界面 | `page/zhushen.html` | 保留 UI 与日常使用路径，逐步拆分巨型脚本 |
| 主学习/奖励状态 | `defaultState`, `mergeState`, `save`, `flush` (~1026–1051) | 加版本化迁移，不直接覆盖旧 state |
| 每日签到题 | `openDaily` (~1946) | 复用 UI/流程，输出统一 LearningEvidence |
| 学科主线/任务/考试 | `MAIN`, `BOSSES`, `completeTask`, `completeNode` | 复用课程/任务数据；知识覆盖和掌握分离 |
| 学习导师零 | `zwSend` (~1934) | 独立学术上下文，禁读隐藏剧情 |
| 周月日历 | `fetchEvents`, `connectCalendar` (~1520–1573) | 保留，增加来源和最后同步时间 |
| 资料架 | `saveLibIndex`, `pickLib` (~1824–1858) | 复用文档存储及相关段落检索 |
| 专注 | `startFocus`, `focusDone`, `tickFocus` (~2091–2119) | 改为跨学科、跨导师的真实学习会话 |
| AI 网站适配 | `public/platform.js` | 已实现 `/api/ai`, `/api/db`, `/api/mcp` 客户端；后端可复用但需针对新增接口验收 |
| 站点/Artifact 构建 | `scripts/build-site.py` | 继续单源构建 |
| 共享存档同步 | `cloudGet/cloudPut/cloudBoot` (~2184–2224) | 暂保留作为兼容层，新增状态必须可迁移 |

## 关键风险（按优先级）

**R0 — 数据破坏风险：在更改启动/存档流程前必须处理。**
- ~2238–2241 行存在 `resetTag`、`chatReset`、`sagaTag` 条件分支，可在缺失旧标记时清空部分状态/聊天。禁止以重置标记作为新架构迁移方式。
- `trimState()` (~1047) 裁剪账本（400）、错题（100）、学习进度（每科 15）等，不宜作为事件溯源和完整历史的权威存储。
- `flush()` 对整体 state 执行 `set(body)`；需要验证多客户端写入、断线重试和冲突处理，保护旧积分与兑换历史。
- 先确认网站与 Artifact 双端状态备份、账号隔离和恢复测试；所有新结构先运行在隔离测试环境。

**R1 — AI 文字与真实游戏状态混合。**
- `stripTags()` (~1762–1779) 从文本标记更新 `S.progress`、场景、人物与关卡完成等；`send()` (~1806–1822) 接收生成文本后调用解析及剧情推进；缺少独立的状态事务和显式的行动提交。
- 改为 `intent -> learning verification -> proposed action -> rule validation -> commit -> narrative`。叙事模型无权直接写永久状态。
- 自由提问、构思、学习默认不推进世界；风险动作明确提交，操作有幂等 ID。

**R2 — 学术成果判定与奖励耦合。**
- 现有签到、测验与进度记录路径相互独立，缺统一学习证据；知识点“讲过/回答正确/独立掌握/迁移”尚未统一。
- 新增 LearningEvidence，区分正确性、推理质量、提示程度、验证状态、知识主题及事件唯一 ID；再供学科主线、知识骰和奖励系统消费。
- 不允许同一学习贡献反复发积分；游戏骰子不得判断学术正确性。

**R3 — 学习过程中断/专注判定。**
- `goDungeon()` (~1607) 跨科目触发专注失败，`focusDone()` (~2100) 依赖对话活动次数；与“冒险中思考、纸上演算、零内提问也算真实学习”的目标不符。
- 统一 FocusSession / LearningSession，保留奖励上限和现有计时入口，避免单凭消息数或窗口切换判学习成果。

**R4 — 信息隔离与低成本执行。**
- 现有 `send()` 将背景、对话、资料库与共享记忆组装进一轮模型输入；未来需按角色权限分配上下文；`零` 只能获得玩家已知的场景摘要。
- 不应强行在每条消息内调用 4 个 AI 模型；程序校验关键状态，AI 负责理解与叙事，按需调用学术检查器。
- `public/platform.js` 模型适配与 Google 连接已有实现；不应把任何 API key 放入客户端。

## 建议的最小新增模型

- `LearningSession(id, active_goal, intent, status, resume_cursor, parent_session_id)`
- `LearningEvidence(id, topic_id, answer_accuracy, reasoning_quality, assistance, transfer, verification, source, at)`
- `MasteryState(topic_id, observed_level, evidence_ids, last_verified_at, review_due)`
- `ActionProposal(id, world_id, actor, intent, method, required_conditions, rule_version)`
- `GameEvent(id, action_id, world_id, type, payload, world_time, visibility, rule_version, sequence)`
- `WorldSnapshot(world_id, sequence, state, rule_version)`
- `PlayerKnowledge(fact_id, source, epistemic_status, discovered_at)`
- `RewardEvent(id, source_event_id, delta, kind, at)`
- `FocusSession(id, started_at, ended_at, study_evidence_ids, validity)`

全部事件的 ID 全局唯一、提交幂等；事件日志完整保留，显示层可以按时间窗口分页。

## 实施顺序和完成门槛

### P0：数据保护和基础契约
1. 梳理真实生产存档结构，提供只读备份和恢复验证；无凭据时不可声称备份完成。
2. 为旧 `S`、聊天、资料索引建立迁移映射；旧账户/积分/兑换历史不丢失。
3. 将旧的危险重置条件改为明确的版本迁移策略（先测试后改主线）。
4. 增加统一学习事件结构及幂等奖励接口；旧功能原样可用。

### P1：端到端学习冒险原型
1. `ASK/LEARN/PRACTICE/EXPLORE/ACT/MIXED` 意图识别，思考与执行分离。
2. LearningSession 可嵌套、挂起和恢复；学习导演基于课程、考试、薄弱点与玩家目标，绝不修改世界事实。
3. 独立学术评价记录答案、推理、提示、迁移、待验证状态。
4. 可在纯机制测试世界里边冒险边学习；不触碰正式隐藏故事。

### P2：公平与检定
1. 稳定知识加成 + 现场正确应用的优势/调整条件；同一理由不重复叠加。
2. 随机结果由程序生成，检定参数在抽样前锁定；学术评价不靠掷骰。
3. 结算事务、可见非剧透判定日志、质疑复核、不可重复提交。

### P3：无限流长期扩展
1. 多世界独立状态、按规则条件式并行、选择性跨世界影响。
2. 角色已有知识与世界客观事实权限分离；游戏存档与共享记忆分离。
3. 探索式收藏、功能型基地、现实任务奖励连接，保留所有现有学习工具。

## 纯机制验收测试

- 学章节中途提问/练题再“继续”，恢复正确位置，不推进世界。
- 独立正确推理可以影响行动；同一知识贡献重复表达不叠加优势。
- 正确知识 + 掷骰失败：学习证据保留，世界后果正常。
- 完整重载后恢复学习任务、游戏状态、资源、积分。
- 重试同一 action/event 不重复掷骰或扣/加余额。
- 导师不能读隐藏设定；判定复核也不能泄露秘密。
- 10/20/30 分专注可跨学科与导师保留；仅真实学习计入。
- 旧签到、日历、错题、商店、兑换、共享记忆全部可运行。

## 非目标与安全边界

本阶段不重写页面、不切换生产存档、不配置新付费 API、不公布或创作任何具体剧情。部署前必须在隔离环境验证，并检查 API/Google/共享记忆权限和 Cloudflare 配额。
