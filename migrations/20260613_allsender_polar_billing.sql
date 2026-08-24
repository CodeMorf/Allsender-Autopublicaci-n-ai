BEGIN;

-- =========================================================
-- AllSender Billing V3: Polar como proveedor principal
-- Mantiene Stripe/PayPal como histórico interno.
-- =========================================================

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

ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS display_name VARCHAR(120);
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS environment VARCHAR(40);
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS client_secret TEXT;
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS webhook_id TEXT;
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS webhook_url TEXT;
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE payment_gateway_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DELETE FROM payment_gateway_settings a
USING payment_gateway_settings b
WHERE a.ctid < b.ctid
  AND a.provider = b.provider;

CREATE UNIQUE INDEX IF NOT EXISTS payment_gateway_settings_provider_unique ON payment_gateway_settings(provider);

INSERT INTO payment_gateway_settings (
  provider,
  display_name,
  environment,
  webhook_url,
  is_enabled,
  metadata,
  created_at,
  updated_at
) VALUES (
  'polar',
  'Polar AllSender',
  COALESCE(NULLIF(current_setting('app.polar_server', true), ''), 'sandbox'),
  'https://auth.allsender.tech/api/webhooks/polar',
  true,
  '{"provider":"polar","active_for_new_checkouts":true}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (provider) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  webhook_url = EXCLUDED.webhook_url,
  is_enabled = true,
  metadata = COALESCE(payment_gateway_settings.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

UPDATE payment_gateway_settings
SET is_enabled = false,
    metadata = COALESCE(metadata, '{}'::jsonb) || '{"legacy_only":true}'::jsonb,
    updated_at = NOW()
WHERE provider IN ('paypal', 'stripe');

ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_plan_key VARCHAR(120);
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_product_id TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS polar_price_id TEXT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS billing_provider VARCHAR(40) NOT NULL DEFAULT 'polar';
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;

UPDATE plans
SET polar_plan_key = COALESCE(
      NULLIF(polar_plan_key, ''),
      LOWER(REGEXP_REPLACE(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '_', 'g'), '^_|_$', '', 'g')) || '_' || COALESCE(interval, 'month')
    ),
    billing_provider = 'polar',
    updated_at = NOW();

ALTER TABLE teams ADD COLUMN IF NOT EXISTS polar_customer_id TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS current_subscription_id TEXT;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS subscription_provider VARCHAR(40) NOT NULL DEFAULT 'polar';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS billing_status VARCHAR(40) NOT NULL DEFAULT 'inactive';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMP;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMP;
ALTER TABLE teams ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS teams_polar_customer_idx ON teams(polar_customer_id);
CREATE INDEX IF NOT EXISTS teams_current_subscription_idx ON teams(current_subscription_id);

CREATE TABLE IF NOT EXISTS polar_plan_mappings (
  id SERIAL PRIMARY KEY,
  local_plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
  local_plan_key VARCHAR(120),
  billing_cycle VARCHAR(40) NOT NULL DEFAULT 'monthly',
  polar_product_id TEXT,
  polar_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(local_plan_id, billing_cycle)
);

ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS local_plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS local_plan_key VARCHAR(120);
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(40) NOT NULL DEFAULT 'monthly';
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS polar_product_id TEXT;
ALTER TABLE polar_plan_mappings ADD COLUMN IF NOT EXISTS polar_price_id TEXT;
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
  true,
  jsonb_build_object('source', 'auto_seed', 'plan_name', p.name),
  NOW(),
  NOW()
FROM plans p
ON CONFLICT (local_plan_id, billing_cycle) DO UPDATE SET
  local_plan_key = EXCLUDED.local_plan_key,
  polar_product_id = COALESCE(polar_plan_mappings.polar_product_id, EXCLUDED.polar_product_id),
  polar_price_id = COALESCE(polar_plan_mappings.polar_price_id, EXCLUDED.polar_price_id),
  is_active = true,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS polar_checkout_sessions (
  id SERIAL PRIMARY KEY,
  checkout_id TEXT UNIQUE,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  polar_product_id TEXT,
  polar_price_id TEXT,
  checkout_url TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'created',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS polar_checkout_team_idx ON polar_checkout_sessions(team_id);
CREATE INDEX IF NOT EXISTS polar_checkout_plan_idx ON polar_checkout_sessions(plan_id);

CREATE TABLE IF NOT EXISTS polar_webhook_events (
  id SERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type VARCHAR(120) NOT NULL,
  polar_object_id TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'received',
  verification_status VARCHAR(40) NOT NULL DEFAULT 'verified',
  verified BOOLEAN NOT NULL DEFAULT true,
  processed_at TIMESTAMP,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS polar_webhook_events_type_idx ON polar_webhook_events(event_type);
CREATE INDEX IF NOT EXISTS polar_webhook_events_status_idx ON polar_webhook_events(status);

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL DEFAULT 'polar',
  provider_subscription_id TEXT NOT NULL,
  provider_customer_id TEXT,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_subscription_id)
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_team_idx ON billing_subscriptions(team_id);
CREATE INDEX IF NOT EXISTS billing_subscriptions_status_idx ON billing_subscriptions(provider, status);

CREATE TABLE IF NOT EXISTS billing_payments (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL DEFAULT 'polar',
  provider_payment_id TEXT,
  provider_order_id TEXT,
  provider_customer_id TEXT,
  polar_order_id TEXT,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  amount NUMERIC(12,2),
  amount_cents INTEGER,
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMP,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'polar';
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS polar_order_id TEXT;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2);
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS amount_cents INTEGER;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) NOT NULL DEFAULT 'USD';
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'pending';
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();
ALTER TABLE billing_payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DELETE FROM billing_payments a
USING billing_payments b
WHERE a.ctid < b.ctid
  AND a.provider = b.provider
  AND a.provider_order_id IS NOT NULL
  AND a.provider_order_id = b.provider_order_id;

CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_provider_order_unique ON billing_payments(provider, provider_order_id);
CREATE INDEX IF NOT EXISTS billing_payments_team_idx ON billing_payments(team_id);
CREATE INDEX IF NOT EXISTS billing_payments_provider_status_idx ON billing_payments(provider, status);

CREATE TABLE IF NOT EXISTS billing_audit_logs (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(40) NOT NULL DEFAULT 'polar',
  action VARCHAR(120) NOT NULL,
  team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS billing_audit_logs_provider_action_idx ON billing_audit_logs(provider, action);
CREATE INDEX IF NOT EXISTS billing_audit_logs_team_idx ON billing_audit_logs(team_id);

-- Variable comercial interna para nuevos checkouts.
INSERT INTO payment_gateway_settings (provider, display_name, environment, is_enabled, metadata, created_at, updated_at)
VALUES ('active_payment_provider', 'Proveedor activo', 'production', true, '{"provider":"polar"}'::jsonb, NOW(), NOW())
ON CONFLICT (provider) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  is_enabled = true,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();

COMMIT;
