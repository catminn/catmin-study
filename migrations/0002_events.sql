-- 学习事件与奖励事件：只追加、幂等。字段取自 docs/rules-spec-v1.md / study-core.mjs。
-- 注意：src/events.ts 在第一次请求时也会执行同样的 CREATE TABLE IF NOT EXISTS，所以部署不需要手动迁移。
CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,              -- 事件唯一 ID，重复提交用它去重
  type TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  at INTEGER NOT NULL,              -- 发生时间（毫秒）
  correctness TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  assistance TEXT NOT NULL,
  verification TEXT NOT NULL,
  context TEXT NOT NULL,
  transfer INTEGER NOT NULL,
  payload TEXT NOT NULL,            -- 规范化后的完整事件 JSON，用来识别“同一 ID 不同内容”
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_le_topic ON learning_events(topic_id, at);

CREATE TABLE IF NOT EXISTS reward_events (
  id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE,   -- 同一个学习事件最多发一次奖励
  points INTEGER NOT NULL CHECK (points >= 0 AND points <= 10000),
  at INTEGER NOT NULL,
  created_at REAL NOT NULL
);
