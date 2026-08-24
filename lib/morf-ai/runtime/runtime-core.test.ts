// Morf AI — Fase 3: tests del fallback de ejecución (runtime-core).
// Ejecución: npx --no-install tsx --test lib/morf-ai/runtime/*.test.ts
// El adapter se inyecta (sin red ni DB) para probar el orden de intentos.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MorfProviderConfig } from '../providers/types';
import { MorfAdapterError } from './adapters';
import { runMorfWithFallback } from './runtime-core';
import type { MorfAdapterSuccess, MorfRequest } from './types';

function config(code: MorfProviderConfig['code'], model = 'm'): MorfProviderConfig {
  return {
    code,
    displayName: code,
    baseUrl: `https://${code}.example/v1`,
    model,
    apiKey: 'sk-test',
    capabilities: ['text', 'tool_calling'],
    ready: true,
    status: 'ready',
  };
}

function request(): MorfRequest {
  return { teamId: 1, moduleCode: 'sales_ai', capability: 'tool_calling', messages: [{ role: 'user', content: 'hola' }] };
}

function success(text: string, inputTokens = 10, outputTokens = 3): MorfAdapterSuccess {
  return { text, toolCalls: [], usage: { inputTokens, outputTokens }, model: 'm' };
}

test('RUNTIME-001: primer candidato exitoso devuelve ok con attempted corto', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf'), config('deepseek')],
    callAdapter: async (candidate) => success(`ok de ${candidate.code}`),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.code, 'codemorf');
  assert.deepEqual(result.attempted, ['codemorf']);
  assert.equal(result.text, 'ok de codemorf');
  assert.equal(result.latencyMs >= 0, true);
});

test('RUNTIME-002: fallback al segundo cuando el primero falla (timeout)', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf'), config('deepseek')],
    callAdapter: async (candidate) => {
      if (candidate.code === 'codemorf') throw new MorfAdapterError('timeout', 'Tiempo de espera agotado.');
      return success(`ok de ${candidate.code}`);
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.code, 'deepseek');
  assert.deepEqual(result.attempted, ['codemorf', 'deepseek']);
});

test('RUNTIME-003: fallback encadena errores HTTP y red', async () => {
  const calls: string[] = [];
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf'), config('deepseek'), config('kimi')],
    callAdapter: async (candidate) => {
      calls.push(candidate.code);
      if (candidate.code === 'codemorf') throw new MorfAdapterError('http', 'HTTP 500', 500);
      if (candidate.code === 'deepseek') throw new MorfAdapterError('network', 'Error de red.');
      return success('ok');
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.code, 'kimi');
  assert.deepEqual(calls, ['codemorf', 'deepseek', 'kimi']);
  assert.deepEqual(result.attempted, ['codemorf', 'deepseek', 'kimi']);
});

test('RUNTIME-004: todos fallan -> all_providers_failed con último mensaje', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf'), config('deepseek')],
    callAdapter: async () => {
      throw new MorfAdapterError('timeout', 'Tiempo de espera agotado (100 ms).');
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'all_providers_failed');
  assert.deepEqual(result.attempted, ['codemorf', 'deepseek']);
  assert.match(result.message, /Tiempo de espera/);
});

test('RUNTIME-005: sin candidatos -> all_providers_failed sin intentos', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [],
    callAdapter: async () => success('nunca'),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'all_providers_failed');
  assert.deepEqual(result.attempted, []);
  assert.match(result.message, /Ningún provider/i);
});

test('RUNTIME-006: errores no-MorfAdapter también se capturan y usan su mensaje', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf')],
    callAdapter: async () => {
      throw new Error('boom interno');
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.message, 'boom interno');
});

test('RUNTIME-007: timeoutMs por defecto 60000 se pasa al adapter', async () => {
  let seenTimeout = 0;
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf')],
    callAdapter: async (_candidate, _request, timeoutMs) => {
      seenTimeout = timeoutMs;
      return success('ok');
    },
  });
  assert.equal(result.ok, true);
  assert.equal(seenTimeout, 60000);
});

test('RUNTIME-008: timeoutMs personalizado se respeta', async () => {
  let seenTimeout = 0;
  await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf')],
    timeoutMs: 2500,
    callAdapter: async (_candidate, _request, timeoutMs) => {
      seenTimeout = timeoutMs;
      return success('ok');
    },
  });
  assert.equal(seenTimeout, 2500);
});

test('RUNTIME-009: usage y toolCalls del adapter llegan al resultado', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf')],
    callAdapter: async () => ({
      text: 'con tool',
      toolCalls: [{ name: 'buscar', arguments: { q: 'x' } }],
      usage: { inputTokens: 40, outputTokens: 9 },
      model: 'm-real',
    }),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.toolCalls[0].name, 'buscar');
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 9 });
  assert.equal(result.provider.model, 'm-real');
});

test('RUNTIME-010: respuesta vacía se reintenta y el segundo intento cuenta', async () => {
  let calls = 0;
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf')],
    callAdapter: async () => {
      calls += 1;
      return calls === 1
        ? { text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 0 }, model: 'm' }
        : success('ok tras reintento');
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.text, 'ok tras reintento');
  assert.equal(calls, 2);
});

test('RUNTIME-011: respuestas vacías repetidas agotan el candidato y fallan con mensaje claro', async () => {
  const result = await runMorfWithFallback({
    request: request(),
    candidates: [config('codemorf')],
    callAdapter: async () => ({ text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 0 }, model: 'm' }),
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'all_providers_failed');
  assert.match(result.message, /respuesta vacía/i);
});
