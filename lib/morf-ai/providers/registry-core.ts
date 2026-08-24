// Morf AI — Provider Registry: núcleo de resolución (puro, sin I/O).
// Selecciona el provider para una capability siguiendo el master prompt §8.1:
// - fallback solo entre providers enabled/ready (key presente + modelo configurado);
// - primary primero, luego fallback_priority, luego orden estable por código;
// - si un provider preferido no soporta la capability, se continúa con los demás;
// - conjunto inconsistente => falla con issues (nunca elige "a ciegas").
// Módulo puro (sin dependencias) para poder testearse sin node_modules.

import { getMorfProviderCatalogEntry } from './catalog';
import { validateMorfProviderSet, type MorfValidationIssue } from './validation';
import type { MorfCapability, MorfProviderCode, MorfProviderConfig, MorfProviderRecord, MorfProviderResolution, MorfProviderStatus } from './types';

export type MorfProviderEnv = Record<string, string | undefined>;

/** Lee la key del proveedor siguiendo su cadena de variables de entorno. */
export function getMorfAiApiKeyFromEnv(code: MorfProviderCode, env: MorfProviderEnv): string {
  const entry = getMorfProviderCatalogEntry(code);
  if (!entry) return '';
  for (const key of entry.envKeyChain) {
    const value = env[key] ?? '';
    if (value.trim()) return value.trim();
  }
  return '';
}

/** Calcula el estado de un registro contra el entorno actual. */
export function toMorfProviderConfig(record: MorfProviderRecord, env: MorfProviderEnv): MorfProviderConfig {
  const apiKey = getMorfAiApiKeyFromEnv(record.code, env);
  let status: MorfProviderStatus;
  if (!record.is_enabled) {
    status = 'disabled';
  } else if (!apiKey) {
    status = 'missing_key';
  } else if (!record.default_model?.trim()) {
    status = 'missing_model';
  } else if (record.last_test_status && record.last_test_status !== 'ok') {
    status = 'error';
  } else {
    status = 'ready';
  }
  return {
    code: record.code,
    displayName: record.display_name,
    baseUrl: record.base_url,
    model: record.default_model,
    apiKey,
    capabilities: record.capabilities,
    ready: status === 'ready',
    status,
  };
}

export type MorfProviderResolutionOptions = {
  providers: MorfProviderRecord[];
  capability: MorfCapability;
  preferCode?: MorfProviderCode;
  env?: MorfProviderEnv;
};

function formatIssues(issues: MorfValidationIssue[]): string[] {
  return issues.map((issue) => `${issue.field}: ${issue.message}`);
}

export type MorfCandidatesResult = {
  /** Proveedores listos (enabled + key + modelo) ordenados por prioridad de ejecución. */
  candidates: MorfProviderConfig[];
  /** Códigos listos considerados en orden (para el fallback del runtime §29.2). */
  attempted: string[];
  issues: string[];
};

/**
 * Candidatos listos para ejecutar una capability, en orden de intento:
 * preferCode (si soporta la capability) → primary → fallback_priority → código.
 * Solo participan providers enabled con key y modelo configurado (§29.1).
 * Conjunto inconsistente => issues (nunca elegir a ciegas, §8.1).
 */
export function orderedMorfAiCandidates(options: {
  providers: MorfProviderRecord[];
  capability: MorfCapability;
  preferCode?: MorfProviderCode;
  env?: MorfProviderEnv;
}): MorfCandidatesResult {
  const env = options.env ?? {};
  const issues = validateMorfProviderSet(options.providers);
  if (issues.length > 0) {
    return { candidates: [], attempted: [], issues: formatIssues(issues) };
  }

  const ready = options.providers
    .filter((record) => {
      const key = getMorfAiApiKeyFromEnv(record.code, env);
      return record.is_enabled && Boolean(key) && Boolean(record.default_model?.trim());
    })
    .sort((a, b) => {
      if (Boolean(a.is_primary) !== Boolean(b.is_primary)) return a.is_primary ? -1 : 1;
      const pa = a.fallback_priority ?? Number.MAX_SAFE_INTEGER;
      const pb = b.fallback_priority ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.code.localeCompare(b.code);
    });

  const attempted = ready.map((record) => record.code);
  const capable = ready
    .filter((record) => record.capabilities.includes(options.capability))
    .map((record) => toMorfProviderConfig(record, env));

  if (options.preferCode) {
    const preferredIndex = capable.findIndex((config) => config.code === options.preferCode);
    if (preferredIndex >= 0) {
      const [preferred] = capable.splice(preferredIndex, 1);
      capable.unshift(preferred);
    }
  }

  return { candidates: capable, attempted, issues: [] };
}

/**
 * Resuelve el provider a usar para una capability.
 * Devuelve ok:false con reason cuando no hay candidato (MORF-001..003 y
 * reglas de set del master prompt §8.1).
 */
export function resolveMorfAiProviderFromRecords(options: MorfProviderResolutionOptions): MorfProviderResolution {
  const { candidates, attempted, issues } = orderedMorfAiCandidates({
    providers: options.providers,
    capability: options.capability,
    preferCode: options.preferCode,
    env: options.env,
  });

  if (issues.length > 0) {
    return { ok: false, attempted: [], reason: 'invalid_provider_set', issues };
  }

  if (options.preferCode) {
    const preferred = candidates.find((config) => config.code === options.preferCode);
    if (preferred) {
      return { ok: true, provider: preferred, attempted };
    }
  }

  if (candidates.length > 0) {
    return { ok: true, provider: candidates[0], attempted };
  }

  const reason = attempted.length === 0 ? 'no_provider_ready' : 'capability_not_supported';
  return { ok: false, attempted, reason };
}

/** Re-export para consumo externo (Fase 3 runtime). */
export { validateMorfProviderSet };
export type { MorfValidationIssue };
