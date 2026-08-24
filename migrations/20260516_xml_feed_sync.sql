CREATE TABLE IF NOT EXISTS feed_sync_settings (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    feed_name VARCHAR(160) NOT NULL DEFAULT 'XML / Feed Sync',
    feed_url TEXT,
    feed_type VARCHAR(40) NOT NULL DEFAULT 'google_merchant',
    sync_mode VARCHAR(40) NOT NULL DEFAULT 'upsert',
    free_product_limit INTEGER NOT NULL DEFAULT 100,
    additional_product_fee NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency VARCHAR(3) NOT NULL DEFAULT 'DOP',
    last_status VARCHAR(40),
    last_message TEXT,
    last_sync_at TIMESTAMP,
    last_total_found INTEGER NOT NULL DEFAULT 0,
    last_imported INTEGER NOT NULL DEFAULT 0,
    last_skipped INTEGER NOT NULL DEFAULT 0,
    last_over_limit INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS feed_sync_settings_team_id_idx ON feed_sync_settings(team_id);
CREATE INDEX IF NOT EXISTS feed_sync_settings_team_id_lookup_idx ON feed_sync_settings(team_id);

CREATE TABLE IF NOT EXISTS feed_sync_logs (
    id SERIAL PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    settings_id INTEGER REFERENCES feed_sync_settings(id) ON DELETE SET NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    feed_url TEXT,
    total_found INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    over_limit_count INTEGER NOT NULL DEFAULT 0,
    message TEXT,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feed_sync_logs_team_id_idx ON feed_sync_logs(team_id);
CREATE INDEX IF NOT EXISTS feed_sync_logs_settings_id_idx ON feed_sync_logs(settings_id);

INSERT INTO feed_sync_settings (team_id)
SELECT id FROM teams
ON CONFLICT (team_id) DO NOTHING;
