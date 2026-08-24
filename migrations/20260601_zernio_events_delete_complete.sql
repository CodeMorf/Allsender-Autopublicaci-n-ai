-- Allsender SaaS Zernio events + hard delete guard 2026-06-01
-- Seguro/idempotente: se puede importar varias veces por aaPanel/phpPgAdmin.
-- No borra datos existentes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_delete_guards (
  id bigserial PRIMARY KEY,
  team_id integer NOT NULL,
  instance_id integer NOT NULL DEFAULT 0,
  remote_jid text NOT NULL,
  last_message_timestamp timestamptz,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  block_until timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  reason text NOT NULL DEFAULT 'manual_delete',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_delete_guards_team_instance_jid_uidx
  ON public.chat_delete_guards (team_id, instance_id, remote_jid);

CREATE INDEX IF NOT EXISTS chat_delete_guards_lookup_idx
  ON public.chat_delete_guards (team_id, remote_jid, deleted_at DESC);

CREATE TABLE IF NOT EXISTS marketing_ai_event_logs (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  platform VARCHAR(80) NOT NULL DEFAULT 'zernio',
  provider VARCHAR(80) NOT NULL DEFAULT 'zernio',
  account_id VARCHAR(180) NULL,
  event_type VARCHAR(120) NOT NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'received',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_ai_event_logs_team ON marketing_ai_event_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_event_logs_event ON marketing_ai_event_logs(team_id, event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS marketing_ai_post_logs (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  post_id INTEGER NULL,
  platform VARCHAR(80) NOT NULL DEFAULT 'zernio',
  provider VARCHAR(80) NOT NULL DEFAULT 'zernio',
  event_type VARCHAR(120) NOT NULL,
  status VARCHAR(60) NOT NULL DEFAULT 'received',
  message TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_ai_post_logs_team ON marketing_ai_post_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_post_logs_event ON marketing_ai_post_logs(team_id, event_type, created_at DESC);

COMMIT;
