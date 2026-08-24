ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_reason TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_by INTEGER;

UPDATE chats c
SET last_message_timestamp = latest.last_message_timestamp
FROM (
  SELECT
    m.chat_id,
    MAX(m."timestamp")::timestamp AS last_message_timestamp
  FROM messages m
  GROUP BY m.chat_id
) latest
WHERE c.id = latest.chat_id
  AND c.last_message_timestamp IS NULL;

WITH latest AS (
  SELECT
    c.id,
    COALESCE(
      c.last_customer_interaction,
      c.last_message_timestamp,
      MAX(m."timestamp")::timestamp
    ) AS activity_at
  FROM chats c
  LEFT JOIN messages m ON m.chat_id = c.id
  WHERE c.archived_at IS NULL
    AND COALESCE(c.unread_count, 0) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM contacts ct
      WHERE ct.chat_id = c.id
    )
    AND regexp_replace(split_part(c.remote_jid, '@', 1), '\\D', '', 'g') <> ''
    AND length(regexp_replace(split_part(c.remote_jid, '@', 1), '\\D', '', 'g')) >= 7
  GROUP BY c.id, c.last_customer_interaction, c.last_message_timestamp
), target AS (
  SELECT c.id
  FROM chats c
  INNER JOIN latest l ON l.id = c.id
  WHERE l.activity_at IS NOT NULL
    AND l.activity_at <= NOW() - INTERVAL '48 hours'
    AND (
      NULLIF(trim(COALESCE(c.name, '')), '') IS NULL
      OR NULLIF(trim(COALESCE(c.push_name, '')), '') IS NULL
      OR trim(COALESCE(c.name, c.push_name, '')) LIKE '%@%'
      OR regexp_replace(COALESCE(c.name, ''), '\\D', '', 'g') = regexp_replace(split_part(c.remote_jid, '@', 1), '\\D', '', 'g')
      OR regexp_replace(COALESCE(c.push_name, ''), '\\D', '', 'g') = regexp_replace(split_part(c.remote_jid, '@', 1), '\\D', '', 'g')
      OR length(regexp_replace(COALESCE(c.name, ''), '\\D', '', 'g')) BETWEEN 1 AND 4
      OR length(regexp_replace(COALESCE(c.push_name, ''), '\\D', '', 'g')) BETWEEN 1 AND 4
      OR regexp_replace(trim(COALESCE(c.name, c.push_name, '')), '[0-9\\s+()._-]', '', 'g') = ''
    )
)
UPDATE chats c
SET
  archived_at = NOW(),
  archived_reason = 'stale_number_no_crm_48h_sql_v4',
  archived_by = NULL
FROM target t
WHERE c.id = t.id;
