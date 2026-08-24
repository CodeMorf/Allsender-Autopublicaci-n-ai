BEGIN;

ALTER TABLE IF EXISTS feed_sync_settings
  ADD COLUMN IF NOT EXISTS max_product_limit INTEGER NOT NULL DEFAULT 5000;

ALTER TABLE IF EXISTS feed_sync_settings
  ADD COLUMN IF NOT EXISTS last_stock_alerts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS feed_sync_logs
  ADD COLUMN IF NOT EXISTS stock_alert_count INTEGER NOT NULL DEFAULT 0;

UPDATE feed_sync_settings
SET max_product_limit = 5000
WHERE max_product_limit IS NULL OR max_product_limit <= 0 OR max_product_limit > 5000;

UPDATE feed_sync_settings
SET free_product_limit = 100
WHERE free_product_limit IS NULL OR free_product_limit <= 0;

CREATE TABLE IF NOT EXISTS ai_sales_stock_alerts (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES ai_sales_products(id) ON DELETE SET NULL,
  sku VARCHAR(100),
  name TEXT NOT NULL,
  category VARCHAR(120),
  image_url TEXT,
  source VARCHAR(40) NOT NULL DEFAULT 'xml_feed',
  source_url TEXT,
  source_id VARCHAR(160),
  availability VARCHAR(80),
  stock INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  note TEXT,
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_sales_stock_alerts_team_sku_idx
  ON ai_sales_stock_alerts(team_id, sku);

CREATE INDEX IF NOT EXISTS ai_sales_stock_alerts_team_id_idx
  ON ai_sales_stock_alerts(team_id);

CREATE INDEX IF NOT EXISTS ai_sales_stock_alerts_team_status_idx
  ON ai_sales_stock_alerts(team_id, status);

COMMIT;
