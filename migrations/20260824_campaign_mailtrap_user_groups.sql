-- Campaigns 3.0: provider types, per-user remitters and owned contact groups.
-- Additive migration. Existing SMTP rows remain team-scoped and keep working.
ALTER TABLE campaign_smtp_providers
  ALTER COLUMN host DROP NOT NULL,
  ALTER COLUMN username DROP NOT NULL,
  ALTER COLUMN password_ciphertext DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS provider_type VARCHAR(20) NOT NULL DEFAULT 'SMTP',
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS api_token_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS mailtrap_sandbox BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mailtrap_inbox_id INTEGER;

CREATE INDEX IF NOT EXISTS campaign_smtp_providers_scope_idx
  ON campaign_smtp_providers (team_id, owner_user_id, is_active, priority);

ALTER TABLE campaign_audiences
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE campaign_imports
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS campaign_audiences_scope_idx
  ON campaign_audiences (team_id, owner_user_id, updated_at DESC);

-- Existing records are shared by the team. New records created from the UI are
-- owned by the authenticated user unless the user explicitly chooses team-wide.
