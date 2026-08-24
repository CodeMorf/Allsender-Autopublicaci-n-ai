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

UPDATE ai_sales_settings
SET
  transfer_enabled = true,
  payment_methods = CASE
    WHEN coalesce(payment_methods, '[]'::jsonb) @> '["transfer"]'::jsonb THEN coalesce(payment_methods, '[]'::jsonb)
    ELSE coalesce(payment_methods, '[]'::jsonb) || '["transfer"]'::jsonb
  END,
  updated_at = now()
WHERE
  is_active = true
  AND (
    transfer_enabled IS DISTINCT FROM true
    OR coalesce(payment_methods, '[]'::jsonb)::text ILIKE '%transfer%'
    OR (
      jsonb_typeof(coalesce(payment_accounts, '[]'::jsonb)) = 'array'
      AND jsonb_array_length(coalesce(payment_accounts, '[]'::jsonb)) > 0
    )
  );

UPDATE ai_sessions
SET history = '[]'::jsonb, updated_at = now()
WHERE chat_id IN (
  SELECT c.id
  FROM chats c
  JOIN ai_sales_settings s ON s.team_id = c.team_id
  WHERE s.is_active = true
);

COMMIT;
