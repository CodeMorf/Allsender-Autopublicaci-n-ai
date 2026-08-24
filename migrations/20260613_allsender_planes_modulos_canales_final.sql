-- AllSender: planes, módulos, canales y pruebas de 3 días
-- Aplicar desde PostgreSQL/psql. No muestra mensajes técnicos al cliente; solo prepara control SaaS interno.
BEGIN;

CREATE TABLE IF NOT EXISTS plan_channel_entitlements (
  id BIGSERIAL PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  module_key VARCHAR(80) NOT NULL REFERENCES allsender_channel_modules(module_key) ON DELETE CASCADE,
  is_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(plan_id, module_key)
);


INSERT INTO saas_modules (code, name, description, base_price_amount, currency, trial_days, is_available, created_at, updated_at)
VALUES
  ('api_docs', 'Docs API', 'Documentación API disponible para el cliente. El uso avanzado de API y webhooks se controla por plan.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('departments', 'Departamentos', 'Crea áreas como Administración o Soporte, asigna miembros del equipo y organiza conversaciones por departamento.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('reservas_ia', 'Calendario / Citas', 'Agenda, reservas, servicios, recursos, link público, conexión con calendario y automatizaciones de recordatorio.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('omnichannel_channels', 'Centro de canales', 'Habilita el área Canales. Cada canal se controla de forma individual por plan para evitar abrir conectores no incluidos.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('comentarios-ia', 'Comentarios IA', 'Módulo para responder comentarios automáticamente con WhatsApp, productos o IA inteligente usando cuentas conectadas.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('autopublicar', 'Autopublicar', 'Módulo separado para crear, programar y publicar contenido en redes sociales usando cuentas conectadas.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('marketing_ia', 'Marketing IA', 'Generación inteligente de campañas, textos comerciales y propuestas persuasivas basadas en catálogo e interacciones.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('links_cortos', 'Links Cortos', 'Creador de enlaces medibles para campañas, productos, reservas y conversaciones rápidas.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('ventas_ia', 'Ventas IA / Vendor AI', 'Motor transaccional para catálogo, selección de producto, órdenes, pagos, tracking y postventa.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('productos_ordenes', 'Productos y Órdenes', 'Catálogo operativo, stock, precios, órdenes y reglas comerciales utilizadas por Ventas IA.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('stock_alerta', 'Stock alerta', 'Monitoreo de inventario para evitar recomendaciones sin disponibilidad y alertar productos críticos.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('xml_feed', 'XML / Feed', 'Sincronizador de catálogos externos compatible con Meta, Google Merchant y feeds de ecommerce.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('whatsapp_warmer', 'Calentador WhatsApp', 'Diagnóstico de salud operativa, buenas prácticas y nivel de riesgo por conexión WhatsApp.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('autoreparacion_ia', 'Autoreparación IA', 'Recupera flujos de ventas y conversaciones trabadas sin borrar historial, productos ni órdenes.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('api_publica', 'API pública avanzada', 'Uso avanzado de API para integraciones externas, sistemas propios y automatizaciones personalizadas.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('webhooks', 'Webhooks avanzados', 'Eventos salientes para conectar AllSender con sistemas externos, CRMs, pagos y operaciones.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('payments', 'Pagos del negocio', 'Métodos de pago autorizados, links de pago, confirmación de orden y reglas de cobro.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('tracking', 'Tracking y postventa', 'Consulta de tracking, seguimiento de despacho, postorden y soporte al comprador final.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('reportes_avanzados', 'Reportes avanzados', 'Métricas de conversión, tiempos de respuesta, rendimiento de campañas y actividad del equipo.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('paypal', 'PayPal', 'Módulo SaaS separado para pagos PayPal por equipo, administrado solo desde Super Admin.', 0.00, 'USD', 3, TRUE, NOW(), NOW())
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price_amount = EXCLUDED.base_price_amount,
  currency = EXCLUDED.currency,
  trial_days = 3,
  is_available = TRUE,
  updated_at = NOW();


INSERT INTO allsender_channel_modules (module_key, name, description, channel_type, provider, price_cents, currency, trial_days, is_enabled, sort_order, metadata, created_at, updated_at)
VALUES
  ('web_chat', 'Web Chat', 'Chat web nativo de AllSender para sitios del cliente. No usa Chatwoot; las conversaciones entran directo al módulo Chat.', 'web', 'internal', 0, 'usd', 3, TRUE, 10, jsonb_build_object('plan_hint', 'Incluido según plan', 'status_hint', 'Proveedor interno AllSender'), NOW(), NOW()),
  ('instagram_dm', 'Instagram DM Meta directo', 'Mensajes directos de Instagram Business/Creator usando Meta directo. Se conserva para no romper la integración actual.', 'instagram', 'meta', 0, 'usd', 3, TRUE, 20, jsonb_build_object('plan_hint', 'Incluido desde Plan Emprendedor', 'status_hint', 'Meta directo existente'), NOW(), NOW()),
  ('facebook_messenger', 'Facebook Messenger Meta directo', 'Messenger de páginas de Facebook con conexión directa a Meta. Se conserva para no romper lo ya probado.', 'facebook', 'meta', 0, 'usd', 3, TRUE, 30, jsonb_build_object('plan_hint', 'Incluido desde Plan Emprendedor', 'status_hint', 'Meta directo existente'), NOW(), NOW()),
  ('email', 'Email Inbox', 'Bandeja de correo del cliente como canal de soporte y ventas dentro del CRM.', 'email', 'chatwoot', 500, 'usd', 3, TRUE, 40, jsonb_build_object('plan_hint', 'US$5.00/mes o incluido en Pro', 'status_hint', 'Configurable por inbox'), NOW(), NOW()),
  ('sms', 'SMS Gateway', 'Envía y recibe SMS usando un teléfono Android conectado con SIM local. Compatible con proveedor local, dual SIM y marketing SMS.', 'sms', 'allsender_gateway', 1200, 'usd', 3, TRUE, 50, jsonb_build_object('plan_hint', 'US$12.00/mes por teléfono conectado', 'status_hint', 'Requiere app Android con SIM activa'), NOW(), NOW()),
  ('tiktok_dm', 'TikTok DM manual/proveedor', 'Canal para TikTok Business cuando exista API/partner aprobado. Para Zernio usar TikTok Zernio.', 'tiktok', 'external', 1000, 'usd', 3, TRUE, 60, jsonb_build_object('plan_hint', 'US$10.00/mes o incluido en Pro', 'status_hint', 'Requiere proveedor aprobado'), NOW(), NOW()),
  ('whatsapp_evolution', 'WhatsApp Evolution / Meta WABA', 'WhatsApp actual del sistema usando Evolution para QR y Meta directo para WABA. Su conexión se gestiona en /settings/connect.', 'whatsapp', 'evolution', 0, 'usd', 3, TRUE, 70, jsonb_build_object('plan_hint', 'Incluido en todos los planes', 'status_hint', 'Conectar en /settings/connect'), NOW(), NOW()),
  ('whatsapp_business_api_pro', 'WhatsApp Business API Pro', 'Números WhatsApp Pro para comprar, validar, activar llamadas, usar inbox, plantillas, flows, campañas y Vendor AI sin tocar WhatsApp QR ni WABA actual.', 'whatsapp', 'zernio_whatsapp_pro', 1200, 'usd', 3, TRUE, 80, jsonb_build_object('plan_hint', 'Disponible desde Plan Empresa API', 'status_hint', 'Números WhatsApp Pro'), NOW(), NOW()),
  ('zernio_instagram', 'Instagram Zernio', 'Instagram automático vía Zernio. Cada cliente conecta su propia cuenta/instancia y entra al chat AllSender.', 'instagram', 'zernio', 600, 'usd', 3, TRUE, 100, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'DM/inbox según soporte Zernio'), NOW(), NOW()),
  ('zernio_facebook', 'Facebook Zernio', 'Facebook vía Zernio para inbox y gestión social según soporte del proveedor.', 'facebook', 'zernio', 600, 'usd', 3, TRUE, 110, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'DM/inbox según soporte Zernio'), NOW(), NOW()),
  ('zernio_telegram', 'Telegram Zernio', 'Telegram vía Zernio. Usa código de conexión del bot y luego entra al chat cuando Zernio entregue inbox.', 'telegram', 'zernio', 600, 'usd', 3, TRUE, 120, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Código Zernio / Bot Telegram'), NOW(), NOW()),
  ('zernio_twitter', 'Twitter/X Zernio', 'Twitter/X vía Zernio. DM sujeto a permisos y limitaciones del proveedor/plataforma.', 'twitter', 'zernio', 600, 'usd', 3, TRUE, 130, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Limitado por X/Twitter'), NOW(), NOW()),
  ('zernio_bluesky', 'Bluesky Zernio', 'Bluesky vía Zernio para inbox y social según soporte.', 'bluesky', 'zernio', 600, 'usd', 3, TRUE, 140, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'DM/inbox según soporte Zernio'), NOW(), NOW()),
  ('zernio_reddit', 'Reddit Zernio', 'Reddit vía Zernio para inbox, comentarios y social según soporte.', 'reddit', 'zernio', 600, 'usd', 3, TRUE, 150, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'DM/comentarios según soporte'), NOW(), NOW()),
  ('zernio_tiktok', 'TikTok Zernio', 'TikTok vía Zernio. Requiere Business/API/partner según disponibilidad del proveedor.', 'tiktok', 'zernio', 600, 'usd', 3, TRUE, 160, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Requiere aprobación/soporte TikTok'), NOW(), NOW()),
  ('zernio_linkedin', 'LinkedIn Zernio', 'LinkedIn vía Zernio para gestión social, páginas y organizaciones según soporte.', 'linkedin', 'zernio', 600, 'usd', 3, TRUE, 170, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Social/publicación según soporte'), NOW(), NOW()),
  ('zernio_youtube', 'YouTube Zernio', 'YouTube vía Zernio para gestión social, comentarios y métricas según soporte.', 'youtube', 'zernio', 600, 'usd', 3, TRUE, 180, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Comentarios/gestión según soporte'), NOW(), NOW()),
  ('zernio_threads', 'Threads Zernio', 'Threads vía Zernio para gestión social según soporte.', 'threads', 'zernio', 600, 'usd', 3, TRUE, 190, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Social según soporte'), NOW(), NOW()),
  ('zernio_pinterest', 'Pinterest Zernio', 'Pinterest vía Zernio para boards/publicación según soporte.', 'pinterest', 'zernio', 600, 'usd', 3, TRUE, 200, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Boards/publicación según soporte'), NOW(), NOW()),
  ('zernio_googlebusiness', 'Google Business Zernio', 'Google Business Profile vía Zernio para reviews, ubicación y gestión según soporte.', 'googlebusiness', 'zernio', 600, 'usd', 3, TRUE, 210, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Reviews/gestión según soporte'), NOW(), NOW()),
  ('zernio_snapchat', 'Snapchat Zernio', 'Snapchat vía Zernio según soporte del proveedor.', 'snapchat', 'zernio', 600, 'usd', 3, TRUE, 220, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Según soporte Zernio'), NOW(), NOW()),
  ('zernio_discord', 'Discord Zernio', 'Discord vía Zernio según soporte del proveedor.', 'discord', 'zernio', 600, 'usd', 3, TRUE, 230, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Según soporte Zernio'), NOW(), NOW()),
  ('zernio_whatsapp', 'WhatsApp Zernio', 'WhatsApp vía Zernio. No reemplaza Evolution QR ni Meta WABA directo; usar solo si se activa como canal adicional.', 'whatsapp', 'zernio', 600, 'usd', 3, TRUE, 240, jsonb_build_object('plan_hint', 'US$6.00/mes por cuenta Zernio o incluido en plan superior', 'status_hint', 'Opcional / no reemplaza WhatsApp actual'), NOW(), NOW())
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  channel_type = EXCLUDED.channel_type,
  provider = EXCLUDED.provider,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  trial_days = 3,
  is_enabled = TRUE,
  sort_order = EXCLUDED.sort_order,
  metadata = COALESCE(allsender_channel_modules.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();


CREATE OR REPLACE FUNCTION allsender_upsert_final_plan(
  p_name TEXT,
  p_description TEXT,
  p_amount INTEGER,
  p_max_users INTEGER,
  p_max_contacts INTEGER,
  p_max_instances INTEGER,
  p_is_ai_enabled BOOLEAN,
  p_is_ai_sales_enabled BOOLEAN,
  p_is_flow_builder_enabled BOOLEAN,
  p_is_campaigns_enabled BOOLEAN,
  p_is_templates_enabled BOOLEAN,
  p_is_logihub_quote_enabled BOOLEAN,
  p_is_logihub_create_enabled BOOLEAN,
  p_module_codes TEXT[],
  p_channel_keys TEXT[]
) RETURNS INTEGER AS $$
DECLARE
  v_plan_id INTEGER;
  v_module TEXT;
  v_channel TEXT;
BEGIN
  SELECT id INTO v_plan_id
  FROM plans
  WHERE lower(name) = lower(p_name)
  ORDER BY id ASC
  LIMIT 1;

  IF v_plan_id IS NULL THEN
    INSERT INTO plans (
      name, description, stripe_product_id, stripe_price_id, amount, currency, interval, trial_days,
      max_users, max_contacts, max_instances, is_ai_enabled, is_flow_builder_enabled,
      is_campaigns_enabled, is_templates_enabled, is_logihub_quote_enabled, is_logihub_create_enabled,
      is_ai_sales_enabled, is_active, created_at, updated_at
    ) VALUES (
      p_name, p_description,
      'manual_product_' || regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'),
      'manual_price_' || regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'),
      p_amount, 'usd', 'month', 3,
      p_max_users, p_max_contacts, p_max_instances, p_is_ai_enabled, p_is_flow_builder_enabled,
      p_is_campaigns_enabled, p_is_templates_enabled, p_is_logihub_quote_enabled, p_is_logihub_create_enabled,
      p_is_ai_sales_enabled, TRUE, NOW(), NOW()
    ) RETURNING id INTO v_plan_id;
  ELSE
    UPDATE plans
    SET description = p_description,
        amount = p_amount,
        currency = 'usd',
        interval = 'month',
        trial_days = 3,
        max_users = p_max_users,
        max_contacts = p_max_contacts,
        max_instances = p_max_instances,
        is_ai_enabled = p_is_ai_enabled,
        is_flow_builder_enabled = p_is_flow_builder_enabled,
        is_campaigns_enabled = p_is_campaigns_enabled,
        is_templates_enabled = p_is_templates_enabled,
        is_logihub_quote_enabled = p_is_logihub_quote_enabled,
        is_logihub_create_enabled = p_is_logihub_create_enabled,
        is_ai_sales_enabled = p_is_ai_sales_enabled,
        is_active = TRUE,
        deleted_at = NULL,
        updated_at = NOW()
    WHERE id = v_plan_id;
  END IF;

  UPDATE plan_module_entitlements SET is_allowed = FALSE, updated_at = NOW() WHERE plan_id = v_plan_id;
  FOREACH v_module IN ARRAY p_module_codes LOOP
    INSERT INTO plan_module_entitlements (plan_id, module_code, is_allowed, created_at, updated_at)
    SELECT v_plan_id, v_module, TRUE, NOW(), NOW()
    WHERE EXISTS (SELECT 1 FROM saas_modules WHERE code = v_module)
    ON CONFLICT (plan_id, module_code) DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
  END LOOP;

  UPDATE plan_channel_entitlements SET is_allowed = FALSE, updated_at = NOW() WHERE plan_id = v_plan_id;
  FOREACH v_channel IN ARRAY p_channel_keys LOOP
    INSERT INTO plan_channel_entitlements (plan_id, module_key, is_allowed, created_at, updated_at)
    SELECT v_plan_id, v_channel, TRUE, NOW(), NOW()
    WHERE EXISTS (SELECT 1 FROM allsender_channel_modules WHERE module_key = v_channel)
    ON CONFLICT (plan_id, module_key) DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
  END LOOP;

  RETURN v_plan_id;
END;
$$ LANGUAGE plpgsql;

SELECT allsender_upsert_final_plan('Plan Inicial', 'Atención básica con WhatsApp QR, Web Chat, CRM, contactos, plantillas y Docs API.', 1900, 1, 1000, 2, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, ARRAY['api_docs']::TEXT[], ARRAY['whatsapp_evolution', 'web_chat']::TEXT[]);
SELECT allsender_upsert_final_plan('Plan Emprendedor', 'Atención multicanal económica con WhatsApp QR, Instagram, Facebook Messenger, Web Chat y CRM.', 2900, 2, 3000, 3, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, ARRAY['api_docs', 'omnichannel_channels', 'departments', 'links_cortos']::TEXT[], ARRAY['whatsapp_evolution', 'web_chat', 'instagram_dm', 'facebook_messenger']::TEXT[]);
SELECT allsender_upsert_final_plan('Plan Ventas IA', 'Plan recomendado para vender con IA: catálogo, productos, órdenes, pagos, tracking y seguimiento comercial.', 4900, 5, 10000, 5, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, ARRAY['api_docs', 'omnichannel_channels', 'departments', 'links_cortos', 'ventas_ia', 'productos_ordenes', 'stock_alerta', 'payments', 'tracking']::TEXT[], ARRAY['whatsapp_evolution', 'web_chat', 'instagram_dm', 'facebook_messenger']::TEXT[]);
SELECT allsender_upsert_final_plan('Plan Omnicanal Pro', 'Marketing, operación y canales ampliados para negocios con mayor volumen de chats, campañas y publicaciones.', 7900, 10, 30000, 10, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, ARRAY['api_docs', 'omnichannel_channels', 'departments', 'links_cortos', 'ventas_ia', 'productos_ordenes', 'stock_alerta', 'payments', 'tracking', 'marketing_ia', 'autopublicar', 'comentarios-ia', 'xml_feed', 'whatsapp_warmer', 'autoreparacion_ia', 'reservas_ia', 'reportes_avanzados']::TEXT[], ARRAY['whatsapp_evolution', 'web_chat', 'instagram_dm', 'facebook_messenger', 'email', 'sms', 'tiktok_dm', 'zernio_instagram', 'zernio_facebook']::TEXT[]);
SELECT allsender_upsert_final_plan('Plan Empresa API', 'Empresa con Meta API / WhatsApp Oficial, webhooks, API pública avanzada, integraciones, agenda y soporte prioritario.', 12900, 20, 100000, 25, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, ARRAY['api_docs', 'omnichannel_channels', 'departments', 'links_cortos', 'ventas_ia', 'productos_ordenes', 'stock_alerta', 'payments', 'tracking', 'marketing_ia', 'autopublicar', 'comentarios-ia', 'xml_feed', 'whatsapp_warmer', 'autoreparacion_ia', 'reservas_ia', 'reportes_avanzados', 'api_publica', 'webhooks', 'paypal']::TEXT[], ARRAY['web_chat', 'instagram_dm', 'facebook_messenger', 'email', 'sms', 'tiktok_dm', 'whatsapp_evolution', 'whatsapp_business_api_pro', 'zernio_instagram', 'zernio_facebook', 'zernio_telegram', 'zernio_twitter', 'zernio_bluesky', 'zernio_reddit', 'zernio_tiktok', 'zernio_linkedin', 'zernio_youtube', 'zernio_threads', 'zernio_pinterest', 'zernio_googlebusiness', 'zernio_snapchat', 'zernio_discord', 'zernio_whatsapp']::TEXT[]);

DROP FUNCTION allsender_upsert_final_plan(TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], TEXT[]);

UPDATE paypal_subscription_plans
SET trial_days = 3,
    description = regexp_replace(COALESCE(description, ''), '7 días de prueba', '3 días de prueba', 'gi'),
    updated_at = NOW()
WHERE is_module = TRUE;

COMMIT;
