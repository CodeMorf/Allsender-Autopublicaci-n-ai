-- AllSender Ventas IA V16 - diagnóstico opcional
-- PostgreSQL / No cambia estructura / No modifica órdenes / No elimina datos.

-- Últimos estados de conversación de Ventas IA
SELECT
  team_id,
  chat_id,
  current_stage,
  last_intent,
  selected_product_id,
  selected_product_name,
  pending_choice_type,
  updated_at
FROM ai_sales_conversation_state
ORDER BY updated_at DESC
LIMIT 30;

-- Últimas órdenes activas creadas por Ventas IA
SELECT
  id,
  team_id,
  chat_id,
  order_number,
  status,
  shipping_status,
  logihub_status,
  shipping_tracking,
  logihub_tracking,
  total,
  cod_amount,
  updated_at
FROM ai_sales_orders
WHERE status NOT IN ('cancelled', 'canceled', 'completed', 'delivered', 'returned')
ORDER BY updated_at DESC
LIMIT 30;
