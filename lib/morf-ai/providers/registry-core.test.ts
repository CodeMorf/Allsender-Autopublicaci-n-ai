// Morf AI — Fase 1: tests del provider registry (núcleo puro).
// Ejecución: npx --no-install tsx --test lib/morf-ai/providers/*.test.ts
// Cubre: catálogo (MORF-001..003 base), legacy mappings, validación de
// registro y de conjunto (§8.1), cadenas de env y resolución por capability.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MORF_PROVIDER_CATALOG, getMorfProviderCatalogEntry } from './catalog';
import { MORF_CAPABILITIES, MORF_PROVIDER_CODES, type MorfCapability, type MorfProviderCode, type MorfProviderRecord } from './types';
import {
  containsSecretLike,
  isMorfCapability,
  isMorfProviderCode,
  sanitizeMorfAiTestMessage,
  validateMorfProviderRecord,
  validateMorfProviderSet,
} from './validation';
import { MORF_MODULE_CODE_ALIASES, mapLegacyProviderToMorf, normalizeMorfProvider, normalizeModuleCode } from './legacy';
import { getMorfAiApiKeyFromEnv, orderedMorfAiCandidates, resolveMorfAiProviderFromRecords, toMorfProviderConfig } from './registry-core';

const EMPTY_ENV: Record<string, string | undefined> = {};

function record(overrides: Partial<MorfProviderRecord> = {}): MorfProviderRecord {
  return {
    code: 'deepseek',
    display_name: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    default_model: 'deepseek-chat',
    is_enabled: true,
    is_primary: false,
    fallback_priority: 1,
    capabilities: ['text', 'structured_output', 'tool_calling', 'classification'],
    metadata: {},
    last_test_status: null,
    last_test_message_sanitized: null,
    last_test_at: null,
    ...overrides,
  };
}

function recordsFor(env: Record<string, string | undefined>): MorfProviderRecord[] {
  return MORF_PROVIDER_CATALOG.map((entry, index) =>
    record({
      code: entry.code,
      display_name: entry.displayName,
      base_url: entry.defaultBaseUrl,
      default_model: entry.defaultModel,
      is_enabled: entry.code === 'codemorf',
      is_primary: entry.code === 'codemorf',
      fallback_priority: index + 1,
      capabilities: entry.capabilities,
    }),
  );
}

// --- Catálogo ---------------------------------------------------------------

test('MORF-CAT-001: catálogo con códigos únicos y conocidos', () => {
  const codes = MORF_PROVIDER_CATALOG.map((entry) => entry.code);
  assert.equal(new Set(codes).size, codes.length, 'códigos duplicados');
  for (const code of codes) {
    assert.ok(isMorfProviderCode(code), `código fuera del union: ${code}`);
  }
  assert.deepEqual(new Set(codes), new Set(MORF_PROVIDER_CODES));
});

test('MORF-CAT-002: cadenas de env no vacías y sin secretos hardcodeados', () => {
  for (const entry of MORF_PROVIDER_CATALOG) {
    assert.ok(entry.envKeyChain.length > 0, `${entry.code} sin cadena de env`);
    for (const key of entry.envKeyChain) {
      assert.ok(/^[A-Z][A-Z0-9_]*$/.test(key), `${entry.code} cadena inválida: ${key}`);
    }
    assert.equal(containsSecretLike(entry), false, `${entry.code} contiene secretos`);
  }
});

test('MORF-CAT-003: capabilities declaradas son válidas y no vacías', () => {
  for (const entry of MORF_PROVIDER_CATALOG) {
    assert.ok(entry.capabilities.length > 0, `${entry.code} sin capabilities`);
    for (const capability of entry.capabilities) {
      assert.ok(isMorfCapability(capability), `${entry.code} capability inválida: ${capability}`);
    }
  }
});

test('MORF-CAT-004: catálogo incluye los 5 objetivo + 2 legacy', () => {
  for (const code of ['codemorf', 'nordrouter', 'deepseek', 'kimi', 'openai']) {
    assert.ok(getMorfProviderCatalogEntry(code as MorfProviderCode), `falta ${code}`);
  }
  for (const code of ['openrouter', 'gemini']) {
    const entry = getMorfProviderCatalogEntry(code as MorfProviderCode);
    assert.ok(entry, `falta legacy ${code}`);
    if (!entry) continue;
    assert.equal(entry.legacy, true, `${code} debe marcarse legacy`);
  }
});

// --- Legacy mappings ---------------------------------------------------------

test('LEGACY-001: normalizeMorfProvider conserva legacy y conoce los nuevos', () => {
  assert.equal(normalizeMorfProvider('openrouter'), 'openrouter');
  assert.equal(normalizeMorfProvider('openai'), 'openai');
  assert.equal(normalizeMorfProvider('gemini'), 'gemini');
  assert.equal(normalizeMorfProvider('deepseek'), 'deepseek');
  assert.equal(normalizeMorfProvider('kimi'), 'kimi');
  assert.equal(normalizeMorfProvider('codemorf'), 'codemorf');
  assert.equal(normalizeMorfProvider('nordrouter'), 'nordrouter');
  assert.equal(normalizeMorfProvider(' OpenRouter '), 'openrouter');
  assert.equal(normalizeMorfProvider('moonshot'), 'kimi');
  assert.equal(normalizeMorfProvider('cualquier-cosa'), 'gemini'); // comportamiento legacy
});

test('LEGACY-002: mapLegacyProviderToMorf = normalize (compat ai_configs)', () => {
  assert.equal(mapLegacyProviderToMorf('openrouter'), 'openrouter');
  assert.equal(mapLegacyProviderToMorf('gemini'), 'gemini');
});

test('LEGACY-003: aliases de módulo chatbot apuntan a base_ai', () => {
  for (const alias of Object.keys(MORF_MODULE_CODE_ALIASES)) {
    assert.equal(normalizeModuleCode(alias), 'base_ai', `${alias} -> base_ai`);
  }
  assert.equal(normalizeModuleCode('base_ai'), 'base_ai');
  assert.equal(normalizeModuleCode('sales_ai'), 'sales_ai');
  assert.equal(normalizeModuleCode('payment_proof'), 'payment_proof');
});

// --- Validación de registro ---------------------------------------------------

test('VALID-001: registro válido pasa sin issues', () => {
  assert.deepEqual(validateMorfProviderRecord(record()), []);
});

test('VALID-002: primary deshabilitado es inválido (§8.1)', () => {
  const issues = validateMorfProviderRecord(record({ is_primary: true, is_enabled: false }));
  assert.ok(issues.some((issue) => issue.field === 'is_primary'));
});

test('VALID-003: habilitado sin modelo por defecto es inválido', () => {
  const issues = validateMorfProviderRecord(record({ is_enabled: true, default_model: null }));
  assert.ok(issues.some((issue) => issue.field === 'default_model'));
});

test('VALID-004: base_url inválida y capability desconocida', () => {
  const issues = validateMorfProviderRecord(
    record({ base_url: 'not-a-url', capabilities: ['text', 'telepathy' as MorfCapability] }),
  );
  assert.ok(issues.some((issue) => issue.field === 'base_url'));
  assert.ok(issues.some((issue) => issue.field === 'capabilities'));
});

test('VALID-005: metadata con secretos es inválida (§7)', () => {
  const issues = validateMorfProviderRecord(record({ metadata: { note: 'key=sk-abc123def456ghi' } }));
  assert.ok(issues.some((issue) => issue.field === 'metadata'));
});

test('VALID-006: sanitizeMorfAiTestMessage redacta secretos', () => {
  const sanitized = sanitizeMorfAiTestMessage('fallo con api_key=sk-or-v1-1234567890abcdef');
  assert.ok(!/sk-or-v1-1234567890abcdef/.test(sanitized));
  assert.ok(sanitized.includes('[REDACTED]'));
});

// --- Validación de conjunto ---------------------------------------------------

test('SET-001: dos primaries es inválido', () => {
  const issues = validateMorfProviderSet([
    record({ code: 'codemorf', is_primary: true }),
    record({ code: 'deepseek', is_primary: true }),
  ]);
  assert.ok(issues.some((issue) => issue.field === 'is_primary'));
});

test('SET-002: habilitados sin primary es inválido', () => {
  const issues = validateMorfProviderSet([record({ code: 'deepseek', is_primary: false })]);
  assert.ok(issues.some((issue) => issue.field === 'is_primary'));
});

test('SET-003: prioridades duplicadas es inválido', () => {
  const issues = validateMorfProviderSet([
    record({ code: 'deepseek', fallback_priority: 1 }),
    record({ code: 'openai', fallback_priority: 1 }),
  ]);
  assert.ok(issues.some((issue) => issue.message.includes('Prioridad duplicada')));
});

test('SET-004: seed de migración (solo codemorf enabled+primary) es válido', () => {
  const issues = validateMorfProviderSet(recordsFor(EMPTY_ENV));
  assert.deepEqual(issues, []);
});

// --- Cadenas de env ------------------------------------------------------------

test('ENV-001: key se lee por cadena, primera variable gana', () => {
  const chain = getMorfProviderCatalogEntry('openai')!.envKeyChain;
  assert.ok(chain.length >= 2);
  const env = { [chain[0]]: 'first', [chain[1]]: 'second' };
  assert.equal(getMorfAiApiKeyFromEnv('openai', env), 'first');
  const env2 = { [chain[1]]: 'second' };
  assert.equal(getMorfAiApiKeyFromEnv('openai', env2), 'second');
});

test('ENV-002: sin key en cadena devuelve vacío', () => {
  assert.equal(getMorfAiApiKeyFromEnv('kimi', EMPTY_ENV), '');
});

// --- Resolución (MORF-001..003) -------------------------------------------------

test('MORF-001: primary healthy es elegido', () => {
  const env = { MORF_AI_CODEMORF_API_KEY: 'sk-codemorf' };
  const result = resolveMorfAiProviderFromRecords({
    providers: recordsFor(env),
    capability: 'text',
    env,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider?.code, 'codemorf');
  assert.deepEqual(result.attempted, ['codemorf']);
});

test('MORF-002: primary sin key cae al fallback ready por prioridad', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek' };
  const providers = recordsFor(env).map((p) =>
    p.code === 'deepseek' ? { ...p, is_enabled: true } : p,
  );
  const result = resolveMorfAiProviderFromRecords({
    providers,
    capability: 'text',
    env,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider?.code, 'deepseek');
  assert.deepEqual(result.attempted, ['deepseek']);
});

test('MORF-003: primary sin capability deriva al que la tiene', () => {
  const env = {
    MORF_AI_CODEMORF_API_KEY: 'sk-codemorf',
    MORF_AI_KIMI_API_KEY: 'sk-kimi',
  };
  const codemorf = recordsFor(env).find((p) => p.code === 'codemorf')!;
  const kimi = recordsFor(env).find((p) => p.code === 'kimi')!;
  const providers = [
    { ...codemorf, capabilities: ['text', 'structured_output'] as MorfCapability[] },
    { ...kimi, is_enabled: true, capabilities: ['text', 'vision'] as MorfCapability[] },
    ...recordsFor(env).filter((p) => p.code !== 'codemorf' && p.code !== 'kimi'),
  ];
  const result = resolveMorfAiProviderFromRecords({ providers, capability: 'vision', env });
  assert.equal(result.ok, true);
  assert.equal(result.provider?.code, 'kimi');
  assert.deepEqual(result.attempted, ['codemorf', 'kimi']);
});

test('RES-001: preferCode respetado cuando soporta la capability (aunque no sea el de menor prioridad)', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek', MORF_AI_OPENAI_API_KEY: 'sk-openai' };
  const providers = recordsFor(env).map((p) =>
    p.code === 'openai' ? { ...p, is_enabled: true } : p,
  );
  const result = resolveMorfAiProviderFromRecords({
    providers,
    capability: 'vision',
    preferCode: 'openai',
    env,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider?.code, 'openai');
  assert.deepEqual(result.attempted, ['openai']);
});

test('RES-002: preferCode sin capability continúa con los demás', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek', MORF_AI_OPENAI_API_KEY: 'sk-openai' };
  const providers = recordsFor(env).map((p) => {
    if (p.code === 'deepseek') return { ...p, is_enabled: true, capabilities: ['text'] as MorfCapability[] };
    if (p.code === 'openai') return { ...p, is_enabled: true };
    return p;
  });
  const result = resolveMorfAiProviderFromRecords({
    providers,
    capability: 'vision',
    preferCode: 'deepseek',
    env,
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider?.code, 'openai');
  assert.deepEqual(result.attempted, ['deepseek', 'openai']);
});

test('RES-003: sin providers ready -> no_provider_ready', () => {
  const result = resolveMorfAiProviderFromRecords({
    providers: recordsFor(EMPTY_ENV),
    capability: 'text',
    env: EMPTY_ENV,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no_provider_ready');
  assert.deepEqual(result.attempted, []);
});

test('RES-004: conjunto inválido -> invalid_provider_set (nunca elige a ciegas)', () => {
  const providers = [
    record({ code: 'codemorf', is_primary: true }),
    record({ code: 'deepseek', is_primary: true }),
  ];
  const result = resolveMorfAiProviderFromRecords({ providers, capability: 'text', env: EMPTY_ENV });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid_provider_set');
  assert.ok((result.issues ?? []).length > 0);
});

test('RES-005: toMorfProviderConfig mapea estados', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek' };
  assert.equal(toMorfProviderConfig(record({ is_enabled: false }), env).status, 'disabled');
  assert.equal(toMorfProviderConfig(record({ is_enabled: true }), EMPTY_ENV).status, 'missing_key');
  assert.equal(
    toMorfProviderConfig(record({ is_enabled: true, default_model: null }), env).status,
    'missing_model',
  );
  assert.equal(toMorfProviderConfig(record({ is_enabled: true }), env).status, 'ready');
  assert.equal(
    toMorfProviderConfig(record({ is_enabled: true, last_test_status: 'failed' }), env).status,
    'error',
  );
});

test('RES-006: fallback_order estable (mismo resultado sin importar orden de entrada)', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek', MORF_AI_KIMI_API_KEY: 'sk-kimi' };
  const providers = recordsFor(env).map((p) =>
    p.code === 'deepseek' || p.code === 'kimi' ? { ...p, is_enabled: true } : p,
  ).reverse();
  const result = resolveMorfAiProviderFromRecords({ providers, capability: 'text', env });
  assert.equal(result.ok, true);
  assert.equal(result.provider?.code, 'deepseek');
});

// --- Candidatos para el runtime (CAND) --------------------------------------

test('CAND-001: solo ready entran; orden = primary, prioridad, código', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek', MORF_AI_KIMI_API_KEY: 'sk-kimi' };
  const providers = recordsFor(env).map((p) =>
    p.code === 'deepseek' || p.code === 'kimi' ? { ...p, is_enabled: true } : p,
  );
  const result = orderedMorfAiCandidates({ providers, capability: 'text', env });
  assert.deepEqual(result.issues, []);
  // codemorf (primary, sin key) NO entra a ready; deepseek y kimi sí, por prioridad
  assert.deepEqual(
    result.attempted,
    ['deepseek', 'kimi'],
  );
  assert.deepEqual(
    result.candidates.map((c) => c.code),
    ['deepseek', 'kimi'],
  );
});

test('CAND-002: attempted = todos los ready; candidates = solo con capability', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek', MORF_AI_KIMI_API_KEY: 'sk-kimi' };
  const providers = recordsFor(env).map((p) => {
    if (p.code === 'deepseek') return { ...p, is_enabled: true, capabilities: ['text'] as MorfCapability[] };
    if (p.code === 'kimi') return { ...p, is_enabled: true };
    return p;
  });
  const result = orderedMorfAiCandidates({ providers, capability: 'vision', env });
  assert.deepEqual(result.attempted, ['deepseek', 'kimi']);
  assert.deepEqual(result.candidates.map((c) => c.code), ['kimi']);
});

test('CAND-003: preferCode capaz se mueve al frente sin perder el resto', () => {
  const env = { MORF_AI_DEEPSEEK_API_KEY: 'sk-deepseek', MORF_AI_KIMI_API_KEY: 'sk-kimi' };
  const providers = recordsFor(env).map((p) =>
    p.code === 'deepseek' || p.code === 'kimi' ? { ...p, is_enabled: true } : p,
  );
  const result = orderedMorfAiCandidates({ providers, capability: 'text', preferCode: 'kimi', env });
  assert.deepEqual(result.candidates.map((c) => c.code), ['kimi', 'deepseek']);
  // attempted conserva el orden de prioridad (no el prefer)
  assert.deepEqual(result.attempted, ['deepseek', 'kimi']);
});

test('CAND-004: conjunto inválido -> issues y sin candidatos (§8.1)', () => {
  const providers = [
    record({ code: 'codemorf', is_primary: true }),
    record({ code: 'deepseek', is_primary: true }),
  ];
  const result = orderedMorfAiCandidates({ providers, capability: 'text', env: EMPTY_ENV });
  assert.ok(result.issues.length > 0);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.attempted, []);
});

test('CAND-005: sin ready -> candidates y attempted vacíos', () => {
  const result = orderedMorfAiCandidates({ providers: recordsFor(EMPTY_ENV), capability: 'text', env: EMPTY_ENV });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.attempted, []);
});
