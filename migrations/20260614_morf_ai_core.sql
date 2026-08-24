-- Morf AI Core Fase 1
-- Preparación segura para créditos, recargas Polar y consumo con margen comercial.

CREATE TABLE IF NOT EXISTS morf_ai_wallets (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  balance_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
  monthly_limit_cents BIGINT,
  status TEXT NOT NULL DEFAULT 'active',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS morf_ai_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  chat_id INTEGER,
  module_code TEXT NOT NULL DEFAULT 'base_ai',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  provider_cost_cents BIGINT NOT NULL DEFAULT 0,
  customer_cost_cents BIGINT NOT NULL DEFAULT 0,
  markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
  status TEXT NOT NULL DEFAULT 'completed',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS morf_ai_usage_logs_team_created_idx ON morf_ai_usage_logs(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS morf_ai_usage_logs_module_idx ON morf_ai_usage_logs(team_id, module_code, created_at DESC);

CREATE TABLE IF NOT EXISTS morf_ai_recharges (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'polar',
  checkout_id TEXT,
  external_payment_id TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  credited_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS morf_ai_recharges_team_created_idx ON morf_ai_recharges(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS morf_ai_recharges_checkout_idx ON morf_ai_recharges(checkout_id);

CREATE TABLE IF NOT EXISTS morf_ai_global_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  default_provider TEXT NOT NULL DEFAULT 'openrouter',
  default_model TEXT NOT NULL DEFAULT 'openrouter/auto',
  markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
  enable_smart_routing BOOLEAN NOT NULL DEFAULT TRUE,
  enable_client_own_key BOOLEAN NOT NULL DEFAULT TRUE,
  polar_recharge_product_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT morf_ai_global_settings_singleton CHECK (id = 1)
);

INSERT INTO morf_ai_global_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;
