-- 20260805_sales_ai_variant_columns.sql
-- Aditivo / retrocompatible: agrega columnas de variante (talla/color) a los items de orden de Venta AI.
-- No modifica ai_sales_orders (ya tiene customer/location). No toca órdenes existentes.
-- Rollback: ejecutar los ALTER ... DROP COLUMN de abajo.

BEGIN;

ALTER TABLE ai_sales_order_items
  ADD COLUMN IF NOT EXISTS variant_id    INTEGER,
  ADD COLUMN IF NOT EXISTS variant_sku   TEXT,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS variant_meta  JSONB;

-- Índice opcional para búsquedas por sku de variante (útil al validar stock por talla).
CREATE INDEX IF NOT EXISTS idx_ai_sales_order_items_variant_sku
  ON ai_sales_order_items (variant_sku);

COMMIT;

-- === ROLLBACK (si desperfecto) ===
-- ALTER TABLE ai_sales_order_items DROP COLUMN IF EXISTS variant_meta;
-- ALTER TABLE ai_sales_order_items DROP COLUMN IF EXISTS variant_label;
-- ALTER TABLE ai_sales_order_items DROP COLUMN IF EXISTS variant_sku;
-- ALTER TABLE ai_sales_order_items DROP COLUMN IF EXISTS variant_id;
-- DROP INDEX IF EXISTS idx_ai_sales_order_items_variant_sku;
