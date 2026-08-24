-- P0 costo vendor AI: rotación controlada de conversaciones Mistral.
-- El runtime acumula prompt_tokens por conversación de proveedor; al superar el
-- umbral (MISTRAL_CONVERSATION_MAX_PROMPT_TOKENS) marca la conversación como invalid
-- para que el siguiente turno inicie una conversación nueva reconstruida desde la
-- memoria compacta SQL (buildRecoveryInput), en lugar de reenviar un historial sin límite.
ALTER TABLE ai_sales_provider_conversations
  ADD COLUMN IF NOT EXISTS cumulative_prompt_tokens INTEGER NOT NULL DEFAULT 0;

-- Rollback (manual, la columna es aditiva y no bloquea rollback de código):
-- ALTER TABLE ai_sales_provider_conversations DROP COLUMN IF EXISTS cumulative_prompt_tokens;
