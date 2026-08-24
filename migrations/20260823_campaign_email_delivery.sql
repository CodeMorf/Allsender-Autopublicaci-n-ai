-- Campaigns 3.0: first-class email campaigns and channel routing.
-- Additive and backwards compatible: existing campaigns remain WhatsApp.
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'WHATSAPP',
  ADD COLUMN IF NOT EXISTS email_template_id BIGINT REFERENCES campaign_email_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS smtp_provider_id BIGINT REFERENCES campaign_smtp_providers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS test_mode BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE campaigns
  ALTER COLUMN instance_id DROP NOT NULL;

ALTER TABLE campaign_leads
  ALTER COLUMN phone DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS email VARCHAR(320);

CREATE INDEX IF NOT EXISTS campaigns_team_channel_created_idx
  ON campaigns (team_id, channel, created_at DESC);

CREATE INDEX IF NOT EXISTS campaign_leads_campaign_email_idx
  ON campaign_leads (campaign_id, email);
