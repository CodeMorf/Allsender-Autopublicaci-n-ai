-- Campaigns 3.0: tenant settings, SMTP providers and email templates.
CREATE TABLE IF NOT EXISTS campaign_settings (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  general JSONB NOT NULL DEFAULT '{}'::jsonb,
  router JSONB NOT NULL DEFAULT '{}'::jsonb,
  limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  exclusions JSONB NOT NULL DEFAULT '{}'::jsonb,
  automations JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_smtp_providers (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL DEFAULT 587,
  secure BOOLEAN NOT NULL DEFAULT FALSE,
  username VARCHAR(255) NOT NULL,
  password_ciphertext TEXT NOT NULL,
  from_name VARCHAR(255),
  from_email VARCHAR(255) NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  daily_limit INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  health_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN',
  last_checked_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_smtp_team_priority_idx
  ON campaign_smtp_providers (team_id, is_active, priority);

CREATE TABLE IF NOT EXISTS campaign_email_templates (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  display_name VARCHAR(255) NOT NULL,
  provider_name VARCHAR(255) NOT NULL,
  subject TEXT NOT NULL,
  preheader TEXT,
  html TEXT NOT NULL,
  plain_text TEXT,
  sender VARCHAR(255),
  language VARCHAR(10) NOT NULL DEFAULT 'es',
  category VARCHAR(60) NOT NULL DEFAULT 'MARKETING',
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_email_templates_team_status_idx
  ON campaign_email_templates (team_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_email_suppressions (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email VARCHAR(320) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'UNSUBSCRIBED',
  source VARCHAR(60),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, email)
);
