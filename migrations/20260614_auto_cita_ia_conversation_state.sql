BEGIN;

CREATE TABLE IF NOT EXISTS reservation_ai_conversation_state (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  current_stage VARCHAR(80) NOT NULL DEFAULT 'idle',
  detected_intent VARCHAR(80),
  selected_service_id BIGINT REFERENCES reservation_services(id) ON DELETE SET NULL,
  selected_resource_id BIGINT REFERENCES reservation_resources(id) ON DELETE SET NULL,
  requested_date VARCHAR(20),
  requested_time VARCHAR(20),
  customer_name VARCHAR(180),
  customer_phone VARCHAR(80),
  customer_email VARCHAR(220),
  pending_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_user_message TEXT,
  last_ai_message TEXT,
  human_required BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(team_id, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_reservation_ai_state_team_chat
  ON reservation_ai_conversation_state (team_id, chat_id);

CREATE INDEX IF NOT EXISTS idx_reservation_ai_state_stage
  ON reservation_ai_conversation_state (team_id, current_stage, updated_at DESC);

COMMIT;
