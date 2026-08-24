-- AllSender Ventas IA V17 - diagnóstico opcional
-- PostgreSQL / No cambia estructura / No modifica datos.

SELECT
  team_id,
  chat_id,
  current_stage,
  last_intent,
  selected_product_id,
  selected_product_name,
  customer_name,
  customer_phone,
  customer_address,
  payment_status,
  missing_data,
  updated_at
FROM ai_sales_conversation_state
ORDER BY updated_at DESC
LIMIT 30;

SELECT
  id,
  team_id,
  chat_id,
  order_number,
  status,
  shipping_status,
  logihub_status,
  product_name,
  total,
  cod_amount,
  updated_at
FROM ai_sales_orders
WHERE status NOT IN ('cancelled', 'canceled', 'completed', 'delivered', 'returned')
ORDER BY updated_at DESC
LIMIT 30;
