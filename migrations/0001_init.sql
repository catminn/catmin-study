-- 共享记忆 + 学习数据，同一个 D1 数据库（catmin-study）

-- 记忆（兼容 mcp-memory-service 的字段）
CREATE TABLE IF NOT EXISTS memories (
  content_hash TEXT PRIMARY KEY,
  content      TEXT NOT NULL,
  tags         TEXT NOT NULL DEFAULT '[]',   -- JSON 数组
  memory_type  TEXT NOT NULL DEFAULT 'note', -- note / reference / decision / mistake ...
  metadata     TEXT NOT NULL DEFAULT '{}',   -- JSON 对象
  agent_id     TEXT,
  created_at   REAL NOT NULL,                -- Unix 秒
  updated_at   REAL NOT NULL,
  embedded     INTEGER NOT NULL DEFAULT 0    -- 1 = 已写入 Vectorize
);
CREATE INDEX IF NOT EXISTS idx_mem_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_mem_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_mem_embedded ON memories(embedded);

-- 标签拆表，方便按标签筛选
CREATE TABLE IF NOT EXISTS memory_tags (
  content_hash TEXT NOT NULL REFERENCES memories(content_hash) ON DELETE CASCADE,
  tag          TEXT NOT NULL,
  PRIMARY KEY (content_hash, tag)
);
CREATE INDEX IF NOT EXISTS idx_tag ON memory_tags(tag);

-- ===== 以下为第 2、3 步（主神空间进度同步、网站）预留，现在先建好表 =====

-- 游戏存档 / 学习进度：key 例如 'state'、'chat-math'；version 用来防止两边同时写互相覆盖
CREATE TABLE IF NOT EXISTS study_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at REAL NOT NULL,
  updated_by TEXT
);

-- 每次学习对话的摘要（用于跨模式、跨模型衔接）
CREATE TABLE IF NOT EXISTS chat_summaries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  subject    TEXT NOT NULL,
  summary    TEXT NOT NULL,
  source     TEXT,              -- artifact / site / claude / chatgpt
  created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sum_subject ON chat_summaries(subject, created_at);

-- 网站 API 模式的用量记录（花费上限用）
CREATE TABLE IF NOT EXISTS api_usage (
  day        TEXT NOT NULL,     -- YYYY-MM-DD (UTC)
  model      TEXT NOT NULL,
  input_tok  INTEGER NOT NULL DEFAULT 0,
  output_tok INTEGER NOT NULL DEFAULT 0,
  cost_usd   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);
