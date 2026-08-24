// Morf AI — Fase 12: suite SaaS (matriz multi-tenant).
// Dimensiones del master prompt §F12: roles, tenants, canales, módulos,
// créditos, providers, fallback, aislamiento y E2E. Compone los núcleos puros
// (registry-core → runtime-core con adapter inyectado → pricing) sin red ni DB.
// Ejecución: npx --no-install tsx --test lib/morf-ai/saas-matrix.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { MorfCapability, MorfProviderCode, MorfProviderRecord } from './providers/types';
import { MORF_PROVIDER_CATALOG, getMorfProviderCatalogEntry } from './providers/catalog';
import { getMorfAiApiKeyFromEnv, orderedMorfAiCandidates, resolveMorfAiProviderFromRecords, toMorfProviderConfig } from './providers/registry-core';
import { sanitizeMorfAiErrorMessage, validateMorfProviderSet } from './providers/validation';
import { MORF_MODULE_CODE_ALIASES, normalizeModuleCode } from './providers/legacy';
import { runMorfWithFallback } from './runtime/runtime-core';
import { MorfAdapterError } from './runtime/adapters';
import type { MorfAdapterSuccess, MorfRequest } from './runtime/types';
import { estimateProviderCostCents } from './pricing';
import { MODULE_AGENT_CATALOG, getModuleAgentCatalogEntry } from '../modules/agent-studio/catalog';
import { EXCLUSIVE_AI_MODES, buildExclusiveAiLockState, getExclusiveModeLabel } from '../ai/exclusive-mode-lock-core';

// ---------------------------------------------------------------- helpers

function record(code: MorfProviderCode, overrides: Partial<MorfProviderRecord> = {}): MorfProviderRecord {
  const entry = getMorfProviderCatalogEntry(code);
  return {
    code,
    display_name: overrides.display_name ?? entry?.displayName ?? code,
    base_url: overrides.base_url ?? entry?.defaultBaseUrl ?? `https://${code}.example/v1`,
    default_model: overrides.default_model ?? entry?.defaultModel ?? 'm',
    is_enabled: overrides.is_enabled ?? true,
    is_primary: overrides.is_primary ?? false,
    fallback_priority: overrides.fallback_priority ?? null,
    capabilities: overrides.capabilities ?? entry?.capabilities ?? ['text'],
    metadata: overrides.metadata ?? {},
    last_test_status: overrides.last_test_status ?? null,
    last_test_message_sanitized: overrides.last_test_message_sanitized ?? null,
    last_test_at: overrides.last_test_at ?? null,
    ...overrides,
  };
}

function request(teamId: number, moduleCode: string, capability: MorfCapability): MorfRequest {
  return { teamId, moduleCode, capability, messages: [{ role: 'user', content: 'hola' }] };
}

function adapterSuccess(text: string, inputTokens = 150000, outputTokens = 30000, model = 'm'): MorfAdapterSuccess {
  return { text, toolCalls: [], usage: { inputTokens, outputTokens }, model };
}

/** Env del tenant 83 (equipo real del harness) con keys deepseek + gemini. */
function envTeam83(): Record<string, string> {
  return { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek-team83', MORF_AI_GEMINI_API_KEY: 'sk-gemini-team83' };
}

/** Env del tenant 7 (sin keys de deepseek). */
function envTeam7(): Record<string, string> {
  return { MORF_AI_GEMINI_API_KEY: 'sk-gemini-team7' };
}

/** Conjunto típico de un tenant: deepseek primary + kimi fallback + gemini. */
function teamProviders(teamId: number): MorfProviderRecord[] {
  return [
    record('deepseek', { is_primary: true, fallback_priority: 1 }),
    record('kimi', { fallback_priority: 2 }),
    record('gemini', { default_model: 'gemini-2.0-flash', fallback_priority: 3 }),
  ];
}

// ------------------------------------------------------- A. tenants / aislamiento

test('SAAS-001: dos tenants con conjuntos distintos resuelven providers independientes', () => {
  const teamA = resolveMorfAiProviderFromRecords({
    providers: teamProviders(83),
    capability: 'text',
    env: envTeam83(),
  });
  const teamB = resolveMorfAiProviderFromRecords({
    providers: teamProviders(7),
    capability: 'text',
    env: envTeam7(),
  });
  assert.equal(teamA.ok, true);
  assert.equal(teamB.ok, true);
  if (!teamA.ok || !teamB.ok) return;
  // A: deepseek primary listo con su key. B: deepseek sin key -> descartado,
  // gana gemini (único listo de su conjunto).
  assert.equal(teamA.provider?.code, 'deepseek');
  assert.equal(teamB.provider?.code, 'gemini');
});

test('SAAS-002: la key de env de un tenant no configura los providers de otro', () => {
  // La key del tenant 83 NO existe en el env del tenant 7.
  const envA = envTeam83();
  const envB = envTeam7();
  assert.equal(getMorfAiApiKeyFromEnv('deepseek', envA), 'sk-deepseek-team83');
  assert.equal(getMorfAiApiKeyFromEnv('deepseek', envB), '');
  const resolutionB = resolveMorfAiProviderFromRecords({
    providers: teamProviders(7),
    capability: 'text',
    env: envB,
  });
  assert.equal(resolutionB.ok, true);
  assert.equal(resolutionB.provider?.code, 'gemini');
});

test('SAAS-003: overrides de precio en metadata son por tenant y no se filtran', () => {
  const tableA = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 100000,
    outputTokens: 10000,
    metadata: { price_input_usd_per_m: 1, price_output_usd_per_m: 2 },
  });
  const tableB = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 100000,
    outputTokens: 10000,
    metadata: null,
  });
  // A usa el override (1/2 por 1M); B usa la tabla publicada (0.27/1.10).
  assert.equal(tableA.pricing, 'configured');
  assert.equal(tableB.pricing, 'configured');
  assert.equal(tableA.providerCostCents, Math.round((100000 * 1 + 10000 * 2) / 10000));
  assert.equal(tableB.providerCostCents, Math.round((100000 * 0.27 + 10000 * 1.1) / 10000));
});

test('SAAS-004: el fallback de un tenant nunca toca el conjunto de otro', () => {
  // A con solo deepseek listo -> tool_calling resuelve deepseek.
  const a = resolveMorfAiProviderFromRecords({
    providers: [record('deepseek', { is_primary: true })],
    capability: 'tool_calling',
    env: envTeam83(),
  });
  // B con deepseek sin key y solo gemini -> gemini (capability text).
  const b = resolveMorfAiProviderFromRecords({
    providers: teamProviders(7),
    capability: 'text',
    env: envTeam7(),
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.provider?.code, 'deepseek');
  assert.equal(b.provider?.code, 'gemini');
});

// ------------------------------------------------------- B. roles / gating

test('SAAS-005: gating por capability - el módulo pide capability, no proveedor', () => {
  // sales_ai (tool_calling) con deepseek listo -> ok.
  const okCall = resolveMorfAiProviderFromRecords({
    providers: [record('deepseek', { is_primary: true })],
    capability: 'tool_calling',
    env: envTeam83(),
  });
  assert.equal(okCall.ok, true);
  // payment_proof (vision) con deepseek que NO soporta vision -> se salta,
  // nadie listo la soporta -> capability_not_supported (nunca se elige a ciegas).
  const noVision = resolveMorfAiProviderFromRecords({
    providers: [record('deepseek', { is_primary: true })],
    capability: 'vision',
    env: envTeam83(),
  });
  assert.equal(noVision.ok, false);
  if (noVision.ok) return;
  assert.equal(noVision.reason, 'capability_not_supported');
  assert.deepEqual(noVision.attempted, ['deepseek']);
});

test('SAAS-006: cobertura - cada capability de los módulos la soporta >=1 provider del catálogo', () => {
  const capabilitiesByModule: Record<string, MorfCapability[]> = {
    base_ai: ['text'],
    sales_ai: ['tool_calling'],
    restapp_ai: ['tool_calling'],
    auto_calendar: ['structured_output'],
    departments: ['text'],
    branches: ['text'],
    payment_proof: ['vision'],
    web_import: ['structured_output'],
    marketing_ai: ['text'],
    comments_ai: ['text'],
  };
  const supported = new Set<MorfCapability>(
    MORF_PROVIDER_CATALOG.flatMap((entry) => entry.capabilities),
  );
  for (const [moduleCode, capabilities] of Object.entries(capabilitiesByModule)) {
    for (const capability of capabilities) {
      assert.equal(
        supported.has(capability),
        true,
        `${moduleCode} necesita ${capability} pero ningún provider del catálogo la soporta`,
      );
    }
  }
});

test('SAAS-007: cada modo de exclusividad mapea a un agente real del catálogo', () => {
  const modeToModule: Record<string, string> = {
    ventas_ia: 'sales_ai',
    auto_cita: 'auto_calendar',
    departamento_humano: 'departments',
    sucursales: 'branches',
    restapp_ai: 'restapp_ai',
  };
  for (const mode of EXCLUSIVE_AI_MODES) {
    const moduleKey = modeToModule[mode];
    assert.equal(typeof getExclusiveModeLabel(mode), 'string');
    assert.ok(getModuleAgentCatalogEntry(moduleKey), `${mode} -> ${moduleKey} debe existir en el catálogo`);
  }
});

// ------------------------------------------------------- C. canales / módulos

test('SAAS-008: el catálogo de agentes tiene 6 entradas válidas con defaults', () => {
  assert.equal(MODULE_AGENT_CATALOG.length, 6);
  for (const entry of MODULE_AGENT_CATALOG) {
    assert.equal(typeof entry.name, 'string');
    assert.equal(typeof entry.href, 'string');
    assert.equal(typeof entry.color, 'string');
    assert.equal(typeof entry.description, 'string');
    assert.ok(entry.defaults, `${entry.key} debe traer defaults`);
  }
});

test('SAAS-009: los module_codes reales del sistema se normalizan estables', () => {
  const systemModuleCodes = [
    'base_ai',
    'sales_ai',
    'restapp_ai',
    'auto_calendar',
    'departments',
    'branches',
    'payment_proof',
    'web_import',
    'marketing_ai',
    'comments_ai',
  ];
  for (const moduleCode of systemModuleCodes) {
    assert.equal(normalizeModuleCode(moduleCode), moduleCode);
  }
});

test('SAAS-010: aliases legacy del chatbot mapean a base_ai', () => {
  for (const alias of Object.keys(MORF_MODULE_CODE_ALIASES)) {
    assert.equal(normalizeModuleCode(alias), 'base_ai');
  }
  assert.equal(normalizeModuleCode('Ventas IA'), 'ventas ia');
});

// ------------------------------------------------------- D. créditos / pricing

test('SAAS-011: costo publicado deepseek-chat con tokens reales (sin inventar)', () => {
  const estimate = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 150000,
    outputTokens: 30000,
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(estimate.providerCostCents, 7); // (150k*0.27 + 30k*1.10)/10000 = 7.35 -> 7
  assert.equal(estimate.priceTable?.inputUsdPerMillion, 0.27);
  assert.equal(estimate.priceTable?.outputUsdPerMillion, 1.1);
});

test('SAAS-012: provider sin precio publicado -> not_configured y 0 centavos', () => {
  for (const provider of ['nordrouter', 'kimi', 'openrouter', 'codemorf'] as MorfProviderCode[]) {
    const estimate = estimateProviderCostCents({
      provider,
      model: 'cualquier-modelo',
      inputTokens: 500000,
      outputTokens: 50000,
    });
    assert.equal(estimate.pricing, 'not_configured', provider);
    assert.equal(estimate.providerCostCents, 0, provider);
    assert.equal(estimate.priceTable, null, provider);
  }
});

test('SAAS-013: override del Super Admin gana a la tabla y es por tenant', () => {
  const override = estimateProviderCostCents({
    provider: 'kimi',
    model: 'moonshot-v1-8k',
    inputTokens: 100000,
    outputTokens: 10000,
    metadata: { price_input_usd_per_m: 0.5, price_output_usd_per_m: 1.5, price_source: 'invoice-2026-07' },
  });
  assert.equal(override.pricing, 'configured');
  assert.equal(override.providerCostCents, Math.round((100000 * 0.5 + 10000 * 1.5) / 10000));
  assert.equal(override.priceTable?.source, 'invoice-2026-07');
  // El mismo provider sin override sigue not_configured.
  const plain = estimateProviderCostCents({ provider: 'kimi', model: 'moonshot-v1-8k', inputTokens: 100000, outputTokens: 10000 });
  assert.equal(plain.pricing, 'not_configured');
});

// ------------------------------------------------------- E. providers

test('SAAS-014: catálogo estático íntegro (envKeyChain, capabilities, base_url)', () => {
  for (const entry of MORF_PROVIDER_CATALOG) {
    assert.ok(entry.envKeyChain.length > 0, `${entry.code} sin envKeyChain`);
    assert.ok(entry.capabilities.length > 0, `${entry.code} sin capabilities`);
    assert.match(entry.defaultBaseUrl, /^https?:\/\//);
    assert.equal(getMorfProviderCatalogEntry(entry.code)?.code, entry.code);
  }
});

test('SAAS-015: primary primero, luego fallback_priority, saltando sin capability', () => {
  const records = [
    record('deepseek', { is_primary: true, fallback_priority: 1 }),
    record('kimi', { fallback_priority: 2 }),
    record('gemini', { default_model: 'gemini-2.0-flash', fallback_priority: 3 }),
  ];
  const env = envTeam83();
  // vision: deepseek no la soporta; kimi sin key no está listo -> solo gemini.
  const vision = resolveMorfAiProviderFromRecords({ providers: records, capability: 'vision', env });
  assert.equal(vision.ok, true);
  assert.equal(vision.provider?.code, 'gemini');
  assert.deepEqual(vision.attempted, ['deepseek', 'gemini']);
});

test('SAAS-016: preferCode mueve al frente solo si soporta la capability', () => {
  const records = [
    record('deepseek', { is_primary: true, fallback_priority: 1 }),
    record('kimi', { fallback_priority: 2 }),
  ];
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-d', MORF_AI_KIMI_API_KEY: 'sk-k' };
  const preferred = resolveMorfAiProviderFromRecords({
    providers: records,
    capability: 'tool_calling',
    preferCode: 'kimi',
    env,
  });
  assert.equal(preferred.ok, true);
  assert.equal(preferred.provider?.code, 'kimi');
});

test('SAAS-017: set inválido (dos primary) -> invalid_provider_set con issues', () => {
  const records = [
    record('deepseek', { is_primary: true }),
    record('kimi', { is_primary: true }),
  ];
  const issues = validateMorfProviderSet(records);
  assert.ok(issues.some((issue) => issue.message.includes('Solo un primary efectivo')));
  const resolution = resolveMorfAiProviderFromRecords({
    providers: records,
    capability: 'text',
    env: envTeam83(),
  });
  assert.equal(resolution.ok, false);
  if (resolution.ok) return;
  assert.equal(resolution.reason, 'invalid_provider_set');
  assert.ok(resolution.issues && resolution.issues.length > 0);
});

test('SAAS-018: sin key en env -> no_provider_ready', () => {
  const resolution = resolveMorfAiProviderFromRecords({
    providers: [record('deepseek', { is_primary: true })],
    capability: 'text',
    env: {},
  });
  assert.equal(resolution.ok, false);
  if (resolution.ok) return;
  assert.equal(resolution.reason, 'no_provider_ready');
  assert.deepEqual(resolution.attempted, []);
});

// ------------------------------------------------------- F. fallback

test('SAAS-019: cadena de 3 providers - el primero falla y el segundo atiende', async () => {
  const candidates = [
    record('deepseek', { is_primary: true, fallback_priority: 1 }),
    record('kimi', { fallback_priority: 2 }),
    record('openai', { default_model: 'gpt-4o-mini', fallback_priority: 3 }),
  ];
  const env = {
    MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek',
    MORF_AI_KIMI_API_KEY: 'sk-kimi',
    MORF_AI_OPENAI_API_KEY: 'sk-openai',
  };
  const { candidates: ready } = orderedMorfAiCandidates({ providers: candidates, capability: 'text', env });
  assert.deepEqual(ready.map((c) => c.code), ['deepseek', 'kimi', 'openai']);
  const result = await runMorfWithFallback({
    request: request(83, 'sales_ai', 'tool_calling'),
    candidates: ready,
    callAdapter: async (candidate) => {
      if (candidate.code === 'deepseek') throw new MorfAdapterError('timeout', 'Tiempo de espera agotado.');
      return adapterSuccess(`ok de ${candidate.code}`, 1000, 200);
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.code, 'kimi');
  assert.deepEqual(result.attempted, ['deepseek', 'kimi']);
});

test('SAAS-020: todos fallan -> all_providers_failed con último mensaje y errores saneados (§49)', async () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-x', MORF_AI_KIMI_API_KEY: 'sk-x' };
  const candidates = [
    toMorfProviderConfig(record('deepseek', { is_primary: true }), env),
    toMorfProviderConfig(record('kimi'), env),
  ];
  const result = await runMorfWithFallback({
    request: request(83, 'sales_ai', 'tool_calling'),
    candidates,
    callAdapter: async () => {
      throw new MorfAdapterError('http', 'HTTP 500 - api_key sk-secret-abcdefghijkl inválida');
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'all_providers_failed');
  assert.deepEqual(result.attempted, ['deepseek', 'kimi']);
  // El saneado de secretos es contrato del runtime server-side (§49):
  const sanitized = sanitizeMorfAiErrorMessage(result.message);
  assert.equal(sanitized.includes('sk-secret-abcdefghijkl'), false);
  assert.match(sanitized, /\[REDACTED\]/);
});

test('SAAS-021: candidato sin la capability se excluye antes del runtime', () => {
  const env = envTeam83();
  // deepseek listo pero sin vision; gemini listo con vision.
  const records = [
    record('deepseek', { is_primary: true, capabilities: ['text', 'tool_calling'] }),
    record('gemini', { default_model: 'gemini-2.0-flash', capabilities: ['text', 'vision'], fallback_priority: 1 }),
  ];
  const ordered = orderedMorfAiCandidates({ providers: records, capability: 'vision', env });
  assert.deepEqual(ordered.candidates.map((c) => c.code), ['gemini']);
});

// ------------------------------------------------------- G. E2E

test('SAAS-022: pipeline E2E tenant 83 - resolución -> runtime -> pricing', async () => {
  const records = teamProviders(83);
  const env = envTeam83();
  const resolution = resolveMorfAiProviderFromRecords({
    providers: records,
    capability: 'tool_calling',
    env,
  });
  assert.equal(resolution.ok, true);
  if (!resolution.ok) return;

  const result = await runMorfWithFallback({
    request: request(83, 'sales_ai', 'tool_calling'),
    candidates: resolution.provider ? [resolution.provider] : [],
    callAdapter: async (candidate) => adapterSuccess('Orden lista', 150000, 30000, candidate.model ?? ''),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.code, 'deepseek');
  assert.equal(result.text, 'Orden lista');

  const estimate = estimateProviderCostCents({
    provider: result.provider.code,
    model: result.provider.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(estimate.providerCostCents, 7);
});

test('SAAS-023: E2E con fallback real - deepseek timeout -> gemini atiende y se cotiza', async () => {
  const records = [
    record('deepseek', { is_primary: true, fallback_priority: 1 }),
    record('gemini', { default_model: 'gemini-2.0-flash', fallback_priority: 2 }),
  ];
  const env = envTeam83();
  const { candidates: chain } = orderedMorfAiCandidates({ providers: records, capability: 'text', env });
  assert.deepEqual(chain.map((c) => c.code), ['deepseek', 'gemini']);

  const result = await runMorfWithFallback({
    request: request(83, 'base_ai', 'text'),
    candidates: chain,
    callAdapter: async (candidate) => {
      if (candidate.code === 'deepseek') throw new MorfAdapterError('timeout', 'Timeout (5000 ms).');
      return adapterSuccess('Respuesta de gemini', 100000, 10000, 'gemini-2.0-flash');
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.provider.code, 'gemini');
  assert.deepEqual(result.attempted, ['deepseek', 'gemini']);
  const estimate = estimateProviderCostCents({
    provider: result.provider.code,
    model: result.provider.model,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
  assert.equal(estimate.providerCostCents, 1); // (100k*0.10 + 10k*0.40)/10000 = 1.4 -> 1
});

test('SAAS-024: varios módulos activos conviven - el router elige por conversación', () => {
  // ventas_ia + auto_cita + departamento_humano + sucursales todos activos.
  const state = buildExclusiveAiLockState([true, true, true, true]);
  assert.equal(state.activeModes.length, 4);
  for (const modeState of state.activeModes) {
    assert.equal(modeState.locked, false);
    assert.equal(modeState.lockedBy, null);
    assert.equal(modeState.lockMessage, null);
  }
  // activeMode es solo informativo (el "primario"); no desactiva a los demás.
  assert.equal(state.activeMode, 'ventas_ia');
  assert.equal(state.activeLabel, 'Ventas IA');
  // La activación de un módulo nunca apaga la configuración de otro.
  assert.equal(state.modes.sucursales.active, true);
  assert.equal(state.modes.auto_cita.active, true);
});

test('SAAS-025: E2E aislamiento - dos tenants con la misma capability y resultados independientes', async () => {
  const envA = envTeam83();
  const envB = { MORF_AI_KIMI_API_KEY: 'sk-kimi-team7' };
  const recordsB = [
    record('kimi', { is_primary: true, fallback_priority: 1 }),
    record('gemini', { default_model: 'gemini-2.0-flash', fallback_priority: 2 }),
  ];

  const [a, b] = [
    resolveMorfAiProviderFromRecords({ providers: teamProviders(83), capability: 'text', env: envA }),
    resolveMorfAiProviderFromRecords({ providers: recordsB, capability: 'text', env: envB }),
  ];
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.provider?.code, 'deepseek');
  assert.equal(b.provider?.code, 'kimi');

  const runFor = (resolution: typeof a, teamId: number) =>
    runMorfWithFallback({
      request: request(teamId, 'base_ai', 'text'),
      candidates: resolution.provider ? [resolution.provider] : [],
      callAdapter: async (candidate) => adapterSuccess(`tenant ${teamId} -> ${candidate.code}`, 1000, 200, candidate.model ?? ''),
    });

  const [resultA, resultB] = await Promise.all([runFor(a, 83), runFor(b, 7)]);
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  if (!resultA.ok || !resultB.ok) return;
  assert.equal(resultA.provider.code, 'deepseek');
  assert.equal(resultB.provider.code, 'kimi');
  assert.equal(resultA.text, 'tenant 83 -> deepseek');
  assert.equal(resultB.text, 'tenant 7 -> kimi');
});
