BEGIN;

CREATE TABLE IF NOT EXISTS ai_sales_context_repair_backups (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL,
  chat_id INTEGER,
  backup_scope TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO ai_sales_context_repair_backups (team_id, chat_id, backup_scope, payload)
SELECT
  team_id,
  chat_id,
  'v8_selected_name_without_id',
  to_jsonb(s)
FROM ai_sales_conversation_state s
WHERE selected_product_id IS NULL
  AND selected_product_name IS NOT NULL;

UPDATE ai_sales_conversation_state
SET selected_product_name = NULL,
    selected_product_price = NULL,
    current_stage = CASE
      WHEN current_stage IN ('product_selected','waiting_customer_data','waiting_order_confirmation','product_image_requested') THEN 'new_conversation'
      ELSE current_stage
    END,
    missing_data = '[]'::jsonb,
    updated_at = NOW()
WHERE selected_product_id IS NULL
  AND selected_product_name IS NOT NULL;

UPDATE ai_sales_chat_memory
SET product_hint = NULL,
    updated_at = NOW()
WHERE product_hint IS NOT NULL
  AND (
    LOWER(product_hint) SIMILAR TO '%(hola|buenos dias|buenas|audio enviado|imagen enviada|cancel|elimina|singa|gemini|trabaja mal|perder el contexto|ya me lo enviaste)%'
    OR LENGTH(product_hint) < 3
  );

CREATE OR REPLACE VIEW ai_sales_flow_integrity_report AS
SELECT
  COALESCE(s.team_id, p.team_id) AS team_id,
  COALESCE(s.is_active, false) AS sales_ai_active,
  COALESCE(p.active_products, 0) AS active_products,
  COALESCE(p.products_with_image, 0) AS products_with_image,
  COALESCE(b.bad_selected_name_without_id, 0) AS bad_selected_name_without_id,
  COALESCE(m.bad_product_hints, 0) AS bad_product_hints,
  CASE
    WHEN COALESCE(s.is_active, false) = true AND COALESCE(p.active_products, 0) = 0 THEN 'sales_active_without_catalog'
    WHEN COALESCE(s.is_active, false) = true AND COALESCE(p.active_products, 0) < 3 THEN 'sales_active_low_catalog'
    WHEN COALESCE(b.bad_selected_name_without_id, 0) > 0 THEN 'bad_selected_product_state'
    WHEN COALESCE(m.bad_product_hints, 0) > 0 THEN 'bad_product_hint_memory'
    ELSE 'ok'
  END AS status
FROM ai_sales_settings s
FULL JOIN (
  SELECT
    team_id,
    COUNT(*) FILTER (WHERE is_active = true) AS active_products,
    COUNT(*) FILTER (WHERE is_active = true AND image_url IS NOT NULL AND image_url <> '') AS products_with_image
  FROM ai_sales_products
  GROUP BY team_id
) p ON p.team_id = s.team_id
LEFT JOIN (
  SELECT team_id, COUNT(*) AS bad_selected_name_without_id
  FROM ai_sales_conversation_state
  WHERE selected_product_id IS NULL AND selected_product_name IS NOT NULL
  GROUP BY team_id
) b ON b.team_id = COALESCE(s.team_id, p.team_id)
LEFT JOIN (
  SELECT team_id, COUNT(*) AS bad_product_hints
  FROM ai_sales_chat_memory
  WHERE product_hint IS NOT NULL
    AND (
      LOWER(product_hint) SIMILAR TO '%(hola|buenos dias|buenas|audio enviado|imagen enviada|cancel|elimina|singa|gemini|trabaja mal|perder el contexto|ya me lo enviaste)%'
      OR LENGTH(product_hint) < 3
    )
  GROUP BY team_id
) m ON m.team_id = COALESCE(s.team_id, p.team_id);

CREATE OR REPLACE FUNCTION ai_sales_reset_chat_context_v8(
  p_team_id INTEGER,
  p_chat_id INTEGER,
  p_reason TEXT DEFAULT 'manual_v8_context_reset'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_state_count INTEGER := 0;
  v_memory_count INTEGER := 0;
BEGIN
  INSERT INTO ai_sales_context_repair_backups (team_id, chat_id, backup_scope, payload)
  SELECT p_team_id, p_chat_id, p_reason, jsonb_build_object(
    'state', (SELECT to_jsonb(s) FROM ai_sales_conversation_state s WHERE s.team_id = p_team_id AND s.chat_id = p_chat_id LIMIT 1),
    'memory', (SELECT to_jsonb(m) FROM ai_sales_chat_memory m WHERE m.team_id = p_team_id AND m.chat_id = p_chat_id LIMIT 1)
  );

  UPDATE ai_sales_conversation_state
  SET selected_product_id = NULL,
      selected_product_name = NULL,
      selected_product_price = NULL,
      current_stage = 'new_conversation',
      last_intent = NULL,
      last_products_sent = '[]'::jsonb,
      missing_data = '[]'::jsonb,
      payment_status = 'none',
      human_required = FALSE,
      confused_count = 0,
      updated_at = NOW()
  WHERE team_id = p_team_id AND chat_id = p_chat_id;
  GET DIAGNOSTICS v_state_count = ROW_COUNT;

  UPDATE ai_sales_chat_memory
  SET product_hint = NULL,
      last_user_intent = 'manual_reset',
      raw_summary = COALESCE(raw_summary, '{}'::jsonb) || jsonb_build_object('v8_reset_reason', p_reason, 'v8_reset_at', NOW()::text),
      updated_at = NOW()
  WHERE team_id = p_team_id AND chat_id = p_chat_id;
  GET DIAGNOSTICS v_memory_count = ROW_COUNT;

  UPDATE ai_sessions
  SET history = '[]'::jsonb,
      updated_at = NOW()
  WHERE chat_id = p_chat_id;

  RETURN jsonb_build_object('ok', true, 'team_id', p_team_id, 'chat_id', p_chat_id, 'state_rows', v_state_count, 'memory_rows', v_memory_count);
END;
$$;

COMMIT;
