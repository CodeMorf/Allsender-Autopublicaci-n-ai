// Morf AI — Test de conexión real por proveedor.
// "Probar conexión" (master prompt §FASE 2) debe ser una petición HTTP real,
// no un chequeo de presencia de key. Este módulo es puro (fetch + node:test).

import type { MorfProviderTestKind } from './catalog';
import { buildMorfChatUrl, normalizeMorfBaseUrl } from './api-shape';
import { sanitizeMorfAiTestMessage } from './validation';

export type MorfTestConnectionInput = {
  kind: MorfProviderTestKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs?: number;
};

export type MorfTestConnectionResult = {
  ok: boolean;
  status: number;
  latencyMs: number;
  message: string;
};

export class MorfTestConnectionError extends Error {
  code: 'invalid_base_url' | 'missing_model' | 'missing_api_key';
  constructor(code: 'invalid_base_url' | 'missing_model' | 'missing_api_key', message: string) {
    super(message);
    this.name = 'MorfTestConnectionError';
    this.code = code;
  }
}

export function buildMorfAiTestUrl(kind: MorfProviderTestKind, baseUrl: string, model: string) {
  return buildMorfChatUrl(kind, baseUrl, model);
}

export function buildMorfAiTestPayload(kind: MorfProviderTestKind, model: string) {
  if (kind === 'gemini') {
    return { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] };
  }
  return { model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 };
}

export async function testMorfAiProviderConnection(input: MorfTestConnectionInput): Promise<MorfTestConnectionResult> {
  const baseUrl = normalizeMorfBaseUrl(input.baseUrl);
  const model = String(input.model || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  const timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : 15000;

  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new MorfTestConnectionError('invalid_base_url', 'La URL base del proveedor no es válida.');
  }
  if (!model) {
    throw new MorfTestConnectionError('missing_model', 'El proveedor necesita un modelo para probar la conexión.');
  }
  if (!apiKey) {
    throw new MorfTestConnectionError('missing_api_key', 'El proveedor no tiene key configurada.');
  }

  const url = buildMorfAiTestUrl(input.kind, baseUrl, model);
  const payload = buildMorfAiTestPayload(input.kind, model);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (input.kind === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const latencyMs = Date.now() - startedAt;

    if (res.ok) {
      return { ok: true, status: res.status, latencyMs, message: `HTTP ${res.status} — conexión OK (${latencyMs} ms)` };
    }

    let detail = '';
    try {
      const text = await res.text();
      detail = sanitizeMorfAiTestMessage(text.slice(0, 200));
    } catch {
      detail = '';
    }
    const message = `HTTP ${res.status}${detail ? ` — ${detail}` : ''}`;
    return { ok: false, status: res.status, latencyMs, message: sanitizeMorfAiTestMessage(message) };
  } catch (error: any) {
    const latencyMs = Date.now() - startedAt;
    const cause = error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? `tiempo de espera agotado (${timeoutMs} ms)`
      : String(error?.message || 'error de red');
    return { ok: false, status: 0, latencyMs, message: sanitizeMorfAiTestMessage(`No se pudo conectar: ${cause}`) };
  }
}
