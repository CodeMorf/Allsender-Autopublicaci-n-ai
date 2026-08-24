-- Centro de Conocimiento: esquema idempotente, aplicado por el pipeline de migraciones.
ALTER TABLE ai_sales_settings
  ADD COLUMN IF NOT EXISTS training_playbook jsonb NOT NULL DEFAULT '{}'::jsonb;
