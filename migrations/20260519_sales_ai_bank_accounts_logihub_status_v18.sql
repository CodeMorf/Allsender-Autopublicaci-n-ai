-- AllSender Ventas IA V18 - cuentas bancarias en modulo nuevo + sincronizacion LogiHub
-- PostgreSQL / idempotente / no elimina datos.

BEGIN;

ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS payment_accounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS payment_instructions text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS payment_discount_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_discount_type varchar(20) NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS payment_discount_value numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_discount_applies_to varchar(40) NOT NULL DEFAULT 'transfer';

ALTER TABLE ai_sales_orders
  ADD COLUMN IF NOT EXISTS logihub_tracking varchar(80),
  ADD COLUMN IF NOT EXISTS logihub_status varchar(60),
  ADD COLUMN IF NOT EXISTS logihub_label_url text,
  ADD COLUMN IF NOT EXISTS logihub_error text,
  ADD COLUMN IF NOT EXISTS logihub_payload_json jsonb,
  ADD COLUMN IF NOT EXISTS logihub_response_json jsonb;

CREATE INDEX IF NOT EXISTS idx_ai_sales_orders_logihub_tracking ON ai_sales_orders (logihub_tracking);
CREATE INDEX IF NOT EXISTS idx_ai_sales_orders_logihub_status ON ai_sales_orders (logihub_status);

UPDATE ai_sales_orders
SET logihub_tracking = shipping_tracking,
    updated_at = NOW()
WHERE COALESCE(logihub_tracking, '') = ''
  AND COALESCE(shipping_tracking, '') <> '';

UPDATE ai_sales_orders
SET logihub_status = CASE
      WHEN COALESCE(logihub_status, shipping_status, status, '') IN ('creado') THEN 'created'
      WHEN COALESCE(logihub_status, shipping_status, status, '') IN ('confirmado', 'at_branch', 'al_branch', 'branch', 'en_sucursal', 'en_agencia', 'recibido_en_sucursal', 'received_at_branch') THEN 'confirmed'
      WHEN COALESCE(logihub_status, shipping_status, status, '') IN ('en_transito', 'en_tránsito', 'transito', 'tránsito', 'intransit', 'in_route', 'on_route', 'out_for_delivery', 'picked_up', 'dispatch', 'dispatched') THEN 'in_transit'
      WHEN COALESCE(logihub_status, shipping_status, status, '') IN ('entregado') THEN 'delivered'
      WHEN COALESCE(logihub_status, shipping_status, status, '') IN ('devuelto', 'retornado') THEN 'returned'
      WHEN COALESCE(logihub_status, shipping_status, status, '') IN ('fallido') THEN 'failed'
      ELSE COALESCE(NULLIF(logihub_status, ''), NULLIF(shipping_status, ''), logihub_status)
    END,
    updated_at = NOW()
WHERE COALESCE(logihub_status, shipping_status, '') <> '';

UPDATE ai_sales_orders
SET shipping_status = logihub_status,
    status = CASE
      WHEN status IN ('cancelled', 'canceled') THEN status
      WHEN logihub_status IN ('created', 'confirmed') AND status NOT IN ('draft_ai', 'pending_payment', 'pending_review') THEN 'ready_to_dispatch'
      WHEN logihub_status = 'in_transit' THEN 'in_transit'
      WHEN logihub_status = 'delivered' THEN 'delivered'
      WHEN logihub_status = 'returned' THEN 'returned'
      WHEN logihub_status = 'failed' THEN 'failed'
      ELSE status
    END,
    updated_at = NOW()
WHERE COALESCE(logihub_status, '') IN ('created', 'confirmed', 'in_transit', 'delivered', 'returned', 'failed');

UPDATE ai_sales_settings
SET sales_instructions = TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n\n', NULLIF(sales_instructions, ''), 'Reglas de pago por transferencia: la IA debe leer payment_accounts activos desde Ventas IA, mostrar solo cuentas autorizadas, pedir comprobante y no inventar bancos, titulares ni numeros. Si no hay cuenta activa, debe decir que un asesor debe configurar la cuenta antes de recibir transferencia.')),
    updated_at = NOW()
WHERE COALESCE(sales_instructions, '') NOT ILIKE '%payment_accounts activos%';

UPDATE ai_sales_settings
SET sales_policy = TRIM(BOTH E'\n' FROM CONCAT_WS(E'\n\n', NULLIF(sales_policy, ''), 'Reglas LogiHub: al preguntar por orden/tracking, consultar LogiHub si hay API Key y tracking. Sincronizar estado de la orden con LogiHub. Solo permitir cambios/cancelacion/agregar productos si LogiHub esta created o confirmed. Si esta in_transit, delivered, returned o failed, no modificar; responder seguimiento y escalar a soporte si aplica.')),
    updated_at = NOW()
WHERE COALESCE(sales_policy, '') NOT ILIKE '%Reglas LogiHub:%';

COMMIT;

-- Diagnostico opcional:
-- SELECT id, order_number, status, shipping_status, logihub_status, shipping_tracking, logihub_tracking, updated_at
-- FROM ai_sales_orders
-- ORDER BY updated_at DESC
-- LIMIT 30;
--
-- SELECT team_id, transfer_enabled, jsonb_array_length(COALESCE(payment_accounts, '[]'::jsonb)) AS cuentas, payment_accounts
-- FROM ai_sales_settings
-- ORDER BY updated_at DESC;
