BEGIN;

CREATE TABLE IF NOT EXISTS automations (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  instance_id INTEGER,
  trigger_keyword VARCHAR(100),
  nodes JSONB NOT NULL DEFAULT '[]'::jsonb,
  edges JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS automations_team_idx ON automations(team_id);
CREATE INDEX IF NOT EXISTS automations_team_active_idx ON automations(team_id, is_active);

CREATE TABLE IF NOT EXISTS ai_automation_runtime_guards (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode VARCHAR(40) NOT NULL DEFAULT 'sales_ai_safe',
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_automation_runtime_guards_team_idx ON ai_automation_runtime_guards(team_id);

COMMIT;
