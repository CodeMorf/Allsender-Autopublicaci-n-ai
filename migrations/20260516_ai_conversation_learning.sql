CREATE TABLE IF NOT EXISTS ai_conversation_learning_settings (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  auto_capture BOOLEAN NOT NULL DEFAULT TRUE,
  use_in_prompt BOOLEAN NOT NULL DEFAULT TRUE,
  learning_mode VARCHAR(40) NOT NULL DEFAULT 'sales',
  max_prompt_memories INTEGER NOT NULL DEFAULT 12,
  min_message_length INTEGER NOT NULL DEFAULT 8,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_conversation_learning_settings_team_unique UNIQUE(team_id)
);

CREATE TABLE IF NOT EXISTS ai_conversation_memories (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  chat_id INTEGER REFERENCES chats(id) ON DELETE SET NULL,
  source_message_id TEXT,
  memory_type VARCHAR(60) NOT NULL DEFAULT 'note',
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(4,2) NOT NULL DEFAULT 0.70,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  times_seen INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_conversation_memories_team_status_idx ON ai_conversation_memories(team_id, status);
CREATE INDEX IF NOT EXISTS ai_conversation_memories_team_type_idx ON ai_conversation_memories(team_id, memory_type);
CREATE INDEX IF NOT EXISTS ai_conversation_memories_chat_idx ON ai_conversation_memories(chat_id);
CREATE INDEX IF NOT EXISTS ai_conversation_memories_last_seen_idx ON ai_conversation_memories(team_id, last_seen_at DESC);

INSERT INTO ai_conversation_learning_settings (team_id, is_active, auto_capture, use_in_prompt, learning_mode, max_prompt_memories, min_message_length)
SELECT id, FALSE, TRUE, TRUE, 'sales', 12, 8
FROM teams
ON CONFLICT (team_id) DO NOTHING;
