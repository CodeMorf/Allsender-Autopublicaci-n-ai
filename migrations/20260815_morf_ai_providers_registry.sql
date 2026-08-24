BEGIN;

-- Morf AI — Fase 1: Provider Registry
-- Fuente global de proveedores LLM administrada por Super Admin.
-- No destructiva: CREATE IF NOT EXISTS + INSERT ON CONFLICT DO NOTHING.
-- Los secretos NO viven en esta tabla: se mantienen en variables de entorno
-- server-side (cadenas por proveedor en lib/morf-ai/providers/catalog.ts).

CREATE TABLE IF NOT EXISTS morf_ai_providers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  default_model TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_priority INTEGER,
  capabilities JSONB NOT NULL DEFAULT '["text"]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_test_status TEXT,
  last_test_message_sanitized TEXT,
  last_test_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS morf_ai_providers_enabled_idx ON morf_ai_providers(is_enabled);
CREATE INDEX IF NOT EXISTS morf_ai_providers_primary_idx ON morf_ai_providers(is_primary);

-- Seed por defecto (cadena del master prompt: CodeMorf -> DeepSeek -> Kimi -> NordRouter -> OpenAI).
-- Solo CodeMorf nace enabled+primary; el resto queda disabled hasta que Super Admin lo active.
-- default_model NULL obliga a configurar modelo real antes de marcar el provider como ready.
INSERT INTO morf_ai_providers (code, display_name, base_url, default_model, is_enabled, is_primary, fallback_priority, capabilities, metadata)
VALUES
  ('codemorf', 'CodeMorf', 'https://codemorf.tech/gateway/v1', 'morf-ai-auto', TRUE, TRUE, 1, '["text","structured_output","vision","tool_calling","classification","reasoning"]'::jsonb, '{"seed":"fase1","docs":"https://codemorf.tech/chat/docs/es/","legacy":false}'::jsonb),
  ('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat', FALSE, FALSE, 2, '["text","structured_output","tool_calling","classification"]'::jsonb, '{"seed":"fase1","legacy":false}'::jsonb),
  ('kimi', 'Kimi (Moonshot)', 'https://api.moonshot.cn/v1', 'moonshot-v1-8k', FALSE, FALSE, 3, '["text","structured_output","tool_calling","classification","vision"]'::jsonb, '{"seed":"fase1","docs":"https://platform.moonshot.ai/","legacy":false}'::jsonb),
  ('nordrouter', 'NordRouter', 'https://nordrouter.com/api/v1', NULL, FALSE, FALSE, 4, '["text","structured_output","tool_calling","classification"]'::jsonb, '{"seed":"fase1","docs":"https://nordrouter.com/docs/es/","legacy":false}'::jsonb),
  ('openai', 'OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini', FALSE, FALSE, 5, '["text","structured_output","vision","tool_calling","classification"]'::jsonb, '{"seed":"fase1","legacy":false}'::jsonb),
  ('openrouter', 'OpenRouter (legacy)', 'https://openrouter.ai/api/v1', 'openrouter/auto', FALSE, FALSE, 6, '["text","structured_output","vision","tool_calling","classification"]'::jsonb, '{"seed":"fase1","legacy":true}'::jsonb),
  ('gemini', 'Gemini (legacy)', 'https://generativelanguage.googleapis.com/v1beta', NULL, FALSE, FALSE, 7, '["text","structured_output","vision","classification"]'::jsonb, '{"seed":"fase1","legacy":true}'::jsonb)
ON CONFLICT (code) DO NOTHING;

COMMIT;
