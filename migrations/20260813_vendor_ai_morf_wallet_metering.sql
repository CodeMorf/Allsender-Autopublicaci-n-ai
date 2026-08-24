-- Vendor AI Fase 4: metering transaccional sobre Morf Wallet existente.
-- Reversible: el runtime Vendor AI queda apagado por defecto por tenant.

ALTER TABLE morf_ai_global_settings
  ADD COLUMN IF NOT EXISTS initial_credit_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS initial_credit_cents BIGINT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS vendor_ai_reserve_cents BIGINT NOT NULL DEFAULT 10;

ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS vendor_ai_mode TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS vendor_ai_agent_id TEXT,
  ADD COLUMN IF NOT EXISTS vendor_ai_agent_version TEXT NOT NULL DEFAULT '0';

ALTER TABLE morf_ai_usage_logs
  ADD COLUMN IF NOT EXISTS request_key TEXT,
  ADD COLUMN IF NOT EXISTS provider_request_id TEXT,
  ADD COLUMN IF NOT EXISTS reserved_customer_cost_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS error_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS morf_ai_usage_logs_team_request_uidx
  ON morf_ai_usage_logs(team_id, request_key)
  WHERE request_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS morf_ai_wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  usage_log_id BIGINT REFERENCES morf_ai_usage_logs(id) ON DELETE SET NULL,
  transaction_key TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, transaction_key)
);

CREATE INDEX IF NOT EXISTS morf_ai_wallet_transactions_team_created_idx
  ON morf_ai_wallet_transactions(team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS morf_ai_provider_pricing (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_per_million_cents NUMERIC(14,6) NOT NULL DEFAULT 0,
  output_per_million_cents NUMERIC(14,6) NOT NULL DEFAULT 0,
  request_cost_cents NUMERIC(14,6) NOT NULL DEFAULT 0,
  audio_per_minute_cents NUMERIC(14,6) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_url TEXT,
  effective_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (provider, model)
);

ALTER TABLE morf_ai_provider_pricing
  ADD COLUMN IF NOT EXISTS audio_per_minute_cents NUMERIC(14,6) NOT NULL DEFAULT 0;

INSERT INTO morf_ai_provider_pricing (
  provider, model, input_per_million_cents, output_per_million_cents,
  request_cost_cents, audio_per_minute_cents, currency, is_active, source_url, effective_at, metadata
) VALUES (
  'mistral', 'mistral-medium-latest', 150.000000, 750.000000,
  1.000000, 0.000000, 'USD', TRUE, 'https://mistral.ai/pricing/api/', NOW(),
  '{"verified_on":"2026-08-13","agent_api_request_cost_included":true}'::jsonb
)
ON CONFLICT (provider, model) DO NOTHING;

INSERT INTO morf_ai_provider_pricing (
  provider, model, input_per_million_cents, output_per_million_cents,
  request_cost_cents, audio_per_minute_cents, currency, is_active, source_url, effective_at, metadata
) VALUES (
  'mistral', 'voxtral-mini-latest', 0.000000, 0.000000,
  0.000000, 0.300000, 'USD', TRUE, 'https://mistral.ai/pricing/api/', NOW(),
  '{"verified_on":"2026-08-13","billing_unit":"audio_minute"}'::jsonb
)
ON CONFLICT (provider, model) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'morf_ai_wallets_nonnegative_balance'
  ) THEN
    ALTER TABLE morf_ai_wallets
      ADD CONSTRAINT morf_ai_wallets_nonnegative_balance CHECK (balance_cents >= 0) NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN ai_sales_settings.vendor_ai_mode IS
  'off, shadow, pilot, live. Production cutover is an explicit per-tenant operation.';

CREATE TABLE IF NOT EXISTS ai_sales_vendor_runtime_events (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT,
  request_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  outcome TEXT NOT NULL,
  proposed_answer TEXT,
  tools_used JSONB NOT NULL DEFAULT '[]'::jsonb,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  would_create_order BOOLEAN NOT NULL DEFAULT FALSE,
  would_handoff BOOLEAN NOT NULL DEFAULT FALSE,
  would_charge_cents BIGINT NOT NULL DEFAULT 0,
  charged_cents BIGINT NOT NULL DEFAULT 0,
  provider_cost_cents BIGINT NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (team_id, request_key, mode)
);

CREATE INDEX IF NOT EXISTS ai_sales_vendor_runtime_events_team_created_idx
  ON ai_sales_vendor_runtime_events(team_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_sales_vendor_rollout_audit (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  previous_mode TEXT NOT NULL,
  next_mode TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  approval_reference TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_sales_vendor_rollout_audit_team_created_idx
  ON ai_sales_vendor_rollout_audit(team_id, created_at DESC);
