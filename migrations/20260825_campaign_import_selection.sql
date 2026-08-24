-- Campaigns 3.0: retain explicit row exclusions in the import audit.
-- Excluded rows remain staged with row_status=EXCLUDED and are never assigned
-- to an audience, so the original file can be audited without sending them.
ALTER TABLE campaign_imports
  ADD COLUMN IF NOT EXISTS excluded_rows INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS campaign_import_rows_import_status_idx
  ON campaign_import_rows (import_id, row_status, row_number);
