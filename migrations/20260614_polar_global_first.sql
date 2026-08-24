BEGIN;

CREATE TABLE IF NOT EXISTS payment_gateway_settings (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL UNIQUE,
  display_name VARCHAR(120),
  environment VARCHAR(40),
  client_id TEXT,
  client_secret TEXT,
  webhook_id TEXT,
  webhook_url TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_plan_key VARCHAR(120);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_product_id TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_price_id TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(40) NOT NULL DEFAULT 'polar';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_sync_status TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_synced_at TIMESTAMP;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

ALTER TABLE teams ADD COLUMN IF NOT EXISTS polar_customer_id TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS current_subscription_id TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS subscription_provider VARCHAR(40) NOT NULL DEFAULT 'polar';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS billing_status VARCHAR(40) NOT NULL DEFAULT 'inactive';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

UPDATE plans
SET billing_provider = 'polar',
    polar_plan_key = COALESCE(
      NULLIF(polar_plan_key, ''),
      LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g')) || '_' || COALESCE(interval, 'month')
    ),
    polar_sync_status = CASE
      WHEN NULLIF(COALESCE(polar_product_id, ''), '') IS NULL AND amount > 0 THEN 'pending_sync'
      WHEN amount = 0 THEN 'free'
      ELSE COALESCE(polar_sync_status, 'connected')
    END,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS polar_plan_mappings (
  id SERIAL PRIMARY KEY,
  local_plan_id INTEGER,
  local_plan_key VARCHAR(120),
  billing_cycle VARCHAR(40) NOT NULL DEFAULT 'monthly',
  polar_product_id TEXT,
  polar_price_id TEXT,
  polar_product_name TEXT,
  polar_mode TEXT,
  status TEXT DEFAULT 'pending_sync',
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS local_plan_id INTEGER;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS local_plan_key VARCHAR(120);
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(40) NOT NULL DEFAULT 'monthly';
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS polar_product_id TEXT;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS polar_price_id TEXT;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS polar_product_name TEXT;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS polar_mode TEXT;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending_sync';
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

INSERT INTO polar_plan_mappings (
  local_plan_id,
  local_plan_key,
  billing_cycle,
  polar_product_id,
  polar_price_id,
  polar_product_name,
  polar_mode,
  status,
  is_active,
  metadata,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.polar_plan_key,
  CASE WHEN p.interval = 'year' THEN 'yearly' ELSE 'monthly' END,
  NULLIF(p.polar_product_id, ''),
  NULLIF(p.polar_price_id, ''),
  p.name,
  COALESCE(NULLIF(current_setting('app.polar_server', true), ''), 'production'),
  CASE WHEN NULLIF(COALESCE(p.polar_product_id, ''), '') IS NULL AND p.amount > 0 THEN 'pending_sync' WHEN p.amount = 0 THEN 'free' ELSE 'connected' END,
  COALESCE(p.is_active, true),
  jsonb_build_object('source', 'polar_global_first_patch'),
  NOW(),
  NOW()
FROM plans p
WHERE NOT EXISTS (
  SELECT 1 FROM polar_plan_mappings ppm
  WHERE ppm.local_plan_id = p.id
     OR ppm.local_plan_key = p.polar_plan_key
);

INSERT INTO payment_gateway_settings (provider, display_name, environment, webhook_url, is_enabled, metadata, created_at, updated_at)
VALUES ('polar', 'Polar AllSender', 'production', 'https://auth.allsender.tech/api/webhooks/polar', true, '{"provider":"polar","active_for_new_checkouts":true}'::jsonb, NOW(), NOW())
ON CONFLICT (provider) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  webhook_url = EXCLUDED.webhook_url,
  is_enabled = true,
  metadata = COALESCE(payment_gateway_settings.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO payment_gateway_settings (provider, display_name, environment, is_enabled, metadata, created_at, updated_at)
VALUES ('active_payment_provider', 'Proveedor activo', 'production', true, '{"provider":"polar"}'::jsonb, NOW(), NOW())
ON CONFLICT (provider) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  environment = EXCLUDED.environment,
  is_enabled = true,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

UPDATE payment_gateway_settings
SET is_enabled = false,
    metadata = COALESCE(metadata, '{}'::jsonb) || '{"legacy_only":true}'::jsonb,
    updated_at = NOW()
WHERE provider IN ('paypal', 'stripe');

COMMIT;
