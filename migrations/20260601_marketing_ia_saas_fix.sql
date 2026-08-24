-- Allsender Marketing IA / Zernio SaaS Fix 2026-06-01
-- Importar por phpPgAdmin/aaPanel si faltan tablas de Autopublicar, Comentarios IA o Links Cortos.
-- No toca datos existentes, no toca chat, no toca órdenes, no toca ventas IA.

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_ai_settings (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_comment_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_dm_enabled BOOLEAN NOT NULL DEFAULT true,
  tone VARCHAR(80) NOT NULL DEFAULT 'professional_friendly',
  base_prompt TEXT NOT NULL DEFAULT 'Eres un asistente informativo de la empresa. Responde comentarios de forma clara, amable y profesional. No inventes precios, promesas ni disponibilidad. Si el cliente pregunta precio, ubicación, disponibilidad o pedido, pídele que escriba por DM o WhatsApp usando el link oficial. Si detectas queja, molestia, reclamo, insulto o problema serio, no respondas agresivo: marca para humano.',
  human_handoff_keywords TEXT[] NOT NULL DEFAULT ARRAY['queja','reclamo','estafa','demanda','abogado','mal servicio','cancelar'],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id)
);

CREATE TABLE IF NOT EXISTS marketing_ai_posts (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  title VARCHAR(180) NULL,
  body TEXT NOT NULL,
  media_url TEXT NULL,
  channels JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  scheduled_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_ai_posts_team ON marketing_ai_posts(team_id);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_posts_status ON marketing_ai_posts(team_id, status);

CREATE TABLE IF NOT EXISTS marketing_ai_comment_logs (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  platform VARCHAR(80) NOT NULL,
  provider VARCHAR(80) NULL DEFAULT 'zernio',
  account_id VARCHAR(180) NULL,
  external_comment_id VARCHAR(220) NULL,
  external_post_id VARCHAR(220) NULL,
  author_username VARCHAR(180) NULL,
  comment_text TEXT NOT NULL,
  ai_reply TEXT NULL,
  action VARCHAR(80) NOT NULL DEFAULT 'pending',
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_team ON marketing_ai_comment_logs(team_id);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_external ON marketing_ai_comment_logs(external_comment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_unique_external
  ON marketing_ai_comment_logs(team_id, platform, external_comment_id)
  WHERE external_comment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS short_links (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  slug VARCHAR(120) NOT NULL,
  title VARCHAR(180) NOT NULL,
  destination_url TEXT NOT NULL,
  channel VARCHAR(80) NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  leads INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_short_links_team ON short_links(team_id);
CREATE INDEX IF NOT EXISTS idx_short_links_slug ON short_links(slug);

CREATE TABLE IF NOT EXISTS short_link_clicks (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  link_id INTEGER NOT NULL REFERENCES short_links(id) ON DELETE CASCADE,
  ip_hash VARCHAR(128) NULL,
  user_agent TEXT NULL,
  referer TEXT NULL,
  channel VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_short_link_clicks_link ON short_link_clicks(link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_short_link_clicks_team ON short_link_clicks(team_id, created_at DESC);

COMMIT;
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
