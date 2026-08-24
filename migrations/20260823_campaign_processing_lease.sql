-- Campaign processing lease: prevents concurrent send workers and allows
-- recovery after a crashed PM2/cron worker without resetting sent deliveries.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS campaigns_processing_lease_idx
     ON campaigns (status, processing_started_at);

-- Per-recipient delivery contract.  A lead is claimed before calling a
-- provider and remains SENDING until the provider result is persisted.  The
-- ledger gives operators a durable audit trail and prevents automatic retries
-- from replaying a delivery whose result is unknown after a crash.
ALTER TABLE campaign_leads
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS campaign_leads_delivery_state_idx
  ON campaign_leads (campaign_id, status, claimed_at);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_leads_idempotency_idx
  ON campaign_leads (campaign_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_delivery_attempts (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  campaign_lead_id INTEGER NOT NULL REFERENCES campaign_leads(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  provider VARCHAR(40),
  idempotency_key TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SENDING',
  provider_message_id TEXT,
  error_class VARCHAR(40),
  error TEXT,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE (campaign_lead_id, attempt_no),
  UNIQUE (campaign_lead_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS campaign_delivery_attempts_campaign_idx
  ON campaign_delivery_attempts (campaign_id, status, requested_at);
