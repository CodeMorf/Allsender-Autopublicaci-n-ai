// Morf AI — Runtime (Fase 3): ejecución con fallback por proveedor.
// Prueba los candidatos en orden (primary → prioridad) y avanza al siguiente
// ante error de adapter (timeout, red, HTTP, respuesta inválida), registrando
// los intentados (§29.2). Una respuesta HTTP 200 sin texto ni tool calls
// (gateway vacío/transitorio) se reintenta sobre el mismo candidato antes de
// saltar al siguiente. Puro: recibe el callAdapter por inyección para
// testearse sin red ni DB.

import type { MorfProviderConfig } from '../providers/types';
import { MorfAdapterError } from './adapters';
import type { MorfAdapterSuccess, MorfGenerateResult, MorfRequest } from './types';

export type MorfAdapterCall = (
  config: MorfProviderConfig,
  request: MorfRequest,
  timeoutMs: number,
) => Promise<MorfAdapterSuccess>;

export type MorfFallbackOptions = {
  request: MorfRequest;
  candidates: MorfProviderConfig[];
  timeoutMs?: number;
  callAdapter: MorfAdapterCall;
};

const EMPTY_RETRY_MS = 800;
const MAX_EMPTY_ATTEMPTS = 2;

export async function runMorfWithFallback(options: MorfFallbackOptions): Promise<MorfGenerateResult> {
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : 60000;
  const attempted: string[] = [];
  const startedAt = Date.now();
  let lastError: string | null = null;

  for (const candidate of options.candidates) {
    attempted.push(candidate.code);
    try {
      let result = await options.callAdapter(candidate, options.request, timeoutMs);
      let emptyAttempts = 1;
      while (
        emptyAttempts < MAX_EMPTY_ATTEMPTS &&
        !String(result.text || '').trim() &&
        (!result.toolCalls || result.toolCalls.length === 0)
      ) {
        emptyAttempts += 1;
        lastError = `respuesta vacía de ${candidate.code}${result.model ? ` (${result.model})` : ''} (intento ${emptyAttempts - 1}/${MAX_EMPTY_ATTEMPTS})`;
        await new Promise((resolve) => setTimeout(resolve, EMPTY_RETRY_MS));
        result = await options.callAdapter(candidate, options.request, timeoutMs);
      }
      const isEmpty = !String(result.text || '').trim() && (!result.toolCalls || result.toolCalls.length === 0);
      if (isEmpty) {
        lastError = `respuesta vacía de ${candidate.code}${result.model ? ` (${result.model})` : ''}`;
        continue;
      }
      return {
        ok: true,
        text: result.text,
        toolCalls: result.toolCalls,
        usage: result.usage,
        provider: { code: candidate.code, model: result.model || candidate.model || '' },
        attempted,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof MorfAdapterError) {
        lastError = error.message;
      } else {
        lastError = error instanceof Error ? error.message : 'Error desconocido del proveedor';
      }
    }
  }

  return {
    ok: false,
    reason: 'all_providers_failed',
    message: lastError || 'Ningún provider disponible.',
    attempted,
    latencyMs: Date.now() - startedAt,
  };
}
