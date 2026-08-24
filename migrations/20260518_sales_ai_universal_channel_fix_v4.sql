-- AllSender Ventas AI - V4 Universal Channel Fix
-- PostgreSQL. Idempotente. No borra productos, ordenes, chats ni mensajes.

BEGIN;

ALTER TABLE IF EXISTS ai_sales_conversation_state
  ADD COLUMN IF NOT EXISTS pending_choice_type VARCHAR(80),
  ADD COLUMN IF NOT EXISTS pending_choices JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_lat NUMERIC(11,8),
  ADD COLUMN IF NOT EXISTS delivery_lng NUMERIC(11,8),
  ADD COLUMN IF NOT EXISTS delivery_name TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address_text TEXT,
  ADD COLUMN IF NOT EXISTS delivery_maps_url TEXT,
  ADD COLUMN IF NOT EXISTS order_draft JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_processed_message_id VARCHAR(180);

CREATE INDEX IF NOT EXISTS idx_ai_sales_state_pending_choice
  ON ai_sales_conversation_state(team_id, chat_id, pending_choice_type);

-- Corrige estados dañados donde WebChat quedó en pago por leer texto interno
-- pero realmente todavía estaba esperando selección de producto.
UPDATE ai_sales_conversation_state s
SET current_stage = 'waiting_product_selection',
    last_intent = 'ask_products',
    pending_choice_type = 'product',
    pending_choices = COALESCE(NULLIF(s.last_products_sent, 'null'::jsonb), '[]'::jsonb),
    payment_status = CASE WHEN s.selected_product_id IS NULL THEN 'none' ELSE s.payment_status END,
    missing_data = '[]'::jsonb,
    memory_summary = COALESCE(s.memory_summary, '{}'::jsonb) || '{"v4_repaired":"webchat_numeric_product_choice"}'::jsonb,
    updated_at = NOW()
FROM chats c
WHERE c.id = s.chat_id
  AND c.team_id = s.team_id
  AND c.remote_jid LIKE 'webchat_%@webchat.allsender'
  AND s.selected_product_id IS NULL
  AND jsonb_typeof(COALESCE(s.last_products_sent, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(s.last_products_sent, '[]'::jsonb)) > 0
  AND (s.current_stage = 'waiting_payment' OR s.pending_choice_type = 'payment_account');

-- Corrige cualquier estado donde pending_choice_type dice cuenta bancaria,
-- pero pending_choices contiene opciones de producto.
UPDATE ai_sales_conversation_state
SET pending_choice_type = 'product',
    current_stage = CASE WHEN selected_product_id IS NULL THEN 'waiting_product_selection' ELSE current_stage END,
    memory_summary = COALESCE(memory_summary, '{}'::jsonb) || '{"v4_repaired":"product_choices_not_payment"}'::jsonb,
    updated_at = NOW()
WHERE pending_choice_type = 'payment_account'
  AND jsonb_typeof(COALESCE(pending_choices, '[]'::jsonb)) = 'array'
  AND pending_choices::text LIKE '%"price"%'
  AND pending_choices::text NOT LIKE '%"account_number"%';

-- Si el stage quedó en pago pero la selección pendiente real es producto,
-- vuelve al estado correcto de selección de catálogo.
UPDATE ai_sales_conversation_state
SET current_stage = 'waiting_product_selection',
    memory_summary = COALESCE(memory_summary, '{}'::jsonb) || '{"v4_repaired":"waiting_payment_with_product_choices"}'::jsonb,
    updated_at = NOW()
WHERE current_stage = 'waiting_payment'
  AND pending_choice_type = 'product'
  AND selected_product_id IS NULL
  AND jsonb_typeof(COALESCE(pending_choices, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(pending_choices, '[]'::jsonb)) > 0;

-- Limpieza suave de memoria legacy contaminada. No borra la fila ni historial real.
UPDATE ai_sales_chat_memory
SET product_hint = NULL,
    customer_name = CASE
      WHEN lower(COALESCE(customer_name, '')) IN ('deja eso bye', 'gracias si ese mismo', 'gracias sí ese mismo') THEN NULL
      ELSE customer_name
    END,
    customer_address = CASE
      WHEN lower(COALESCE(customer_address, '')) IN ('te la envie ya', 'te la envié ya', 'ya te lo envie', 'ya te lo envié') THEN NULL
      ELSE customer_address
    END,
    last_user_intent = 'legacy_memory_neutralized_v4',
    updated_at = NOW()
WHERE COALESCE(product_hint, '') ILIKE ANY (ARRAY['%precio de envio%', '%precio envío%', '%delivery%', '%envio%'])
   OR lower(COALESCE(customer_name, '')) IN ('deja eso bye', 'gracias si ese mismo', 'gracias sí ese mismo')
   OR lower(COALESCE(customer_address, '')) IN ('te la envie ya', 'te la envié ya', 'ya te lo envie', 'ya te lo envié');

-- Limpia solo historial AI de WebChat que guardó contexto interno como si fuera mensaje de cliente.
UPDATE ai_sessions s
SET history = '[]'::jsonb,
    updated_at = NOW()
FROM chats c
WHERE c.id = s.chat_id
  AND c.remote_jid LIKE 'webchat_%@webchat.allsender'
  AND s.history::text ILIKE '%Contexto interno AllSender WebChat%';

COMMIT;
