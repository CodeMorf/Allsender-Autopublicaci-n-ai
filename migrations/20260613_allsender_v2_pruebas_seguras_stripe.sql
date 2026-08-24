-- AllSender v2: prueba segura, canales sin costo y Stripe global
-- Objetivo: proteger la finanza. No abre pruebas automáticas para conectores con costo.
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

-- Planes sin trial global para evitar abrir módulos caros por accidente.
UPDATE plans
SET trial_days = 0,
    updated_at = NOW()
WHERE lower(name) IN (
  'plan inicial',
  'plan emprendedor',
  'plan ventas ia',
  'plan omnicanal pro',
  'plan empresa api'
);

-- Módulos generales: prueba solo para lo que no genera costo directo.
INSERT INTO saas_modules (code, name, description, base_price_amount, currency, trial_days, is_available, created_at, updated_at)
VALUES
  ('api_docs', 'Docs API', 'Documentación API disponible para todos los planes. El uso avanzado se controla por plan.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('agente_ia_basico', 'Agente IA básico', 'Asistente de tono y ayuda conversacional básica sin ejecutar ventas automáticas ni órdenes.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('automation_basic', 'Automatización básica', 'Reglas simples, respuestas automáticas y organización inicial sin conectores externos de costo.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('departments', 'Departamentos', 'Áreas como Administración, Ventas o Soporte para organizar conversaciones.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('links_cortos', 'Links Cortos', 'Enlaces medibles propios para campañas y conversaciones rápidas.', 0.00, 'USD', 3, TRUE, NOW(), NOW()),
  ('omnichannel_channels', 'Centro de canales', 'Centro para administrar canales permitidos por plan. No habilita conectores de costo por sí solo.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('reservas_ia', 'Calendario / Citas', 'Agenda, reservas, servicios, recursos, link público y recordatorios.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('comentarios-ia', 'Comentarios IA', 'Respuesta de comentarios y derivación a chat usando cuentas conectadas.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('autopublicar', 'Autopublicar', 'Programación y publicación de contenido usando cuentas conectadas.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('marketing_ia', 'Marketing IA', 'Generación inteligente de campañas y textos comerciales.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('ventas_ia', 'Ventas IA / Vendor AI', 'Motor transaccional para catálogo, productos, órdenes, pagos, tracking y postventa.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('productos_ordenes', 'Productos y Órdenes', 'Catálogo operativo, stock, precios, órdenes y reglas comerciales utilizadas por Ventas IA.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('stock_alerta', 'Stock alerta', 'Monitoreo de inventario para evitar recomendaciones sin disponibilidad.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('xml_feed', 'XML / Feed', 'Sincronizador de catálogos externos compatible con Meta, Google Merchant y ecommerce.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('whatsapp_warmer', 'Calentador WhatsApp', 'Diagnóstico de salud operativa y buenas prácticas por conexión WhatsApp.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('autoreparacion_ia', 'Autoreparación IA', 'Recupera flujos de venta y conversaciones trabadas sin borrar historial.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('api_publica', 'API pública avanzada', 'Uso avanzado de API para integraciones externas.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('webhooks', 'Webhooks avanzados', 'Eventos salientes para sistemas externos.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('payments', 'Pagos del negocio', 'Métodos de pago autorizados, links de pago y confirmación de orden.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('tracking', 'Tracking y postventa', 'Consulta de tracking, seguimiento y postorden.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('reportes_avanzados', 'Reportes avanzados', 'Métricas de conversión, respuesta, campañas y actividad del equipo.', 0.00, 'USD', 0, TRUE, NOW(), NOW()),
  ('paypal', 'PayPal', 'Pasarela administrada desde Super Admin. No se muestra como módulo operativo al cliente.', 0.00, 'USD', 0, TRUE, NOW(), NOW())
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_price_amount = EXCLUDED.base_price_amount,
  currency = EXCLUDED.currency,
  trial_days = EXCLUDED.trial_days,
  is_available = TRUE,
  updated_at = NOW();

-- Canales: gratis solo los que no generan costo directo a AllSender.
UPDATE allsender_channel_modules
SET price_cents = CASE
      WHEN module_key IN ('web_chat','sms','whatsapp_evolution','instagram_dm','facebook_messenger') THEN 0
      WHEN module_key = 'email' THEN 500
      WHEN module_key = 'tiktok_dm' THEN 1000
      WHEN module_key = 'whatsapp_business_api_pro' THEN 1200
      WHEN provider = 'zernio' THEN 600
      ELSE price_cents
    END,
    trial_days = CASE
      WHEN module_key IN ('web_chat','sms','whatsapp_evolution','instagram_dm','facebook_messenger') THEN 3
      ELSE 0
    END,
    metadata = COALESCE(metadata, '{}'::jsonb) || CASE
      WHEN module_key = 'sms' THEN jsonb_build_object('plan_hint','Incluido. El negocio usa su propio teléfono Android y paga sus SMS con su SIM local.','status_hint','Gateway Android AllSender con SIM del cliente')
      WHEN module_key = 'whatsapp_evolution' THEN jsonb_build_object('plan_hint','Incluido en todos los planes','status_hint','WhatsApp QR y Meta WABA directo')
      WHEN module_key = 'facebook_messenger' THEN jsonb_build_object('plan_hint','Meta directo manual incluido según plan','status_hint','Messenger directo con autorización Meta')
      WHEN module_key = 'instagram_dm' THEN jsonb_build_object('plan_hint','Meta directo incluido según plan','status_hint','Instagram directo con autorización Meta')
      WHEN provider = 'zernio' THEN jsonb_build_object('plan_hint','Activación manual desde Super Admin para proteger costos','status_hint','Conector con costo externo')
      ELSE '{}'::jsonb
    END,
    updated_at = NOW();

-- Asegura / actualiza canales clave si faltan.
INSERT INTO allsender_channel_modules (module_key, name, description, channel_type, provider, price_cents, currency, trial_days, is_enabled, sort_order, metadata, created_at, updated_at)
VALUES
  ('web_chat', 'Web Chat', 'Chat web nativo de AllSender para sitios del cliente.', 'web', 'internal', 0, 'usd', 3, TRUE, 10, jsonb_build_object('plan_hint','Incluido sin costo externo','status_hint','Proveedor interno AllSender'), NOW(), NOW()),
  ('instagram_dm', 'Instagram DM Meta directo', 'Mensajes directos de Instagram Business/Creator usando Meta directo.', 'instagram', 'meta', 0, 'usd', 3, TRUE, 20, jsonb_build_object('plan_hint','Meta directo incluido según plan','status_hint','Instagram directo con autorización Meta'), NOW(), NOW()),
  ('facebook_messenger', 'Facebook Messenger Meta directo', 'Messenger de páginas de Facebook con conexión directa a Meta.', 'facebook', 'meta', 0, 'usd', 3, TRUE, 30, jsonb_build_object('plan_hint','Meta directo manual incluido según plan','status_hint','Messenger directo con autorización Meta'), NOW(), NOW()),
  ('sms', 'SMS Gateway', 'SMS usando teléfono Android con SIM local del negocio. El cliente paga sus SMS con su operador.', 'sms', 'allsender_gateway', 0, 'usd', 3, TRUE, 50, jsonb_build_object('plan_hint','Incluido. SMS pagados por la SIM del cliente','status_hint','Gateway Android AllSender'), NOW(), NOW()),
  ('whatsapp_evolution', 'WhatsApp QR / Meta directo', 'WhatsApp QR actual y WhatsApp Meta WABA directo gestionado por AllSender.', 'whatsapp', 'evolution', 0, 'usd', 3, TRUE, 70, jsonb_build_object('plan_hint','Incluido en todos los planes','status_hint','QR y WABA directo'), NOW(), NOW())
ON CONFLICT (module_key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  channel_type = EXCLUDED.channel_type,
  provider = EXCLUDED.provider,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  trial_days = EXCLUDED.trial_days,
  is_enabled = TRUE,
  sort_order = EXCLUDED.sort_order,
  metadata = COALESCE(allsender_channel_modules.metadata, '{}'::jsonb) || EXCLUDED.metadata,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION allsender_set_plan_v2(
  p_name TEXT,
  p_amount INTEGER,
  p_max_users INTEGER,
  p_max_contacts INTEGER,
  p_max_instances INTEGER,
  p_ai BOOLEAN,
  p_sales_ai BOOLEAN,
  p_automation BOOLEAN,
  p_campaigns BOOLEAN,
  p_templates BOOLEAN,
  p_modules TEXT[],
  p_channels TEXT[]
) RETURNS VOID AS $$
DECLARE
  v_plan_id INTEGER;
  v_module TEXT;
  v_channel TEXT;
BEGIN
  SELECT id INTO v_plan_id FROM plans WHERE lower(name) = lower(p_name) ORDER BY id ASC LIMIT 1;
  IF v_plan_id IS NULL THEN
    INSERT INTO plans (name, description, stripe_product_id, stripe_price_id, amount, currency, interval, trial_days, max_users, max_contacts, max_instances, is_ai_enabled, is_ai_sales_enabled, is_flow_builder_enabled, is_campaigns_enabled, is_templates_enabled, is_active, created_at, updated_at)
    VALUES (p_name, 'Plan AllSender', 'manual_product_' || regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'), 'manual_price_' || regexp_replace(lower(p_name), '[^a-z0-9]+', '_', 'g'), p_amount, 'usd', 'month', 0, p_max_users, p_max_contacts, p_max_instances, p_ai, p_sales_ai, p_automation, p_campaigns, p_templates, TRUE, NOW(), NOW())
    RETURNING id INTO v_plan_id;
  ELSE
    UPDATE plans
    SET amount = p_amount,
        currency = 'usd',
        interval = 'month',
        trial_days = 0,
        max_users = p_max_users,
        max_contacts = p_max_contacts,
        max_instances = p_max_instances,
        is_ai_enabled = p_ai,
        is_ai_sales_enabled = p_sales_ai,
        is_flow_builder_enabled = p_automation,
        is_campaigns_enabled = p_campaigns,
        is_templates_enabled = p_templates,
        is_active = TRUE,
        deleted_at = NULL,
        updated_at = NOW()
    WHERE id = v_plan_id;
  END IF;

  UPDATE plan_module_entitlements SET is_allowed = FALSE, updated_at = NOW() WHERE plan_id = v_plan_id;
  FOREACH v_module IN ARRAY p_modules LOOP
    INSERT INTO plan_module_entitlements (plan_id, module_code, is_allowed, created_at, updated_at)
    SELECT v_plan_id, v_module, TRUE, NOW(), NOW()
    WHERE EXISTS (SELECT 1 FROM saas_modules WHERE code = v_module)
    ON CONFLICT (plan_id, module_code) DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
  END LOOP;

  UPDATE plan_channel_entitlements SET is_allowed = FALSE, updated_at = NOW() WHERE plan_id = v_plan_id;
  FOREACH v_channel IN ARRAY p_channels LOOP
    INSERT INTO plan_channel_entitlements (plan_id, module_key, is_allowed, created_at, updated_at)
    SELECT v_plan_id, v_channel, TRUE, NOW(), NOW()
    WHERE EXISTS (SELECT 1 FROM allsender_channel_modules WHERE module_key = v_channel)
    ON CONFLICT (plan_id, module_key) DO UPDATE SET is_allowed = TRUE, updated_at = NOW();
  END LOOP;
END;
$$ LANGUAGE plpgsql;

SELECT allsender_set_plan_v2('Plan Inicial', 1900, 1, 1000, 3, TRUE, FALSE, TRUE, FALSE, TRUE,
  ARRAY['api_docs','agente_ia_basico','automation_basic','departments']::TEXT[],
  ARRAY['whatsapp_evolution','web_chat','sms']::TEXT[]);

SELECT allsender_set_plan_v2('Plan Emprendedor', 2900, 2, 3000, 5, TRUE, FALSE, TRUE, TRUE, TRUE,
  ARRAY['api_docs','agente_ia_basico','automation_basic','departments','links_cortos','omnichannel_channels']::TEXT[],
  ARRAY['whatsapp_evolution','web_chat','sms','instagram_dm','facebook_messenger']::TEXT[]);

SELECT allsender_set_plan_v2('Plan Ventas IA', 4900, 5, 10000, 8, TRUE, TRUE, TRUE, TRUE, TRUE,
  ARRAY['api_docs','agente_ia_basico','automation_basic','departments','links_cortos','omnichannel_channels','ventas_ia','productos_ordenes','stock_alerta','payments','tracking']::TEXT[],
  ARRAY['whatsapp_evolution','web_chat','sms','instagram_dm','facebook_messenger']::TEXT[]);

SELECT allsender_set_plan_v2('Plan Omnicanal Pro', 7900, 10, 30000, 12, TRUE, TRUE, TRUE, TRUE, TRUE,
  ARRAY['api_docs','agente_ia_basico','automation_basic','departments','links_cortos','omnichannel_channels','ventas_ia','productos_ordenes','stock_alerta','payments','tracking','marketing_ia','autopublicar','comentarios-ia','xml_feed','whatsapp_warmer','autoreparacion_ia','reservas_ia','reportes_avanzados']::TEXT[],
  ARRAY['whatsapp_evolution','web_chat','sms','instagram_dm','facebook_messenger','email']::TEXT[]);

SELECT allsender_set_plan_v2('Plan Empresa API', 12900, 20, 100000, 25, TRUE, TRUE, TRUE, TRUE, TRUE,
  ARRAY['api_docs','agente_ia_basico','automation_basic','departments','links_cortos','omnichannel_channels','ventas_ia','productos_ordenes','stock_alerta','payments','tracking','marketing_ia','autopublicar','comentarios-ia','xml_feed','whatsapp_warmer','autoreparacion_ia','reservas_ia','reportes_avanzados','api_publica','webhooks']::TEXT[],
  ARRAY['whatsapp_evolution','web_chat','sms','instagram_dm','facebook_messenger','email']::TEXT[]);

DROP FUNCTION allsender_set_plan_v2(TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN, TEXT[], TEXT[]);

-- Ningún add-on PayPal queda en prueba automática.
UPDATE paypal_subscription_plans
SET trial_days = 0,
    updated_at = NOW()
WHERE is_module = TRUE;

-- Cierra pruebas abiertas en conectores con costo externo.
UPDATE team_channel_module_subscriptions s
SET status = 'inactive',
    is_active = FALSE,
    trial_started_at = NULL,
    trial_ends_at = NULL,
    updated_at = NOW()
WHERE s.status IN ('trialing','trial')
  AND s.module_key NOT IN ('web_chat','sms','whatsapp_evolution','instagram_dm','facebook_messenger');

UPDATE team_module_subscriptions s
SET status = 'inactive',
    trial_started_at = NULL,
    trial_ends_at = NULL,
    updated_at = NOW()
WHERE s.status IN ('trialing','trial')
  AND s.module_code NOT IN ('api_docs','agente_ia_basico','automation_basic','departments','links_cortos');

-- Stripe como pasarela global disponible desde Super Admin.
INSERT INTO payment_gateway_settings (provider, display_name, environment, client_id, client_secret, webhook_id, webhook_url, is_enabled, metadata, created_at, updated_at)
VALUES ('stripe', 'Stripe AllSender', 'test', NULL, NULL, NULL, 'https://auth.allsender.tech/api/stripe/webhook', TRUE, jsonb_build_object('source','super_admin','preferred',true,'currency','USD'), NOW(), NOW())
ON CONFLICT (provider) DO UPDATE SET
  display_name = COALESCE(payment_gateway_settings.display_name, EXCLUDED.display_name),
  webhook_url = COALESCE(payment_gateway_settings.webhook_url, EXCLUDED.webhook_url),
  metadata = COALESCE(payment_gateway_settings.metadata, '{}'::jsonb) || jsonb_build_object('preferred', true, 'currency', 'USD'),
  updated_at = NOW();

COMMIT;
