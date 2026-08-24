CREATE TABLE IF NOT EXISTS ai_sales_tool_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  status VARCHAR(20) NOT NULL CHECK (status IN ('in_flight', 'complete')),
  result_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_sales_tool_idempotency_updated_at_idx
  ON ai_sales_tool_idempotency (updated_at);

-- Rollback (manual, only after confirming no runtime writes use this table):
-- DROP INDEX IF EXISTS ai_sales_tool_idempotency_updated_at_idx;
-- DROP TABLE IF EXISTS ai_sales_tool_idempotency;
