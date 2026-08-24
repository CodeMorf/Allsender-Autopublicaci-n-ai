BEGIN;

-- Morf AI Core Fase 1.3
-- Super Admin + créditos + paquetes de recarga + Polar + consumo por equipo.

-- Compatibilidad con el checkout global de Polar existente.
ALTER TABLE IF EXISTS polar_checkout_sessions ADD COLUMN IF NOT EXISTS polar_price_id TEXT;

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
  package_id BIGINT,
  provider TEXT NOT NULL DEFAULT 'polar',
  checkout_id TEXT,
  external_payment_id TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  credited_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending',
  polar_product_id TEXT,
  polar_price_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS package_id BIGINT;
ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS polar_product_id TEXT;
ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS polar_price_id TEXT;
CREATE INDEX IF NOT EXISTS morf_ai_recharges_team_created_idx ON morf_ai_recharges(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS morf_ai_recharges_checkout_idx ON morf_ai_recharges(checkout_id);

CREATE TABLE IF NOT EXISTS morf_ai_global_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  default_provider TEXT NOT NULL DEFAULT 'openrouter',
  default_model TEXT NOT NULL DEFAULT 'openrouter/auto',
  markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
  default_message_cost_cents BIGINT NOT NULL DEFAULT 1,
  enable_smart_routing BOOLEAN NOT NULL DEFAULT TRUE,
  enable_client_own_key BOOLEAN NOT NULL DEFAULT TRUE,
  polar_recharge_product_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT morf_ai_global_settings_singleton CHECK (id = 1)
);

ALTER TABLE morf_ai_global_settings ADD COLUMN IF NOT EXISTS default_message_cost_cents BIGINT NOT NULL DEFAULT 1;

INSERT INTO morf_ai_global_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS morf_ai_recharge_packages (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  credit_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  polar_product_id TEXT,
  polar_price_id TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS morf_ai_team_settings (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
  is_enabled BOOLEAN,
  monthly_limit_cents BIGINT,
  status TEXT NOT NULL DEFAULT 'inherit',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO morf_ai_recharge_packages (code, name, description, amount_cents, credit_cents, currency, sort_order, metadata, created_at, updated_at)
VALUES
  ('morf_5', 'Inicial', 'Para validar el flujo con pocas conversaciones asistidas.', 500, 500, 'USD', 10, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW()),
  ('morf_10', 'Básico', 'Para negocios pequeños con atención ocasional.', 1000, 1000, 'USD', 20, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW()),
  ('morf_25', 'Recomendado', 'Para ventas, citas y chats con actividad diaria.', 2500, 2500, 'USD', 30, '{"seed":"fase1_3","recommended":true}'::jsonb, NOW(), NOW()),
  ('morf_50', 'Activo', 'Para equipos con WhatsApp, WebChat y agentes activos.', 5000, 5000, 'USD', 40, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW()),
  ('morf_100', 'Alto volumen', 'Para alto volumen de atención, ventas y automatizaciones.', 10000, 10000, 'USD', 50, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW())
ON CONFLICT (code) DO NOTHING;

-- Registrar Morf AI como módulo comercial controlable por plan.
INSERT INTO saas_modules (code, name, description, base_price_amount, currency, trial_days, is_available, created_at, updated_at)
VALUES (
  'morf_ai',
  'Morf AI',
  'Motor inteligente integrado para IA básica, Ventas IA, Auto Cita IA, WhatsApp, WebChat y automatizaciones con saldo por equipo.',
  '0.00',
  'USD',
  0,
  true,
  NOW(),
  NOW()
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_available = true,
  updated_at = NOW();

COMMIT;
