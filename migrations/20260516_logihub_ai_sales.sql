ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_logihub_quote_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_logihub_create_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS business_description TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS sales_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS delivery_additional_item_fee NUMERIC(12,2) NOT NULL DEFAULT 5.00;
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_quote_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_create_shipment_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_delivery_mode VARCHAR(20) NOT NULL DEFAULT 'central';
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_service_type VARCHAR(30) NOT NULL DEFAULT 'standard';
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_default_weight_lb NUMERIC(10,2) NOT NULL DEFAULT 2.50;
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_default_content TEXT NOT NULL DEFAULT 'Productos';
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_sender_address TEXT;
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_sender_lat NUMERIC(11,7);
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_sender_lng NUMERIC(11,7);
ALTER TABLE ai_sales_settings ADD COLUMN IF NOT EXISTS logihub_is_pickup BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ai_sales_settings
SET default_delivery_fee = 285.00
WHERE default_delivery_fee IS NULL OR default_delivery_fee = 0;

ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS dest_province TEXT;
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS dest_city TEXT;
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS dest_barrio TEXT;
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS receiver_lat NUMERIC(11,7);
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS receiver_lng NUMERIC(11,7);
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS shipping_provider VARCHAR(40);
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS shipping_mode VARCHAR(20);
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS shipping_tracking VARCHAR(80);
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS shipping_status VARCHAR(40);
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS logihub_payload JSONB;
ALTER TABLE ai_sales_orders ADD COLUMN IF NOT EXISTS logihub_response JSONB;

CREATE INDEX IF NOT EXISTS ai_sales_orders_shipping_tracking_idx ON ai_sales_orders(shipping_tracking);
