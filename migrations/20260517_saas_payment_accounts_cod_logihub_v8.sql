BEGIN;

ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS default_payment_method varchar(40) NOT NULL DEFAULT 'cod',
  ADD COLUMN IF NOT EXISTS cod_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS transfer_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_discount_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_discount_type varchar(20) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS payment_discount_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_discount_applies_to varchar(40) NOT NULL DEFAULT 'transfer';

ALTER TABLE ai_sales_orders
  ADD COLUMN IF NOT EXISTS payment_status varchar(40) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_account_id varchar(120),
  ADD COLUMN IF NOT EXISTS payment_discount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepaid_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cod_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE ai_sales_settings
SET
  default_payment_method = CASE
    WHEN payment_methods::text ILIKE '%cod%' THEN 'cod'
    WHEN payment_methods::text ILIKE '%transfer%' THEN 'transfer'
    ELSE default_payment_method
  END,
  cod_enabled = CASE WHEN payment_methods::text ILIKE '%cod%' THEN true ELSE cod_enabled END,
  transfer_enabled = CASE WHEN payment_methods::text ILIKE '%transfer%' THEN true ELSE transfer_enabled END
WHERE payment_methods IS NOT NULL;

UPDATE ai_sales_orders
SET
  payment_status = CASE
    WHEN lower(coalesce(payment_method, '')) IN ('cod','contra_entrega','cash_on_delivery','cash') THEN 'pending_cod'
    WHEN lower(coalesce(payment_method, '')) IN ('transfer','transferencia','bank_transfer','deposito') THEN 'pending_transfer'
    ELSE payment_status
  END,
  cod_amount = CASE
    WHEN lower(coalesce(payment_method, '')) IN ('cod','contra_entrega','cash_on_delivery','cash') THEN total
    ELSE cod_amount
  END,
  payment_meta = coalesce(payment_meta, '{}'::jsonb) || jsonb_build_object('backfill_v8', true)
WHERE cod_amount = 0;

CREATE INDEX IF NOT EXISTS ai_sales_orders_team_payment_status_idx ON ai_sales_orders(team_id, payment_status);
CREATE INDEX IF NOT EXISTS ai_sales_orders_team_cod_amount_idx ON ai_sales_orders(team_id, cod_amount);

COMMIT;
