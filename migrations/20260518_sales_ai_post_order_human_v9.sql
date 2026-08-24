-- AllSender Ventas AI V9 - Post-orden humano y modificación segura
-- PostgreSQL / idempotente / no elimina productos, órdenes, chats ni mensajes.

BEGIN;

ALTER TABLE ai_sales_conversation_state
  ADD COLUMN IF NOT EXISTS pending_choice_type character varying(80),
  ADD COLUMN IF NOT EXISTS pending_choices jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS order_draft jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS delivery_lat numeric(11,7),
  ADD COLUMN IF NOT EXISTS delivery_lng numeric(11,7),
  ADD COLUMN IF NOT EXISTS delivery_address_text text,
  ADD COLUMN IF NOT EXISTS delivery_maps_url text;

CREATE INDEX IF NOT EXISTS idx_ai_sales_order_items_order_team
  ON ai_sales_order_items (team_id, order_id);

CREATE INDEX IF NOT EXISTS idx_ai_sales_orders_chat_active
  ON ai_sales_orders (team_id, chat_id, status, id);

-- Si quedó una confirmación de modificación vieja o una opción bancaria pegada en una selección de producto,
-- la limpiamos sin tocar órdenes reales.
UPDATE ai_sales_conversation_state
SET pending_choice_type = NULL,
    pending_choices = '[]'::jsonb,
    updated_at = NOW()
WHERE pending_choice_type IN ('payment_account', 'order_modification')
  AND current_stage IN ('waiting_product_selection', 'product_options_sent', 'new_conversation');

-- Mantener memoria libre como legacy: no se borra, pero se limpian valores claramente conversacionales.
UPDATE ai_sales_chat_memory
SET product_hint = NULL,
    last_user_intent = CASE WHEN last_user_intent IS NULL THEN 'legacy_memory_neutralized_v9' ELSE last_user_intent END,
    updated_at = NOW()
WHERE product_hint IS NOT NULL
  AND lower(product_hint) ~ '(precio|envio|envío|deja|bye|hola|gracias|transferencia|contra entrega|ubicacion|ubicación|direccion|dirección)';

COMMIT;
