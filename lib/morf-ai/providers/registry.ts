// Morf AI — Provider Registry: capa de datos (server-only).
// CRUD sobre morf_ai_providers + resolución para el runtime (Fase 3).
// Los secretos nunca se persisten aquí: se leen de env por cadena (catalog.ts).

import 'server-only';

import { client } from '@/lib/db/drizzle';
import { resolveMorfAiProviderFromRecords, getMorfAiApiKeyFromEnv, toMorfProviderConfig } from './registry-core';
import { sanitizeMorfAiTestMessage, validateMorfProviderRecord, validateMorfProviderSet } from './validation';
import type { MorfCapability, MorfProviderCode, MorfProviderInput, MorfProviderRecord, MorfProviderResolution } from './types';

export class MorfProviderRegistryError extends Error {
  code: string;
  issues: string[];

  constructor(code: string, message: string, issues: string[] = []) {
    super(message);
    this.name = 'MorfProviderRegistryError';
    this.code = code;
    this.issues = issues;
  }
}

function mapRow(row: Record<string, unknown>): MorfProviderRecord {
  return {
    id: row.id != null ? Number(row.id) : undefined,
    code: row.code as MorfProviderRecord['code'],
    display_name: String(row.display_name ?? ''),
    base_url: String(row.base_url ?? ''),
    default_model: row.default_model ? String(row.default_model) : null,
    is_enabled: Boolean(row.is_enabled),
    is_primary: Boolean(row.is_primary),
    fallback_priority: row.fallback_priority != null ? Number(row.fallback_priority) : null,
    capabilities: Array.isArray(row.capabilities) ? (row.capabilities as MorfProviderRecord['capabilities']) : [],
    metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : {},
    last_test_status: row.last_test_status ? String(row.last_test_status) : null,
    last_test_message_sanitized: row.last_test_message_sanitized ? String(row.last_test_message_sanitized) : null,
    last_test_at: row.last_test_at ? String(row.last_test_at) : null,
    created_at: row.created_at ? String(row.created_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

/** Crea la tabla si no existe y siembra los defaults (idempotente, no destructivo). */
export async function ensureMorfAiProviderTables() {
  await client`
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
    )
  `;
  await client`
    CREATE INDEX IF NOT EXISTS morf_ai_providers_enabled_idx ON morf_ai_providers(is_enabled)
  `;
  await client`
    CREATE INDEX IF NOT EXISTS morf_ai_providers_primary_idx ON morf_ai_providers(is_primary)
  `;

  await client`
    INSERT INTO morf_ai_providers (code, display_name, base_url, default_model, is_enabled, is_primary, fallback_priority, capabilities, metadata)
    VALUES
      ('codemorf', 'CodeMorf', 'https://codemorf.tech/gateway/v1', 'morf-ai-auto', TRUE, TRUE, 1, '["text","structured_output","vision","tool_calling","classification","reasoning"]'::jsonb, '{"seed":"fase1","docs":"https://codemorf.tech/chat/docs/es/","legacy":false}'::jsonb),
      ('deepseek', 'DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat', FALSE, FALSE, 2, '["text","structured_output","tool_calling","classification"]'::jsonb, '{"seed":"fase1","legacy":false}'::jsonb),
      ('kimi', 'Kimi (Moonshot)', 'https://api.moonshot.cn/v1', 'moonshot-v1-8k', FALSE, FALSE, 3, '["text","structured_output","tool_calling","classification","vision"]'::jsonb, '{"seed":"fase1","docs":"https://platform.moonshot.ai/","legacy":false}'::jsonb),
      ('nordrouter', 'NordRouter', 'https://nordrouter.com/api/v1', NULL, FALSE, FALSE, 4, '["text","structured_output","tool_calling","classification"]'::jsonb, '{"seed":"fase1","docs":"https://nordrouter.com/docs/es/","legacy":false}'::jsonb),
      ('openai', 'OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini', FALSE, FALSE, 5, '["text","structured_output","vision","tool_calling","classification"]'::jsonb, '{"seed":"fase1","legacy":false}'::jsonb),
      ('openrouter', 'OpenRouter (legacy)', 'https://openrouter.ai/api/v1', 'openrouter/auto', FALSE, FALSE, 6, '["text","structured_output","vision","tool_calling","classification"]'::jsonb, '{"seed":"fase1","legacy":true}'::jsonb),
      ('gemini', 'Gemini (legacy)', 'https://generativelanguage.googleapis.com/v1beta', NULL, FALSE, FALSE, 7, '["text","structured_output","vision","classification"]'::jsonb, '{"seed":"fase1","legacy":true}'::jsonb)
    ON CONFLICT (code) DO NOTHING
  `;
}

export async function listMorfAiProviders(): Promise<MorfProviderRecord[]> {
  await ensureMorfAiProviderTables();
  const rows = await client`
    SELECT * FROM morf_ai_providers
    ORDER BY (is_primary) DESC, (fallback_priority IS NULL) ASC, fallback_priority ASC, code ASC
  `;
  return rows.map(mapRow);
}

export async function getMorfAiProvider(code: MorfProviderCode): Promise<MorfProviderRecord | null> {
  await ensureMorfAiProviderTables();
  const rows = await client`SELECT * FROM morf_ai_providers WHERE code = ${code} LIMIT 1`;
  return rows.length > 0 ? mapRow(rows[0] as Record<string, unknown>) : null;
}

/** Crea o actualiza un provider. Valida antes de escribir (nunca persiste secretos). */
export async function upsertMorfAiProvider(input: MorfProviderInput): Promise<MorfProviderRecord> {
  await ensureMorfAiProviderTables();
  const existing = await getMorfAiProvider(input.code);
  const record: MorfProviderRecord = {
    code: input.code,
    display_name: input.display_name,
    base_url: input.base_url,
    default_model: input.default_model ?? existing?.default_model ?? null,
    is_enabled: input.is_enabled ?? existing?.is_enabled ?? false,
    is_primary: input.is_primary ?? existing?.is_primary ?? false,
    fallback_priority: input.fallback_priority ?? existing?.fallback_priority ?? null,
    capabilities: input.capabilities ?? existing?.capabilities ?? [],
    metadata: input.metadata ?? existing?.metadata ?? {},
    last_test_status: existing?.last_test_status ?? null,
    last_test_message_sanitized: existing?.last_test_message_sanitized ?? null,
    last_test_at: existing?.last_test_at ?? null,
  };

  const issues = validateMorfProviderRecord(record);
  if (issues.length > 0) {
    throw new MorfProviderRegistryError(
      'INVALID_RECORD',
      'Registro de proveedor inválido',
      issues.map((issue) => `${issue.field}: ${issue.message}`),
    );
  }

  if (existing) {
    await client`
      UPDATE morf_ai_providers SET
        display_name = ${record.display_name},
        base_url = ${record.base_url},
        default_model = ${record.default_model},
        is_enabled = ${record.is_enabled},
        is_primary = ${record.is_primary},
        fallback_priority = ${record.fallback_priority},
        capabilities = ${JSON.stringify(record.capabilities)}::jsonb,
        metadata = ${JSON.stringify(record.metadata)}::jsonb,
        updated_at = NOW()
      WHERE code = ${record.code}
    `;
  } else {
    await client`
      INSERT INTO morf_ai_providers (code, display_name, base_url, default_model, is_enabled, is_primary, fallback_priority, capabilities, metadata)
      VALUES (${record.code}, ${record.display_name}, ${record.base_url}, ${record.default_model}, ${record.is_enabled}, ${record.is_primary}, ${record.fallback_priority}, ${JSON.stringify(record.capabilities)}::jsonb, ${JSON.stringify(record.metadata)}::jsonb)
    `;
  }

  return (await getMorfAiProvider(record.code))!;
}

/** Marca un único primary efectivo (transaccional). El resto queda como fallback. */
export async function setMorfAiPrimaryProvider(code: MorfProviderCode): Promise<MorfProviderRecord> {
  const provider = await getMorfAiProvider(code);
  if (!provider) throw new MorfProviderRegistryError('PROVIDER_NOT_FOUND', `Provider no encontrado: ${code}`);
  if (!provider.is_enabled) {
    throw new MorfProviderRegistryError('INVALID_PROVIDER_SET', 'Un provider deshabilitado no puede ser primary');
  }
  await client.begin(async (tx) => {
    await tx`UPDATE morf_ai_providers SET is_primary = (code = ${code}), updated_at = NOW()`;
  });
  return (await getMorfAiProvider(code))!;
}

export async function setMorfAiProviderEnabled(code: MorfProviderCode, enabled: boolean): Promise<MorfProviderRecord> {
  const provider = await getMorfAiProvider(code);
  if (!provider) throw new MorfProviderRegistryError('PROVIDER_NOT_FOUND', `Provider no encontrado: ${code}`);
  if (!enabled && provider.is_primary) {
    throw new MorfProviderRegistryError('INVALID_PROVIDER_SET', 'Deshabilite el primary después de elegir otro primary');
  }
  await client`
    UPDATE morf_ai_providers SET is_enabled = ${enabled}, updated_at = NOW() WHERE code = ${code}
  `;
  return (await getMorfAiProvider(code))!;
}

/** Persiste el resultado de un test real de conexión (mensaje sanitizado). */
export async function updateMorfAiProviderTestResult(
  code: MorfProviderCode,
  status: 'ok' | 'failed' | 'error',
  message: string,
): Promise<MorfProviderRecord> {
  await client`
    UPDATE morf_ai_providers SET
      last_test_status = ${status},
      last_test_message_sanitized = ${sanitizeMorfAiTestMessage(message)},
      last_test_at = NOW(),
      updated_at = NOW()
    WHERE code = ${code}
  `;
  return (await getMorfAiProvider(code))!;
}

/** Punto de entrada para el runtime (Fase 3): resuelve provider por capability. */
export async function resolveMorfAiProviderFor(options: {
  capability: MorfCapability;
  preferCode?: MorfProviderCode;
}): Promise<MorfProviderResolution> {
  const providers = await listMorfAiProviders();
  return resolveMorfAiProviderFromRecords({
    providers,
    capability: options.capability,
    preferCode: options.preferCode,
    env: process.env as Record<string, string | undefined>,
  });
}

export { getMorfAiApiKeyFromEnv, toMorfProviderConfig, validateMorfProviderSet };
