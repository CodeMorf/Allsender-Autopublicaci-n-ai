-- AllSender Ventas AI V15 - guard post-orden humano
-- PostgreSQL / idempotente / no elimina productos, ordenes, chats ni mensajes.

BEGIN;

-- Canoniza alias devueltos por tracking de LogiHub cuando el envio local sigue en estado editable.
-- La regla funcional se mantiene: solo created/confirmed permiten modificar o cancelar.
UPDATE ai_sales_orders
SET logihub_status = 'confirmed',
    updated_at = NOW()
WHERE COALESCE(logihub_status, '') IN ('at_branch', 'al_branch', 'branch', 'en_sucursal', 'en_agencia', 'recibido_en_sucursal', 'received_at_branch')
  AND COALESCE(shipping_status, '') IN ('created', 'confirmed')
  AND status NOT IN ('cancelled', 'canceled', 'completed', 'delivered', 'returned');

-- Limpia confirmaciones de modificacion viejas sin tocar ordenes reales.
UPDATE ai_sales_conversation_state
SET pending_choice_type = NULL,
    pending_choices = '[]'::jsonb,
    missing_data = '[]'::jsonb,
    updated_at = NOW()
WHERE pending_choice_type = 'order_modification'
  AND updated_at < NOW() - INTERVAL '10 minutes';

COMMIT;

-- Diagnostico opcional despues de aplicar:
-- SELECT id, order_number, status, shipping_status, logihub_status, shipping_tracking, logihub_tracking, total, cod_amount
-- FROM ai_sales_orders
-- WHERE status NOT IN ('cancelled', 'canceled', 'completed', 'delivered', 'returned')
-- ORDER BY id DESC
-- LIMIT 20;
