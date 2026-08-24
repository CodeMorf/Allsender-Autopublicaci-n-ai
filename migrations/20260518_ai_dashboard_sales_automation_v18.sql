BEGIN;

CREATE TABLE IF NOT EXISTS ai_automation_runtime_guards (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL UNIQUE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode VARCHAR(40) NOT NULL DEFAULT 'sales_ai_safe',
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_automation_runtime_guards_team_idx
  ON ai_automation_runtime_guards (team_id);

CREATE TABLE IF NOT EXISTS ai_dashboard_settings_audit (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER,
  scope VARCHAR(60) NOT NULL,
  action VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

WITH recommended AS (
  SELECT
    'Vendemos productos variados por chat. El cliente puede preguntar por productos, recibir opciones, confirmar una compra y crear una orden con entrega.'::text AS business_description,
    'La IA debe vender de forma natural, sin presionar y sin sonar robótica.

Flujo obligatorio:
1. Entender qué producto busca el cliente.
2. Buscar productos reales del catálogo.
3. Mostrar máximo 3 opciones con nombre y precio.
4. Si el cliente elige una opción, guardar producto seleccionado.
5. Si el cliente pregunta por el producto, responder información del producto, no pedir pago todavía.
6. Solo pedir datos de orden cuando el cliente confirme que quiere comprar.
7. Antes de crear orden, confirmar producto, cantidad, precio, nombre, teléfono, dirección y método de pago.
8. Si falta un dato, pedir solo ese dato.
9. Si el cliente pregunta por tracking, buscar la orden y responder estado.
10. Si el cliente quiere modificar, cancelar o agregar producto, verificar primero si la orden se puede modificar.

Reglas importantes:
- No usar preguntas informativas como nombre, teléfono o dirección.
- No crear orden cuando el cliente solo pregunta.
- No modificar orden sin confirmación clara.
- No duplicar orden.
- No inventar productos, precios, stock, beneficios, dosis ni entrega.
- Si hay Agent AI activo, usarlo solo para mejorar el tono natural, no para decidir precios, órdenes ni tracking.'::text AS sales_instructions,
    'Clasifica cada mensaje antes de responder:

PRODUCT_SEARCH: cuando el cliente pide un producto nuevo. Ejemplo: “necesito shilajit”, “tienes colágeno”, “busco una crema”.
PRODUCT_SELECTION: cuando el cliente elige una opción. Ejemplo: “1”, “el primero”, “ese”, “quiero ese”.
PRODUCT_INFO: cuando el cliente pide explicación. Ejemplo: “cómo funciona”, “cómo se toma”, “para qué sirve”, “dame descripción”, “tiene foto”.
ORDER_DATA: cuando el cliente envía nombre, teléfono, dirección o método de pago después de haber confirmado compra.
ORDER_CONFIRMATION: cuando el cliente confirma compra. Ejemplo: “sí”, “confirmado”, “lo quiero”, “haz la orden”.
TRACKING: cuando el cliente pregunta por su orden. Ejemplo: “dónde está mi orden”, “mi tracking”, “seguimiento”.
POST_ORDER_CHANGE: cuando el cliente pide cambiar, cancelar, agregar producto o cambiar dirección.
HUMAN_SUPPORT: cuando el cliente está molesto, confundido o pide hablar con alguien.

Nunca mezcles estados:
- PRODUCT_INFO no puede activar captura de datos.
- PRODUCT_SEARCH no puede modificar una orden existente.
- TRACKING no puede crear orden.
- POST_ORDER_CHANGE no puede ejecutarse sin validar estado de la orden.'::text AS sales_policy,
    'Eres un asistente comercial humano del negocio. Tu trabajo es conversar de forma natural, entender lo que el cliente quiere y ayudarlo sin sonar robótico.

Reglas principales:
- Responde corto, claro y natural, como WhatsApp.
- No digas que eres una IA.
- No repitas saludos si la conversación ya empezó.
- No digas “problema técnico”, “no pude procesar” ni “soy una idea”.
- Si no entiendes, pregunta una sola cosa.
- Si el cliente escribe mal, interpreta la intención.
- Si el cliente pide información de un producto, responde información, no intentes cerrar orden todavía.
- Si el cliente pregunta “cómo funciona”, “cómo se toma”, “para qué sirve” o “dame descripción”, responde sobre el producto seleccionado.
- Si no tienes descripción real del producto, di: “No tengo una descripción detallada registrada, pero puedo ayudarte con precio, disponibilidad o buscar una opción similar.”
- No inventes beneficios médicos, dosis, garantías, stock, precio, entrega ni tracking.
- Si el cliente quiere comprar, pasa el control al módulo de Ventas IA.
- Si el cliente pregunta por una orden, pasa el control al módulo de tracking/Ventas IA.
- Si el cliente pide cancelar, cambiar dirección, agregar producto o modificar una orden, pasa el control al módulo de Ventas IA.'::text AS agent_prompt,
    'Si Ventas IA está activa, Automation solo puede enrutar, recordar o hacer seguimiento. No debe crear órdenes, modificar órdenes ni responder por encima de Ventas IA.

Flujos recomendados:
1. Bienvenida: saludar y dejar que Ventas IA continúe si el mensaje menciona producto.
2. Tracking: enviar al módulo de tracking/Ventas IA.
3. Soporte humano: pausar IA y notificar agente.
4. Postorden: enviar al módulo de Ventas IA postorden.
5. Abandono de compra: recordar después de X tiempo con mensaje corto.'::text AS automation_rules
), inserted_sales_settings AS (
  INSERT INTO ai_sales_settings (
    team_id, is_active, agent_name, currency, payment_methods,
    require_customer_confirmation, require_human_review, default_delivery_fee,
    delivery_additional_item_fee, order_prefix, business_description,
    sales_instructions, sales_policy, default_payment_method, cod_enabled,
    transfer_enabled, created_at, updated_at
  )
  SELECT
    t.id, false, 'AllSender IA Ventas', 'DOP', '["cod", "transfer"]'::jsonb,
    true, false, 0, 5, 'AI', r.business_description,
    r.sales_instructions, r.sales_policy, 'cod', true,
    true, NOW(), NOW()
  FROM teams t
  CROSS JOIN recommended r
  WHERE NOT EXISTS (
    SELECT 1 FROM ai_sales_settings s WHERE s.team_id = t.id
  )
  RETURNING team_id
), updated_sales_settings AS (
  UPDATE ai_sales_settings s
  SET
    business_description = CASE
      WHEN NULLIF(BTRIM(s.business_description), '') IS NULL
        OR s.business_description ILIKE '%soyvalario%'
        OR s.business_description ILIKE '%nunca diga que eres una ai%'
        THEN r.business_description
      ELSE s.business_description
    END,
    sales_instructions = CASE
      WHEN NULLIF(BTRIM(s.sales_instructions), '') IS NULL
        OR s.sales_instructions ILIKE '%soyvalario%'
        OR s.sales_instructions ILIKE '%nunca diga que eres una ai%'
        OR s.sales_instructions ILIKE '%problema tecnico%'
        THEN r.sales_instructions
      ELSE s.sales_instructions
    END,
    sales_policy = CASE
      WHEN NULLIF(BTRIM(s.sales_policy), '') IS NULL
        OR s.sales_policy = 'La IA debe mostrar opciones, confirmar producto, cantidad, precio, nombre, telefono, direccion y metodo de pago antes de crear una orden.'
        OR s.sales_policy ILIKE '%soyvalario%'
        OR s.sales_policy ILIKE '%nunca diga que eres una ai%'
        THEN r.sales_policy
      ELSE s.sales_policy
    END,
    updated_at = NOW()
  FROM recommended r
  WHERE
    NULLIF(BTRIM(s.business_description), '') IS NULL
    OR NULLIF(BTRIM(s.sales_instructions), '') IS NULL
    OR NULLIF(BTRIM(s.sales_policy), '') IS NULL
    OR s.business_description ILIKE '%soyvalario%'
    OR s.sales_instructions ILIKE '%soyvalario%'
    OR s.sales_policy ILIKE '%soyvalario%'
    OR s.sales_instructions ILIKE '%nunca diga que eres una ai%'
    OR s.sales_policy = 'La IA debe mostrar opciones, confirmar producto, cantidad, precio, nombre, telefono, direccion y metodo de pago antes de crear una orden.'
  RETURNING s.team_id
), updated_ai_configs AS (
  UPDATE ai_configs c
  SET
    system_prompt = r.agent_prompt,
    temperature = COALESCE(c.temperature, 0.6),
    max_output_tokens = COALESCE(c.max_output_tokens, 1000),
    updated_at = NOW()
  FROM recommended r
  WHERE
    NULLIF(BTRIM(c.system_prompt), '') IS NULL
    OR c.system_prompt ILIKE '%soy una idea%'
    OR c.system_prompt ILIKE '%problema tecnico%'
    OR c.system_prompt ILIKE '%no pude procesar%'
    OR c.system_prompt ILIKE '%soyvalario%'
  RETURNING c.team_id
), inserted_guards AS (
  INSERT INTO ai_automation_runtime_guards (team_id, is_enabled, mode, rules, created_at, updated_at)
  SELECT
    t.id,
    true,
    'sales_ai_safe',
    jsonb_build_object(
      'rules_text', r.automation_rules,
      'allow_routing', true,
      'allow_followup', true,
      'allow_human_pause', true,
      'block_order_create', true,
      'block_order_update', true,
      'block_tracking_override', true,
      'updated_by', 'migration_v18'
    ),
    NOW(),
    NOW()
  FROM teams t
  CROSS JOIN recommended r
  WHERE NOT EXISTS (
    SELECT 1 FROM ai_automation_runtime_guards g WHERE g.team_id = t.id
  )
  RETURNING team_id
)
INSERT INTO ai_dashboard_settings_audit (team_id, scope, action, payload)
SELECT NULL, 'v18', 'apply_dashboard_defaults', jsonb_build_object(
  'inserted_sales_settings', (SELECT COUNT(*) FROM inserted_sales_settings),
  'updated_sales_settings', (SELECT COUNT(*) FROM updated_sales_settings),
  'updated_ai_configs', (SELECT COUNT(*) FROM updated_ai_configs),
  'inserted_automation_guards', (SELECT COUNT(*) FROM inserted_guards)
);

CREATE OR REPLACE VIEW ai_dashboard_v18_integrity_report AS
SELECT
  t.id AS team_id,
  t.name AS team_name,
  COALESCE(s.is_active, false) AS sales_ai_active,
  COALESCE(c.is_active, false) AS agent_ai_active,
  COALESCE(g.is_enabled, false) AS automation_guard_active,
  CASE WHEN NULLIF(BTRIM(s.business_description), '') IS NULL THEN false ELSE true END AS has_business_description,
  CASE WHEN NULLIF(BTRIM(s.sales_instructions), '') IS NULL THEN false ELSE true END AS has_sales_instructions,
  CASE WHEN NULLIF(BTRIM(s.sales_policy), '') IS NULL THEN false ELSE true END AS has_sales_policy,
  CASE WHEN NULLIF(BTRIM(c.system_prompt), '') IS NULL THEN false ELSE true END AS has_agent_prompt,
  s.updated_at AS sales_settings_updated_at,
  c.updated_at AS ai_config_updated_at,
  g.updated_at AS automation_guard_updated_at
FROM teams t
LEFT JOIN ai_sales_settings s ON s.team_id = t.id
LEFT JOIN ai_configs c ON c.team_id = t.id
LEFT JOIN ai_automation_runtime_guards g ON g.team_id = t.id;

COMMIT;
