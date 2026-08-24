// Morf AI — Provider Registry: validación.
// Reglas puras (sin I/O): registro válido, conjunto de registros consistente
// y mensajes sanitizados (los secretos nunca salen de server-side).
// Módulo puro (sin dependencias) para poder testearse sin node_modules.

import { MORF_CAPABILITIES, MORF_PROVIDER_CODES, type MorfCapability, type MorfProviderCode, type MorfProviderRecord } from './types';

export type MorfValidationIssue = { field: string; message: string };

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/i,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-.]{12,}/i,
];

export function isMorfProviderCode(value: unknown): value is MorfProviderCode {
  return typeof value === 'string' && (MORF_PROVIDER_CODES as readonly string[]).includes(value);
}

export function isMorfCapability(value: unknown): value is MorfCapability {
  return typeof value === 'string' && (MORF_CAPABILITIES as readonly string[]).includes(value);
}

export function containsSecretLike(value: unknown): boolean {
  const text = typeof value === 'string' ? value : safeStringify(value);
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return '';
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Valida un registro individual. Devuelve lista vacía si es válido. */
export function validateMorfProviderRecord(record: MorfProviderRecord): MorfValidationIssue[] {
  const issues: MorfValidationIssue[] = [];

  if (!isMorfProviderCode(record.code)) {
    issues.push({ field: 'code', message: `Código de proveedor desconocido: ${String(record.code)}` });
  }
  if (!record.display_name || !String(record.display_name).trim()) {
    issues.push({ field: 'display_name', message: 'Nombre visible requerido' });
  }
  if (!record.base_url || !isValidHttpUrl(record.base_url)) {
    issues.push({ field: 'base_url', message: 'base_url debe ser una URL http(s) válida' });
  }
  if (record.is_enabled && !record.default_model?.trim()) {
    issues.push({ field: 'default_model', message: 'Un provider habilitado necesita modelo por defecto' });
  }
  if (record.is_primary && !record.is_enabled) {
    issues.push({ field: 'is_primary', message: 'Un provider deshabilitado no puede ser primary' });
  }
  if (record.fallback_priority != null && (!Number.isInteger(record.fallback_priority) || record.fallback_priority < 1)) {
    issues.push({ field: 'fallback_priority', message: 'fallback_priority debe ser un entero >= 1 (o null)' });
  }
  if (!Array.isArray(record.capabilities) || record.capabilities.length === 0) {
    issues.push({ field: 'capabilities', message: 'Se requiere al menos una capability' });
  } else {
    for (const capability of record.capabilities) {
      if (!isMorfCapability(capability)) {
        issues.push({ field: 'capabilities', message: `Capability desconocida: ${String(capability)}` });
      }
    }
  }
  if (containsSecretLike(record.metadata)) {
    issues.push({ field: 'metadata', message: 'metadata no debe contener secretos (keys, tokens)' });
  }
  if (record.last_test_message_sanitized && containsSecretLike(record.last_test_message_sanitized)) {
    issues.push({ field: 'last_test_message_sanitized', message: 'El mensaje de prueba debe estar sanitizado (sin secretos)' });
  }

  return issues;
}

/**
 * Valida un conjunto de registros (reglas cruzadas del master prompt §8.1):
 * - solo un primary efectivo (is_primary=true) en todo el conjunto;
 * - primary deshabilitado = error;
 * - si hay providers habilitados, debe existir exactamente un primary habilitado;
 * - fallback_priority únicos y solo entre providers habilitados.
 */
export function validateMorfProviderSet(records: MorfProviderRecord[]): MorfValidationIssue[] {
  const issues: MorfValidationIssue[] = [];
  const seenCodes = new Set<string>();
  const seenPriorities = new Set<number>();

  for (const record of records) {
    if (seenCodes.has(record.code)) {
      issues.push({ field: 'code', message: `Código duplicado: ${record.code}` });
    }
    seenCodes.add(record.code);

    const recordIssues = validateMorfProviderRecord(record);
    for (const issue of recordIssues) {
      issues.push({ field: `${record.code}.${issue.field}`, message: issue.message });
    }

    if (record.fallback_priority != null) {
      if (seenPriorities.has(record.fallback_priority)) {
        issues.push({ field: `${record.code}.fallback_priority`, message: `Prioridad duplicada: ${record.fallback_priority}` });
      }
      seenPriorities.add(record.fallback_priority);
    }
  }

  const primaries = records.filter((record) => record.is_primary);
  if (primaries.length > 1) {
    issues.push({ field: 'is_primary', message: `Solo un primary efectivo permitido (encontrados: ${primaries.map((p) => p.code).join(', ')})` });
  }

  const enabled = records.filter((record) => record.is_enabled);
  if (enabled.length > 0) {
    const enabledPrimaries = enabled.filter((record) => record.is_primary);
    if (enabledPrimaries.length === 0) {
      issues.push({ field: 'is_primary', message: 'Con providers habilitados debe existir exactamente un primary habilitado' });
    }
  }

  return issues;
}

/** Quita secretos de cualquier mensaje antes de persistirlo o devolverlo (§49). */
export function sanitizeMorfAiErrorMessage(message: string): string {
  let sanitized = String(message ?? '');
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized.slice(0, 500);
}

/** Alias legacy usado por el test de conexión (misma política de saneado). */
export function sanitizeMorfAiTestMessage(message: string): string {
  return sanitizeMorfAiErrorMessage(message);
}
