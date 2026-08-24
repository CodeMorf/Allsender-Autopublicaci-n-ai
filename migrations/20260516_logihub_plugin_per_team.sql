ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS logihub_api_key TEXT,
  ADD COLUMN IF NOT EXISTS logihub_account_name TEXT,
  ADD COLUMN IF NOT EXISTS logihub_customer_id INTEGER,
  ADD COLUMN IF NOT EXISTS logihub_wallet_balance NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS logihub_wallet_currency VARCHAR(8) NOT NULL DEFAULT 'DOP',
  ADD COLUMN IF NOT EXISTS logihub_origin_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS logihub_last_summary_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS logihub_last_error TEXT;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS is_logihub_quote_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_logihub_create_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE plans
SET is_logihub_quote_enabled = TRUE,
    is_logihub_create_enabled = TRUE,
    updated_at = NOW();

UPDATE ai_sales_settings
SET default_delivery_fee = COALESCE(default_delivery_fee, 285.00),
    delivery_additional_item_fee = COALESCE(delivery_additional_item_fee, 5.00),
    logihub_wallet_currency = COALESCE(logihub_wallet_currency, 'DOP'),
    logihub_origin_json = COALESCE(logihub_origin_json, '{}'::jsonb),
    updated_at = NOW();
