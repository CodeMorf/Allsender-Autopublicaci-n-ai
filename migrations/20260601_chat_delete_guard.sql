-- Allsender SaaS chat hard-delete guard
-- Objetivo: cuando un usuario elimina un chat, borrar historial y evitar que webhooks/sync viejos lo creen otra vez.
-- Seguro/idempotente: se puede ejecutar varias veces.

CREATE TABLE IF NOT EXISTS public.chat_delete_guards (
  id bigserial PRIMARY KEY,
  team_id integer NOT NULL,
  instance_id integer NOT NULL DEFAULT 0,
  remote_jid text NOT NULL,
  last_message_timestamp timestamptz,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  block_until timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  reason text NOT NULL DEFAULT 'manual_delete',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_delete_guards_team_instance_jid_uidx
  ON public.chat_delete_guards (team_id, instance_id, remote_jid);

CREATE INDEX IF NOT EXISTS chat_delete_guards_lookup_idx
  ON public.chat_delete_guards (team_id, remote_jid, deleted_at DESC);
