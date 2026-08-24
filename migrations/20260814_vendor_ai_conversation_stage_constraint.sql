-- Amplía ai_sales_conversation_stage_check con los stages que el código escribe y que faltaban:
--   'completed'               -> clear_finished_sales_state (runtime services.ts)
--   'waiting_delivery_location' -> orquestador determinista (orchestrator.ts)
-- Los stages libres sugeridos por el LLM ('confirmation', 'delivery') NO se añaden:
-- se normalizan en el runtime (solo se persisten stages canónicos) para no romper la
-- máquina de estados determinista.
ALTER TABLE ai_sales_conversation_state DROP CONSTRAINT IF EXISTS ai_sales_conversation_stage_check;
ALTER TABLE ai_sales_conversation_state ADD CONSTRAINT ai_sales_conversation_stage_check
  CHECK (current_stage = ANY (ARRAY[
    'new_conversation'::varchar, 'greeting'::varchar, 'product_discovery'::varchar,
    'product_options_sent'::varchar, 'waiting_product_selection'::varchar,
    'product_image_requested'::varchar, 'product_selected'::varchar,
    'waiting_customer_data'::varchar, 'waiting_order_confirmation'::varchar,
    'waiting_payment'::varchar, 'payment_proof_received'::varchar,
    'payment_pending_verification'::varchar, 'order_confirmed'::varchar,
    'order_cancelled'::varchar, 'human_handoff_required'::varchar,
    'completed'::varchar, 'waiting_delivery_location'::varchar
  ]::text[]));

-- Rollback:
-- ALTER TABLE ai_sales_conversation_state DROP CONSTRAINT ai_sales_conversation_stage_check;
-- ALTER TABLE ai_sales_conversation_state ADD CONSTRAINT ai_sales_conversation_stage_check
--   CHECK (current_stage = ANY (ARRAY['new_conversation'::varchar,'greeting'::varchar,'product_discovery'::varchar,'product_options_sent'::varchar,'waiting_product_selection'::varchar,'product_image_requested'::varchar,'product_selected'::varchar,'waiting_customer_data'::varchar,'waiting_order_confirmation'::varchar,'waiting_payment'::varchar,'payment_proof_received'::varchar,'payment_pending_verification'::varchar,'order_confirmed'::varchar,'order_cancelled'::varchar,'human_handoff_required'::varchar]::text[]));
