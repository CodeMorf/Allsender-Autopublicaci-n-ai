BEGIN;

UPDATE ai_sales_chat_memory
SET product_hint = NULL,
    last_user_intent = 'system_clean_product_hint_v7',
    raw_summary = COALESCE(raw_summary, '{}'::jsonb) || jsonb_build_object('cleaned_product_hint_at', NOW()::text),
    updated_at = NOW()
WHERE product_hint IS NOT NULL
  AND (
    product_hint ~* '^(hola|buenas|saludos|ok|si|sí|no|gracias|audio enviado|imagen enviada|comprobante|quiero cancelarlo)$'
    OR product_hint ~* '(cancel|elimina|borra|limpia|numero equivocado|número equivocado|http|gemini|madre)'
  );

UPDATE ai_sales_conversation_state
SET selected_product_name = NULL,
    selected_product_price = NULL,
    current_stage = CASE
      WHEN pending_order_id IS NULL THEN 'new_conversation'
      ELSE current_stage
    END,
    last_intent = NULL,
    last_products_sent = CASE
      WHEN pending_order_id IS NULL THEN '[]'::jsonb
      ELSE COALESCE(last_products_sent, '[]'::jsonb)
    END,
    missing_data = CASE
      WHEN pending_order_id IS NULL THEN '[]'::jsonb
      ELSE COALESCE(missing_data, '[]'::jsonb)
    END,
    memory_summary = COALESCE(memory_summary, '{}'::jsonb) || jsonb_build_object('cleaned_invalid_selected_name_at', NOW()::text),
    updated_at = NOW()
WHERE selected_product_id IS NULL
  AND selected_product_name IS NOT NULL;

UPDATE ai_sessions
SET history = '[]'::jsonb,
    updated_at = NOW()
WHERE history IS NOT NULL
  AND chat_id IN (
    SELECT chat_id
    FROM ai_sales_conversation_state
    WHERE selected_product_id IS NULL
      AND pending_order_id IS NULL
  );

CREATE OR REPLACE VIEW public.ai_sales_product_media_report AS
SELECT
  team_id,
  COUNT(*) FILTER (WHERE is_active = true) AS active_products,
  COUNT(*) FILTER (WHERE is_active = true AND NULLIF(TRIM(COALESCE(image_url, '')), '') IS NOT NULL) AS active_products_with_image,
  COUNT(*) FILTER (WHERE is_active = true AND NULLIF(TRIM(COALESCE(image_url, '')), '') IS NULL) AS active_products_without_image,
  MAX(updated_at) AS last_product_update
FROM ai_sales_products
GROUP BY team_id;

COMMIT;
