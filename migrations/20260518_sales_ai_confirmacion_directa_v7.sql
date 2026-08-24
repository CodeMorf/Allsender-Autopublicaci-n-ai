-- AllSender Ventas AI V7 - confirmacion directa y limpieza de metodo_pago
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

-- Si el cliente eligio contra entrega, metodo_pago ya no debe quedar como faltante.
UPDATE ai_sales_conversation_state s
SET pending_choice_type = NULL,
    pending_choices = '[]'::jsonb,
    payment_status = 'cod',
    missing_data = COALESCE((
      SELECT jsonb_agg(item)
      FROM jsonb_array_elements_text(COALESCE(s.missing_data, '[]'::jsonb)) AS t(item)
      WHERE item <> 'metodo_pago'
    ), '[]'::jsonb),
    current_stage = CASE
      WHEN s.selected_product_id IS NOT NULL
       AND COALESCE(s.customer_name, '') <> ''
       AND COALESCE(s.customer_phone, '') <> ''
       AND (COALESCE(s.customer_address, '') <> '' OR COALESCE(s.delivery_address_text, '') <> '' OR COALESCE(s.delivery_maps_url, '') <> '')
      THEN 'waiting_order_confirmation'
      ELSE s.current_stage
    END,
    order_draft = COALESCE(s.order_draft, '{}'::jsonb) || '{"payment_method":"cod","payment_status":"pending_cod"}'::jsonb,
    updated_at = NOW()
WHERE s.payment_status = 'cod'
   OR LOWER(COALESCE(s.last_user_message, '')) LIKE '%contra entrega%'
   OR LOWER(COALESCE(s.last_user_message, '')) LIKE '%al recibir%'
   OR LOWER(COALESCE(s.last_user_message, '')) LIKE '%cod%';

-- Si ya tiene todos los datos principales, no debe volver a pedir confirmacion varias veces por missing_data viejo.
UPDATE ai_sales_conversation_state s
SET missing_data = '[]'::jsonb,
    current_stage = 'waiting_order_confirmation',
    pending_choice_type = NULL,
    pending_choices = '[]'::jsonb,
    updated_at = NOW()
WHERE s.selected_product_id IS NOT NULL
  AND COALESCE(s.customer_name, '') <> ''
  AND COALESCE(s.customer_phone, '') <> ''
  AND (COALESCE(s.customer_address, '') <> '' OR COALESCE(s.delivery_address_text, '') <> '' OR COALESCE(s.delivery_maps_url, '') <> '')
  AND COALESCE(s.payment_status, 'none') NOT IN ('none', '')
  AND COALESCE(s.missing_data, '[]'::jsonb) <> '[]'::jsonb;

-- La memoria libre queda como auxiliar, no como fuente de verdad de producto/datos.
UPDATE ai_sales_chat_memory
SET product_hint = NULL,
    last_user_intent = COALESCE(last_user_intent, 'legacy_memory_neutralized'),
    updated_at = NOW()
WHERE product_hint IS NOT NULL
  AND LOWER(product_hint) ~ '(envio|envío|precio|pago|transfer|contra entrega|deja|bye|direccion|dirección|ubicacion|ubicación)';
