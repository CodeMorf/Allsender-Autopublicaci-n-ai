-- Vendor AI: multiprovider routing + pricing verificado + descuento de input cacheado.
-- Importes en CENTAVOS USD por 1M tokens, consistente con morf_ai_provider_pricing.
-- Kimi/NordRouter/CodeMorf no se insertan aquí: sus tarifas dependen de moneda/modelo
-- elegido y el runtime debe fallar cerrado hasta que exista una fila exacta verificada.

ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS vendor_llm_provider TEXT,
  ADD COLUMN IF NOT EXISTS vendor_llm_model TEXT;

ALTER TABLE morf_ai_provider_pricing
  ADD COLUMN IF NOT EXISTS cached_input_per_million_cents NUMERIC(14,6);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_sales_settings_vendor_llm_provider_chk'
  ) THEN
    ALTER TABLE ai_sales_settings
      ADD CONSTRAINT ai_sales_settings_vendor_llm_provider_chk
      CHECK (
        vendor_llm_provider IS NULL OR
        vendor_llm_provider IN ('deepseek', 'openai', 'kimi', 'nordrouter', 'codemorf', 'mistral')
      );
  END IF;
END $$;

COMMENT ON COLUMN ai_sales_settings.vendor_llm_provider IS
  'Proveedor LLM server-side para Vendor AI. NULL usa VENDOR_AI_LLM_PROVIDER. No exponer claves ni detalles técnicos en UI cliente.';
COMMENT ON COLUMN ai_sales_settings.vendor_llm_model IS
  'Modelo exacto server-side para Vendor AI. NULL usa el default/configuración del proveedor.';

-- DeepSeek V4 Flash (2026-08-15):
-- cache miss $0.14/M = 14 cents/M
-- cache hit  $0.0028/M = 0.28 cents/M
-- output     $0.28/M = 28 cents/M
INSERT INTO morf_ai_provider_pricing (
  provider, model, input_per_million_cents, cached_input_per_million_cents,
  output_per_million_cents, request_cost_cents, audio_per_minute_cents,
  currency, is_active, source_url, effective_at, metadata
) VALUES (
  'deepseek', 'deepseek-v4-flash', 14.000000, 0.280000,
  28.000000, 0.000000, 0.000000,
  'USD', TRUE, 'https://api-docs.deepseek.com/quick_start/pricing/', NOW(),
  '{"verified_on":"2026-08-15","billing_unit":"token","thinking_default_disabled_by_vendor_ai":true}'::jsonb
)
ON CONFLICT (provider, model) DO UPDATE SET
  input_per_million_cents = EXCLUDED.input_per_million_cents,
  cached_input_per_million_cents = EXCLUDED.cached_input_per_million_cents,
  output_per_million_cents = EXCLUDED.output_per_million_cents,
  request_cost_cents = EXCLUDED.request_cost_cents,
  currency = EXCLUDED.currency,
  is_active = TRUE,
  source_url = EXCLUDED.source_url,
  effective_at = EXCLUDED.effective_at,
  metadata = morf_ai_provider_pricing.metadata || EXCLUDED.metadata,
  updated_at = NOW();

-- OpenAI GPT-5 nano (2026-08-15):
-- input $0.05/M = 5 cents/M
-- cached input $0.005/M = 0.5 cents/M
-- output $0.40/M = 40 cents/M
INSERT INTO morf_ai_provider_pricing (
  provider, model, input_per_million_cents, cached_input_per_million_cents,
  output_per_million_cents, request_cost_cents, audio_per_minute_cents,
  currency, is_active, source_url, effective_at, metadata
) VALUES (
  'openai', 'gpt-5-nano', 5.000000, 0.500000,
  40.000000, 0.000000, 0.000000,
  'USD', TRUE, 'https://developers.openai.com/api/docs/models/gpt-5-nano', NOW(),
  '{"verified_on":"2026-08-15","billing_unit":"token","function_calling":true}'::jsonb
)
ON CONFLICT (provider, model) DO UPDATE SET
  input_per_million_cents = EXCLUDED.input_per_million_cents,
  cached_input_per_million_cents = EXCLUDED.cached_input_per_million_cents,
  output_per_million_cents = EXCLUDED.output_per_million_cents,
  request_cost_cents = EXCLUDED.request_cost_cents,
  currency = EXCLUDED.currency,
  is_active = TRUE,
  source_url = EXCLUDED.source_url,
  effective_at = EXCLUDED.effective_at,
  metadata = morf_ai_provider_pricing.metadata || EXCLUDED.metadata,
  updated_at = NOW();

COMMENT ON COLUMN morf_ai_provider_pricing.cached_input_per_million_cents IS
  'Costo del proveedor en centavos USD por 1M tokens servidos desde cache. NULL = usar tarifa normal de input.';
