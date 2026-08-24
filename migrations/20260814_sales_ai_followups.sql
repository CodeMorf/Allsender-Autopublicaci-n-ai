-- Seguimiento de ventas "para luego": recordatorios programados por el agente de ventas IA.
CREATE TABLE IF NOT EXISTS ai_sales_followups (
  id BIGSERIAL PRIMARY KEY,
  team_id BIGINT NOT NULL,
  chat_id BIGINT NOT NULL,
  message TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  job_key TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_sales_followups_due ON ai_sales_followups (status, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_sales_followups_job_key ON ai_sales_followups (job_key) WHERE job_key IS NOT NULL;
