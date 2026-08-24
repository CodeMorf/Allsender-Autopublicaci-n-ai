-- Allsender Zernio universal channels + prices 0
-- Importar en PostgreSQL / phpPgAdmin / psql antes del build.
-- No guarda API keys. La key Zernio va en .env como ZERNIO_API_KEY.

BEGIN;

CREATE TABLE IF NOT EXISTS zernio_connections (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
  local_instance_id INTEGER NULL REFERENCES evolution_instances(id) ON DELETE SET NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'zernio',
  platform VARCHAR(50) NOT NULL,
  module_key VARCHAR(80) NOT NULL,
  zernio_profile_id VARCHAR(150) NOT NULL,
  zernio_account_id VARCHAR(150) NULL,
  account_username VARCHAR(150) NULL,
  account_display_name VARCHAR(200) NULL,
  account_picture TEXT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  last_error TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zernio_connections_team ON zernio_connections(team_id);
CREATE INDEX IF NOT EXISTS idx_zernio_connections_account ON zernio_connections(zernio_account_id);
CREATE INDEX IF NOT EXISTS idx_zernio_connections_profile ON zernio_connections(zernio_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS zernio_connections_team_local_instance_idx ON zernio_connections(team_id, local_instance_id);

CREATE TABLE IF NOT EXISTS zernio_webhook_logs (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NULL,
  zernio_account_id VARCHAR(150) NULL,
  zernio_profile_id VARCHAR(150) NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zernio_webhook_logs_account ON zernio_webhook_logs(zernio_account_id);
CREATE INDEX IF NOT EXISTS idx_zernio_webhook_logs_profile ON zernio_webhook_logs(zernio_profile_id);

-- Catálogo de canales: precio del módulo en 0. El precio real lo gestionas en admin/canales.
INSERT INTO allsender_channel_modules
(module_key, name, description, channel_type, provider, price_cents, currency, trial_days, is_enabled, sort_order, metadata, created_at, updated_at)
VALUES
('web_chat', 'Web Chat', 'Chat web nativo de AllSender para sitios del cliente.', 'web', 'internal', 0, 'usd', 0, true, 10, '{}'::jsonb, NOW(), NOW()),
('instagram_dm', 'Instagram DM Meta directo', 'Instagram directo con Meta. Se conserva para no romper integración existente.', 'instagram', 'meta', 0, 'usd', 0, true, 20, '{}'::jsonb, NOW(), NOW()),
('facebook_messenger', 'Facebook Messenger Meta directo', 'Facebook Messenger directo con Meta. Se conserva para no romper integración existente.', 'facebook', 'meta', 0, 'usd', 0, true, 30, '{}'::jsonb, NOW(), NOW()),
('email', 'Email Inbox', 'Bandeja de correo como canal de soporte/ventas.', 'email', 'chatwoot', 0, 'usd', 0, true, 40, '{}'::jsonb, NOW(), NOW()),
('sms', 'SMS', 'SMS mediante proveedor externo compatible.', 'sms', 'external', 0, 'usd', 0, true, 50, '{}'::jsonb, NOW(), NOW()),
('tiktok_dm', 'TikTok DM manual/proveedor', 'TikTok Business con API/partner aprobado.', 'tiktok', 'external', 0, 'usd', 0, true, 60, '{}'::jsonb, NOW(), NOW()),
('whatsapp_evolution', 'WhatsApp Evolution / Meta WABA', 'WhatsApp QR Evolution y Meta WABA directo actual.', 'whatsapp', 'evolution', 0, 'usd', 0, true, 70, '{}'::jsonb, NOW(), NOW()),
('zernio_instagram', 'Instagram Zernio', 'Instagram automático vía Zernio por instancia del cliente.', 'instagram', 'zernio', 0, 'usd', 0, true, 100, '{"dm":true}'::jsonb, NOW(), NOW()),
('zernio_facebook', 'Facebook Zernio', 'Facebook vía Zernio por instancia del cliente.', 'facebook', 'zernio', 0, 'usd', 0, true, 110, '{"dm":true}'::jsonb, NOW(), NOW()),
('zernio_telegram', 'Telegram Zernio', 'Telegram vía Zernio por instancia del cliente.', 'telegram', 'zernio', 0, 'usd', 0, true, 120, '{"dm":true}'::jsonb, NOW(), NOW()),
('zernio_twitter', 'Twitter/X Zernio', 'Twitter/X vía Zernio, sujeto a límites del proveedor.', 'twitter', 'zernio', 0, 'usd', 0, true, 130, '{"dm":true,"limited":true}'::jsonb, NOW(), NOW()),
('zernio_bluesky', 'Bluesky Zernio', 'Bluesky vía Zernio por instancia del cliente.', 'bluesky', 'zernio', 0, 'usd', 0, true, 140, '{"dm":true}'::jsonb, NOW(), NOW()),
('zernio_reddit', 'Reddit Zernio', 'Reddit vía Zernio para inbox/comentarios.', 'reddit', 'zernio', 0, 'usd', 0, true, 150, '{"dm":true,"comments":true}'::jsonb, NOW(), NOW()),
('zernio_tiktok', 'TikTok Zernio', 'TikTok vía Zernio. Requiere Business/API/partner según disponibilidad.', 'tiktok', 'zernio', 0, 'usd', 0, true, 160, '{"requires_approval":true}'::jsonb, NOW(), NOW()),
('zernio_linkedin', 'LinkedIn Zernio', 'LinkedIn vía Zernio para gestión social según soporte.', 'linkedin', 'zernio', 0, 'usd', 0, true, 170, '{}'::jsonb, NOW(), NOW()),
('zernio_youtube', 'YouTube Zernio', 'YouTube vía Zernio para comentarios/gestión según soporte.', 'youtube', 'zernio', 0, 'usd', 0, true, 180, '{"comments":true}'::jsonb, NOW(), NOW()),
('zernio_threads', 'Threads Zernio', 'Threads vía Zernio según soporte.', 'threads', 'zernio', 0, 'usd', 0, true, 190, '{}'::jsonb, NOW(), NOW()),
('zernio_pinterest', 'Pinterest Zernio', 'Pinterest vía Zernio según soporte.', 'pinterest', 'zernio', 0, 'usd', 0, true, 200, '{}'::jsonb, NOW(), NOW()),
('zernio_googlebusiness', 'Google Business Zernio', 'Google Business vía Zernio para reviews/gestión.', 'googlebusiness', 'zernio', 0, 'usd', 0, true, 210, '{"reviews":true}'::jsonb, NOW(), NOW()),
('zernio_snapchat', 'Snapchat Zernio', 'Snapchat vía Zernio según soporte.', 'snapchat', 'zernio', 0, 'usd', 0, true, 220, '{}'::jsonb, NOW(), NOW()),
('zernio_discord', 'Discord Zernio', 'Discord vía Zernio según soporte.', 'discord', 'zernio', 0, 'usd', 0, true, 230, '{}'::jsonb, NOW(), NOW()),
('zernio_whatsapp', 'WhatsApp Zernio', 'WhatsApp vía Zernio opcional; no reemplaza Evolution ni Meta WABA.', 'whatsapp', 'zernio', 0, 'usd', 0, true, 240, '{"optional":true}'::jsonb, NOW(), NOW())
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  channel_type = EXCLUDED.channel_type,
  provider = EXCLUDED.provider,
  price_cents = 0,
  currency = 'usd',
  trial_days = 0,
  is_enabled = true,
  sort_order = EXCLUDED.sort_order,
  metadata = COALESCE(allsender_channel_modules.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

UPDATE allsender_channel_modules
SET price_cents = 0,
    trial_days = 0,
    currency = 'usd',
    updated_at = NOW();

-- Si existe tabla de módulos generales, dejar precio base en 0 también.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'saas_modules')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'saas_modules' AND column_name = 'base_price_amount') THEN
    EXECUTE 'UPDATE saas_modules SET base_price_amount = 0';
  END IF;
END $$;

COMMIT;
