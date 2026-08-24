-- Allsender Marketing IA V15
-- Importar por web/phpPgAdmin/aaPanel si quieres dejar preparada la base para autopublicar, comentarios IA y links cortos.
-- No toca Zernio, Meta, Evolution ni IA ventas existentes.

BEGIN;

CREATE TABLE IF NOT EXISTS marketing_ai_settings (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  auto_comment_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_dm_enabled BOOLEAN NOT NULL DEFAULT true,
  tone VARCHAR(80) NOT NULL DEFAULT 'professional_friendly',
  base_prompt TEXT NOT NULL DEFAULT 'Eres un asistente de comentarios para redes sociales. Responde claro, amable y profesional. No vendas agresivo. No inventes precios. Si el usuario pide información personal, pedido, pago o cotización, responde breve y envíalo al DM o WhatsApp con un link corto. Mantén el tono de la marca y evita discusiones públicas.',
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
  provider VARCHAR(80) NULL,
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

COMMIT;
