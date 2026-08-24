-- Campaigns 3.0: tenant-scoped imports and reusable audiences.
-- Additive only; imported rows are an audit-friendly staging area and never
-- overwrite CRM contacts implicitly.
CREATE TABLE IF NOT EXISTS campaign_imports (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  file_name TEXT,
  source VARCHAR(40) NOT NULL DEFAULT 'generic',
  status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  invalid_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS campaign_imports_team_created_idx
  ON campaign_imports (team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_import_rows (
  id BIGSERIAL PRIMARY KEY,
  import_id BIGINT NOT NULL REFERENCES campaign_imports(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  source_external_id TEXT,
  normalized_phone TEXT,
  normalized_email TEXT,
  row_fingerprint TEXT NOT NULL,
  channel_status VARCHAR(40) NOT NULL DEFAULT 'WHATSAPP_UNKNOWN',
  row_status VARCHAR(20) NOT NULL DEFAULT 'VALID',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (import_id, row_number),
  UNIQUE (import_id, row_fingerprint)
);

CREATE INDEX IF NOT EXISTS campaign_import_rows_team_phone_idx
  ON campaign_import_rows (team_id, normalized_phone);

CREATE INDEX IF NOT EXISTS campaign_import_rows_team_email_idx
  ON campaign_import_rows (team_id, normalized_email);

CREATE TABLE IF NOT EXISTS campaign_audiences (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'STATIC',
  filter JSONB NOT NULL DEFAULT '{}'::jsonb,
  member_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS campaign_audiences_team_updated_idx
  ON campaign_audiences (team_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_audience_members (
  id BIGSERIAL PRIMARY KEY,
  audience_id BIGINT NOT NULL REFERENCES campaign_audiences(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  import_row_id BIGINT REFERENCES campaign_import_rows(id) ON DELETE SET NULL,
  phone TEXT,
  email TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (audience_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS campaign_audience_members_team_idx
  ON campaign_audience_members (team_id, audience_id);
