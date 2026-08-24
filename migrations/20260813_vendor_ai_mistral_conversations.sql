CREATE TABLE IF NOT EXISTS ai_sales_provider_conversations (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  provider VARCHAR(40) NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version TEXT,
  conversation_id TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  recovery_count INTEGER NOT NULL DEFAULT 0,
  last_error_code VARCHAR(80),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, chat_id, provider),
  UNIQUE (provider, conversation_id)
);

CREATE INDEX IF NOT EXISTS ai_sales_provider_conversations_team_status_idx
  ON ai_sales_provider_conversations (team_id, status, last_used_at DESC);

-- Rollback is intentionally manual because conversation references are continuity data:
-- DROP INDEX IF EXISTS ai_sales_provider_conversations_team_status_idx;
-- DROP TABLE IF EXISTS ai_sales_provider_conversations;
