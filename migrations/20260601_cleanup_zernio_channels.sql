-- Limpieza real de canales Zernio para Allsender SaaS
-- Objetivo: que Autopublicar/Comentarios solo muestren cuentas realmente conectadas.
-- Seguro/idempotente: guarda backup JSON antes de borrar filas.

BEGIN;

CREATE TABLE IF NOT EXISTS public.zernio_connections_cleanup_backup (
  backup_id bigserial PRIMARY KEY,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  connection_id integer,
  team_id integer,
  platform text,
  zernio_account_id text,
  zernio_profile_id text,
  row_data jsonb NOT NULL
);

-- 1) Sacar de forma definitiva conexiones que ya no están conectadas.
WITH candidates AS (
  SELECT z.*, 'status_not_connected'::text AS reason
  FROM public.zernio_connections z
  WHERE LOWER(COALESCE(z.status, '')) <> 'connected'
), backup AS (
  INSERT INTO public.zernio_connections_cleanup_backup
    (reason, connection_id, team_id, platform, zernio_account_id, zernio_profile_id, row_data)
  SELECT reason, id, team_id, platform, zernio_account_id, zernio_profile_id, to_jsonb(candidates)
  FROM candidates
  ON CONFLICT DO NOTHING
  RETURNING connection_id
)
DELETE FROM public.zernio_connections z
WHERE z.id IN (SELECT id FROM candidates);

-- 2) Una conexión sin account_id no es una cuenta usable para publicar/comentar.
WITH candidates AS (
  SELECT z.*, 'connected_without_account_id'::text AS reason
  FROM public.zernio_connections z
  WHERE LOWER(COALESCE(z.status, '')) = 'connected'
    AND NULLIF(z.zernio_account_id, '') IS NULL
), backup AS (
  INSERT INTO public.zernio_connections_cleanup_backup
    (reason, connection_id, team_id, platform, zernio_account_id, zernio_profile_id, row_data)
  SELECT reason, id, team_id, platform, zernio_account_id, zernio_profile_id, to_jsonb(candidates)
  FROM candidates
  ON CONFLICT DO NOTHING
  RETURNING connection_id
)
DELETE FROM public.zernio_connections z
WHERE z.id IN (SELECT id FROM candidates);

-- 3) Si Zernio envió account.disconnected y no hay un account.connected posterior,
--    eliminar la conexión local para que no vuelva a aparecer.
WITH disconnects AS (
  SELECT
    LOWER(COALESCE(payload #>> '{account,platform}', payload #>> '{platform}', '')) AS platform,
    COALESCE(zernio_account_id, payload #>> '{account,accountId}', payload #>> '{account,id}') AS account_id,
    COALESCE(zernio_profile_id, payload #>> '{account,profileId}', payload #>> '{profileId}') AS profile_id,
    MAX(created_at) AS disconnected_at
  FROM public.zernio_webhook_logs
  WHERE event_type = 'account.disconnected'
  GROUP BY 1,2,3
), candidates AS (
  SELECT z.*, 'account_disconnected_event'::text AS reason
  FROM public.zernio_connections z
  JOIN disconnects d
    ON d.account_id = z.zernio_account_id
   AND d.profile_id = z.zernio_profile_id
   AND d.platform = LOWER(z.platform)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.zernio_webhook_logs c
    WHERE c.event_type = 'account.connected'
      AND COALESCE(c.zernio_account_id, c.payload #>> '{account,accountId}', c.payload #>> '{account,id}') = z.zernio_account_id
      AND COALESCE(c.zernio_profile_id, c.payload #>> '{account,profileId}', c.payload #>> '{profileId}') = z.zernio_profile_id
      AND LOWER(COALESCE(c.payload #>> '{account,platform}', c.payload #>> '{platform}', '')) = LOWER(z.platform)
      AND c.created_at > d.disconnected_at
  )
), backup AS (
  INSERT INTO public.zernio_connections_cleanup_backup
    (reason, connection_id, team_id, platform, zernio_account_id, zernio_profile_id, row_data)
  SELECT reason, id, team_id, platform, zernio_account_id, zernio_profile_id, to_jsonb(candidates)
  FROM candidates
  ON CONFLICT DO NOTHING
  RETURNING connection_id
)
DELETE FROM public.zernio_connections z
WHERE z.id IN (SELECT id FROM candidates);

-- 4) Deduplicar cuentas conectadas: mismo team + plataforma + account_id debe aparecer una sola vez.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY team_id, LOWER(platform), zernio_account_id
      ORDER BY updated_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.zernio_connections
  WHERE LOWER(COALESCE(status, '')) = 'connected'
    AND NULLIF(zernio_account_id, '') IS NOT NULL
), candidates AS (
  SELECT z.*, 'duplicate_connected_account'::text AS reason
  FROM public.zernio_connections z
  JOIN ranked r ON r.id = z.id
  WHERE r.rn > 1
), backup AS (
  INSERT INTO public.zernio_connections_cleanup_backup
    (reason, connection_id, team_id, platform, zernio_account_id, zernio_profile_id, row_data)
  SELECT reason, id, team_id, platform, zernio_account_id, zernio_profile_id, to_jsonb(candidates)
  FROM candidates
  ON CONFLICT DO NOTHING
  RETURNING connection_id
)
DELETE FROM public.zernio_connections z
WHERE z.id IN (SELECT id FROM candidates);

-- 5) Limpiar instancias Zernio huérfanas que no tienen chats ni conexión.
DELETE FROM public.evolution_instances ei
WHERE ei.integration ILIKE 'ZERNIO-%'
  AND NOT EXISTS (SELECT 1 FROM public.zernio_connections z WHERE z.local_instance_id = ei.id)
  AND NOT EXISTS (SELECT 1 FROM public.chats c WHERE c.instance_id = ei.id);

COMMIT;

-- Verificación después de importar:
SELECT team_id, platform, status, zernio_account_id, account_display_name, COUNT(*) AS qty
FROM public.zernio_connections
GROUP BY team_id, platform, status, zernio_account_id, account_display_name
ORDER BY team_id, platform, account_display_name;
