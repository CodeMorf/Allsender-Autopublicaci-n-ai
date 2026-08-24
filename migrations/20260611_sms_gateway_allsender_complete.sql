-- SMS Gateway Allsender - instalación completa v1
-- Proyecto: auth.allsender.tech / Next.js + PostgreSQL
-- Objetivo: convertir el canal sms existente en SMS Gateway y crear cola/API para app Android con SIM local/dual SIM.

BEGIN;

-- 1) Asegurar catálogo del canal SMS Gateway sin duplicar module_key.
INSERT INTO allsender_channel_modules (
  module_key, name, description, channel_type, provider, price_cents, currency, trial_days, is_enabled, sort_order, metadata, created_at, updated_at
)
VALUES (
  'sms',
  'SMS Gateway',
  'Envía y recibe SMS usando un teléfono Android conectado con SIM local. Compatible con proveedor local y dual SIM.',
  'sms',
  'allsender_gateway',
  1200,
  'usd',
  0,
  true,
  50,
  '{"plan_hint":"US$12.00/mes por teléfono conectado","status_hint":"Requiere app Android con SIM activa","requires_android_app":true,"supports_inbound":true,"supports_marketing":true,"supports_dual_sim":true}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  channel_type = EXCLUDED.channel_type,
  provider = EXCLUDED.provider,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  trial_days = EXCLUDED.trial_days,
  is_enabled = true,
  sort_order = EXCLUDED.sort_order,
  metadata = COALESCE(allsender_channel_modules.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

-- 2) Conexiones/teléfonos Android con SIM.
CREATE TABLE IF NOT EXISTS sms_gateways (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  name VARCHAR(160) NOT NULL,
  device_token VARCHAR(180) NOT NULL UNIQUE,
  phone_number VARCHAR(60),
  sim_operator VARCHAR(120),
  sim_country VARCHAR(10),
  sim_slot INTEGER DEFAULT 1,
  device_name VARCHAR(180),
  android_version VARCHAR(80),
  app_version VARCHAR(80),
  battery_level INTEGER,
  charging BOOLEAN,
  status VARCHAR(30) NOT NULL DEFAULT 'offline',
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  send_enabled BOOLEAN NOT NULL DEFAULT true,
  inbound_enabled BOOLEAN NOT NULL DEFAULT true,
  marketing_enabled BOOLEAN NOT NULL DEFAULT false,
  dual_sim_enabled BOOLEAN NOT NULL DEFAULT false,
  polling_enabled BOOLEAN NOT NULL DEFAULT true,
  simulation_mode BOOLEAN NOT NULL DEFAULT false,
  daily_limit INTEGER NOT NULL DEFAULT 300,
  per_minute_limit INTEGER NOT NULL DEFAULT 10,
  last_seen_at TIMESTAMP NULL,
  last_poll_at TIMESTAMP NULL,
  last_inbound_at TIMESTAMP NULL,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_gateways_team_idx ON sms_gateways(team_id);
CREATE INDEX IF NOT EXISTS sms_gateways_team_active_idx ON sms_gateways(team_id, is_active);
CREATE INDEX IF NOT EXISTS sms_gateways_status_idx ON sms_gateways(status);
CREATE INDEX IF NOT EXISTS sms_gateways_last_seen_idx ON sms_gateways(last_seen_at);

-- 3) Cola, historial de salientes y entrantes.
CREATE TABLE IF NOT EXISTS sms_messages (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  gateway_id BIGINT NULL REFERENCES sms_gateways(id) ON DELETE SET NULL,
  chat_id INTEGER NULL REFERENCES chats(id) ON DELETE SET NULL,
  chat_message_id TEXT NULL REFERENCES messages(id) ON DELETE SET NULL,
  direction VARCHAR(20) NOT NULL DEFAULT 'outbound',
  to_number VARCHAR(60),
  from_number VARCHAR(60),
  message TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  source VARCHAR(60) NOT NULL DEFAULT 'api',
  sim_slot INTEGER DEFAULT 1,
  campaign_id BIGINT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  queued_at TIMESTAMP NOT NULL DEFAULT NOW(),
  processing_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  failed_at TIMESTAMP NULL,
  received_at TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_messages_team_status_idx ON sms_messages(team_id, status);
CREATE INDEX IF NOT EXISTS sms_messages_gateway_status_idx ON sms_messages(gateway_id, status);
CREATE INDEX IF NOT EXISTS sms_messages_to_idx ON sms_messages(to_number);
CREATE INDEX IF NOT EXISTS sms_messages_from_idx ON sms_messages(from_number);
CREATE INDEX IF NOT EXISTS sms_messages_campaign_idx ON sms_messages(campaign_id);
CREATE INDEX IF NOT EXISTS sms_messages_created_idx ON sms_messages(created_at DESC);

-- 4) Campañas SMS marketing.
CREATE TABLE IF NOT EXISTS sms_campaigns (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  gateway_id BIGINT NULL REFERENCES sms_gateways(id) ON DELETE SET NULL,
  name VARCHAR(180) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft',
  total_recipients INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMP NULL,
  started_at TIMESTAMP NULL,
  finished_at TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_campaigns_team_status_idx ON sms_campaigns(team_id, status);
CREATE INDEX IF NOT EXISTS sms_campaigns_created_idx ON sms_campaigns(created_at DESC);

CREATE TABLE IF NOT EXISTS sms_campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  phone_number VARCHAR(60) NOT NULL,
  contact_id INTEGER NULL REFERENCES contacts(id) ON DELETE SET NULL,
  sms_message_id BIGINT NULL REFERENCES sms_messages(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sms_campaign_recipients_campaign_idx ON sms_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS sms_campaign_recipients_team_status_idx ON sms_campaign_recipients(team_id, status);

COMMIT;
