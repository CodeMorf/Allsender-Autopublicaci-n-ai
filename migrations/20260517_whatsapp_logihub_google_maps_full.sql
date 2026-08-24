ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS google_maps_geocoding_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS google_maps_api_key TEXT;

UPDATE ai_sales_settings
SET google_maps_geocoding_enabled = TRUE
WHERE google_maps_geocoding_enabled IS NULL;

UPDATE ai_sales_orders
SET status = 'pending_logihub'
WHERE shipping_provider = 'logihub'
  AND shipping_status IN ('missing_data', 'coverage_failed')
  AND status = 'confirmed';
