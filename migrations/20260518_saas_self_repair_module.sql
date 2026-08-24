-- AllSender SaaS Self Repair Module
-- PostgreSQL migration
-- Objetivo: permitir que cada cliente SaaS repare conflictos de Ventas IA sin borrar mensajes, productos ni órdenes.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_sales_self_heal_runs (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  action VARCHAR(80) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'running',
  stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_sales_self_heal_runs_team_idx
ON ai_sales_self_heal_runs(team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_sales_conversation_state_team_chat_idx
ON ai_sales_conversation_state(team_id, chat_id);

CREATE INDEX IF NOT EXISTS ai_sales_conversation_state_team_stage_idx
ON ai_sales_conversation_state(team_id, current_stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS ai_sales_chat_memory_team_chat_idx
ON ai_sales_chat_memory(team_id, chat_id);

CREATE INDEX IF NOT EXISTS ai_sessions_chat_idx
ON ai_sessions(chat_id);

CREATE INDEX IF NOT EXISTS ai_conversation_memories_team_status_source_idx
ON ai_conversation_memories(team_id, status, ((metadata->>'source')));

COMMIT;
