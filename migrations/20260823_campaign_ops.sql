-- Campaigns 3.0 operational primitives: persistent jobs, calendar, automations and coupons.
CREATE TABLE IF NOT EXISTS campaign_jobs (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  kind VARCHAR(40) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  priority INTEGER NOT NULL DEFAULT 100,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  progress INTEGER NOT NULL DEFAULT 0,
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  locked_at TIMESTAMP,
  run_after TIMESTAMP NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS campaign_jobs_claim_idx
  ON campaign_jobs (status, priority, run_after, locked_at);

CREATE TABLE IF NOT EXISTS campaign_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  country VARCHAR(3) NOT NULL,
  year INTEGER NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
  language VARCHAR(10) NOT NULL DEFAULT 'es',
  event_date DATE NOT NULL,
  name VARCHAR(160) NOT NULL,
  event_type VARCHAR(30) NOT NULL DEFAULT 'CUSTOM',
  is_custom BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, country, year, event_date, name)
);

CREATE INDEX IF NOT EXISTS campaign_calendar_team_date_idx
  ON campaign_calendar_events (team_id, country, year, event_date);

CREATE TABLE IF NOT EXISTS campaign_automations (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  trigger_type VARCHAR(40) NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_automations_team_active_idx
  ON campaign_automations (team_id, is_active, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_coupons (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  description TEXT,
  discount_type VARCHAR(20) NOT NULL DEFAULT 'PERCENT',
  discount_value NUMERIC(12,2) NOT NULL,
  starts_at TIMESTAMP,
  expires_at TIMESTAMP,
  max_redemptions INTEGER,
  redeemed_count INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, code)
);

CREATE INDEX IF NOT EXISTS campaign_coupons_active_idx
  ON campaign_coupons (team_id, is_active, expires_at);
