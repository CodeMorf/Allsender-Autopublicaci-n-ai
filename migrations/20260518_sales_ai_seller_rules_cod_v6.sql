-- AllSender Ventas AI V6 - instrucciones del vendedor + COD real
-- PostgreSQL. Idempotente. No borra productos, ordenes, chats ni mensajes.

ALTER TABLE ai_sales_conversation_state
  ADD COLUMN IF NOT EXISTS pending_choice_type varchar(60),
  ADD COLUMN IF NOT EXISTS pending_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS order_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_lat numeric(12,8),
  ADD COLUMN IF NOT EXISTS delivery_lng numeric(12,8),
  ADD COLUMN IF NOT EXISTS delivery_address_text text,
  ADD COLUMN IF NOT EXISTS delivery_maps_url text;

CREATE INDEX IF NOT EXISTS ai_sales_conversation_state_pending_choice_idx
  ON ai_sales_conversation_state(team_id, chat_id, pending_choice_type);

-- Evita que un estado viejo de cuentas bancarias quede activo si el cliente ya pidio contra entrega.
UPDATE ai_sales_conversation_state
SET pending_choice_type = NULL,
    pending_choices = '[]'::jsonb,
    payment_status = 'cod',
    order_draft = COALESCE(order_draft, '{}'::jsonb) || '{"payment_method":"cod","payment_status":"pending_cod"}'::jsonb,
    updated_at = NOW()
WHERE payment_status = 'cod'
   OR LOWER(COALESCE(last_user_message, '')) LIKE '%contra entrega%'
   OR LOWER(COALESCE(last_user_message, '')) LIKE '%al recibir%'
   OR LOWER(COALESCE(last_user_message, '')) LIKE '%cod%';

-- La memoria libre queda como auxiliar, no como fuente de verdad de producto/datos.
UPDATE ai_sales_chat_memory
SET product_hint = NULL,
    last_user_intent = COALESCE(last_user_intent, 'legacy_memory_neutralized'),
    updated_at = NOW()
WHERE product_hint IS NOT NULL
  AND LOWER(product_hint) ~ '(envio|envío|precio|pago|transfer|contra entrega|deja|bye|direccion|dirección|ubicacion|ubicación)';
