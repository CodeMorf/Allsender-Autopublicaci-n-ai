BEGIN;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS is_ai_sales_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE plans
SET is_ai_sales_enabled = TRUE,
    updated_at = NOW()
WHERE is_ai_enabled = TRUE
  AND is_ai_sales_enabled = FALSE;

UPDATE ai_sales_settings
SET agent_name = 'AllSender IA Ventas',
    default_delivery_fee = COALESCE(NULLIF(default_delivery_fee, 0), 285.00),
    delivery_additional_item_fee = COALESCE(NULLIF(delivery_additional_item_fee, 0), 5.00),
    sales_policy = CASE
      WHEN sales_policy IS NULL OR btrim(sales_policy) = '' THEN 'La IA debe vender por pasos: mostrar opciones, confirmar producto y cantidad, pedir nombre, telefono, direccion completa, provincia, ciudad, sector y ubicacion si aplica. Antes de dar total final debe validar delivery/cobertura cuando LogiHub este activo. Solo crea orden cuando el cliente confirme claramente.'
      ELSE sales_policy
    END,
    updated_at = NOW();

COMMIT;
