-- Allsender Autopublicar OpenAPI V2 - UI calendario, plan y anti-fantasmas
-- Seguro/idempotente. Importar por Adminer/phpPgAdmin/aaPanel.
-- No toca /es/modulo/chat, no toca Evolution y no crea conexiones Zernio.

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_ai_settings (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_comment_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_dm_enabled BOOLEAN NOT NULL DEFAULT false,
  tone VARCHAR(80) NOT NULL DEFAULT 'professional_friendly',
  base_prompt TEXT NOT NULL DEFAULT 'Responde comentarios de forma clara, amable y profesional. No inventes precios ni disponibilidad.',
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

CREATE TABLE IF NOT EXISTS marketing_ai_comment_settings (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  mode VARCHAR(60) NOT NULL DEFAULT 'manual_review',
  base_instructions TEXT NULL,
  auto_dm BOOLEAN NOT NULL DEFAULT false,
  auto_reply_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(team_id)
);

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

CREATE TABLE IF NOT EXISTS saas_modules (
  code VARCHAR(80) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  base_price_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  trial_days INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO saas_modules (code, name, description, base_price_amount, currency, trial_days, is_available, created_at, updated_at)
VALUES ('autopublicar', 'Autopublicar', 'Módulo separado para crear, programar y publicar contenido en redes sociales usando cuentas conectadas por Zernio.', 0.00, 'USD', 0, true, NOW(), NOW())
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    description = EXCLUDED.description,
    is_available = true,
    updated_at = NOW();

CREATE INDEX IF NOT EXISTS idx_marketing_ai_posts_team_status_time ON marketing_ai_posts(team_id, status, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_posts_calendar ON marketing_ai_posts(team_id, (COALESCE(scheduled_at, published_at, created_at)));
CREATE INDEX IF NOT EXISTS idx_marketing_ai_post_logs_team_post ON marketing_ai_post_logs(team_id, post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_event_logs_team ON marketing_ai_event_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_event_logs_event ON marketing_ai_event_logs(team_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_team_status ON marketing_ai_comment_logs(team_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_unique_external
  ON marketing_ai_comment_logs(team_id, platform, external_comment_id)
  WHERE external_comment_id IS NOT NULL;

COMMIT;
