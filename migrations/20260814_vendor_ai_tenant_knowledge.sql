-- Vendor AI Fase 6: espejo local del conocimiento del tenant (Entrenamiento IA)
-- conectado al search_knowledge del Sales Runtime.
-- Aislamiento: índice único (team_id, source_key); toda consulta filtra por team_id.
-- Aditiva y reversible: no toca tablas legacy ni el RAG vectorial del SaaS.

CREATE TABLE IF NOT EXISTS ai_tenant_knowledge_sources (
  id BIGSERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_public_id TEXT,
  source_type TEXT NOT NULL DEFAULT 'text' CHECK (source_type IN ('text','url','file')),
  title TEXT,
  content TEXT NOT NULL,
  url TEXT,
  file_name TEXT,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','processing','error')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_tenant_knowledge_team_key_uidx
  ON ai_tenant_knowledge_sources (team_id, source_key);

CREATE INDEX IF NOT EXISTS ai_tenant_knowledge_team_idx
  ON ai_tenant_knowledge_sources (team_id);
