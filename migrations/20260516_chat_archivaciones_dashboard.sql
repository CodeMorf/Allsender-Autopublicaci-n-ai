ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS archived_at timestamp without time zone,
  ADD COLUMN IF NOT EXISTS archived_reason text,
  ADD COLUMN IF NOT EXISTS archived_by integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chats_archived_by_users_id_fk'
  ) THEN
    ALTER TABLE public.chats
      ADD CONSTRAINT chats_archived_by_users_id_fk
      FOREIGN KEY (archived_by)
      REFERENCES public.users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS chats_team_archived_at_idx
  ON public.chats(team_id, archived_at);

CREATE INDEX IF NOT EXISTS chats_team_last_message_archived_idx
  ON public.chats(team_id, last_message_timestamp)
  WHERE archived_at IS NULL;
