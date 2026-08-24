CREATE TABLE IF NOT EXISTS reservation_unavailable_blocks (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  resource_id BIGINT NULL,
  service_id BIGINT NULL,
  title VARCHAR(180) NOT NULL DEFAULT 'No disponible',
  reason VARCHAR(180) NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Santo_Domingo',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reservation_unavailable_blocks_team_idx
  ON reservation_unavailable_blocks(team_id, is_active, start_at, end_at);

CREATE INDEX IF NOT EXISTS reservation_unavailable_blocks_resource_idx
  ON reservation_unavailable_blocks(team_id, resource_id, start_at, end_at);
