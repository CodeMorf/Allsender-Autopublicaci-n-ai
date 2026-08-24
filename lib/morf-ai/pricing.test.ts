import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getProviderPriceTable,
  getProviderPriceOverride,
  estimateProviderCostCents,
  customerCostCentsFromProviderCents,
} from './pricing';

test('F11-001: deepseek-chat tiene precio publicado y costo real por tokens', () => {
  const table = getProviderPriceTable('deepseek', 'deepseek-chat');
  assert.ok(table);
  assert.equal(table.inputUsdPerMillion, 0.27);
  assert.equal(table.outputUsdPerMillion, 1.1);
  const estimate = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(estimate.providerCostCents, Math.round((0.27 * 1e6 + 1.1 * 1e6) / 10000));
});

test('F11-002: provider sin precio publicado → not_configured y 0 centavos', () => {
  const table = getProviderPriceTable('nordrouter', 'claude-sonnet');
  assert.equal(table, null);
  const estimate = estimateProviderCostCents({
    provider: 'nordrouter',
    model: 'claude-sonnet',
    inputTokens: 500_000,
    outputTokens: 100_000,
  });
  assert.equal(estimate.pricing, 'not_configured');
  assert.equal(estimate.providerCostCents, 0);
  assert.equal(estimate.priceTable, null);
});

test('F11-003: openrouter/kimi/modelo desconocido → not_configured (nunca inventar)', () => {
  for (const provider of ['openrouter', 'kimi']) {
    const estimate = estimateProviderCostCents({
      provider,
      model: 'any-model',
      inputTokens: 1000,
      outputTokens: 1000,
    });
    assert.equal(estimate.pricing, 'not_configured', provider);
    assert.equal(estimate.providerCostCents, 0, provider);
  }
  // codemorf solo tiene precio para los modelos publicados en sus docs.
  const unknown = estimateProviderCostCents({
    provider: 'codemorf',
    model: 'any-model',
    inputTokens: 1000,
    outputTokens: 1000,
  });
  assert.equal(unknown.pricing, 'not_configured');
  assert.equal(unknown.providerCostCents, 0);
});

test('F11-004: coincidencia por prefijo (gemini-2.0-flash-001 usa precio 2.0-flash)', () => {
  const table = getProviderPriceTable('gemini', 'gemini-2.0-flash-001');
  assert.ok(table);
  assert.equal(table.inputUsdPerMillion, 0.1);
});

test('F11-005: prefijo más largo gana (gemini-1.5-flash-8b ≠ gemini-1.5-flash)', () => {
  const flash8b = getProviderPriceTable('gemini', 'gemini-1.5-flash-8b');
  const flash = getProviderPriceTable('gemini', 'gemini-1.5-flash');
  assert.ok(flash8b);
  assert.ok(flash);
  assert.equal(flash8b.inputUsdPerMillion, 0.0375);
  assert.equal(flash.inputUsdPerMillion, 0.075);
});

test('F11-006: override del Super Admin en metadata gana a la tabla', () => {
  const override = getProviderPriceOverride({
    price_input_usd_per_m: 1.5,
    price_output_usd_per_m: 3,
    price_source: 'contrato directo',
  });
  assert.ok(override);
  const table = getProviderPriceTable('deepseek', 'deepseek-chat', {
    price_input_usd_per_m: 1.5,
    price_output_usd_per_m: 3,
  });
  assert.ok(table);
  assert.equal(table.inputUsdPerMillion, 1.5);
  assert.equal(table.source, 'super_admin_override');
  const estimate = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1_000_000,
    outputTokens: 500_000,
    metadata: { price_input_usd_per_m: 1.5, price_output_usd_per_m: 3 },
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(estimate.providerCostCents, Math.round((1.5e6 + 3 * 5e5) / 10000));
});

test('F11-007: override incompleto (solo input) se ignora y cae a la tabla publicada', () => {
  const override = getProviderPriceOverride({ price_input_usd_per_m: 1 });
  assert.equal(override, null);
  // deepseek-chat tiene precio publicado: el override incompleto no lo desactiva.
  const estimate = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    metadata: { price_input_usd_per_m: 1 },
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(estimate.providerCostCents, Math.round((0.27e6 + 1.1e6) / 10000));
  // Sin precio publicado en la tabla, el override incompleto deja not_configured.
  const noTable = estimateProviderCostCents({
    provider: 'nordrouter',
    model: 'claude-sonnet',
    inputTokens: 1000,
    outputTokens: 1000,
    metadata: { price_input_usd_per_m: 1 },
  });
  assert.equal(noTable.pricing, 'not_configured');
  assert.equal(noTable.providerCostCents, 0);
});

test('F11-008: override con valor 0 cuenta como configurado (provider gratis)', () => {
  const estimate = estimateProviderCostCents({
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputTokens: 100_000,
    outputTokens: 100_000,
    metadata: { price_input_usd_per_m: 0, price_output_usd_per_m: 0 },
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(estimate.providerCostCents, 0);
});

test('F11-009: tokens faltantes → 0 centavos si no hay precio; sin NaN', () => {
  const estimate = estimateProviderCostCents({
    provider: 'deepseek',
    model: 'deepseek-chat',
    inputTokens: null,
    outputTokens: undefined,
  });
  assert.equal(estimate.pricing, 'configured');
  assert.equal(Number.isNaN(estimate.providerCostCents), false);
  assert.equal(estimate.providerCostCents, 0);
});

test('F11-010: provider y modelo en minúsculas y espacios no rompen la tabla', () => {
  const table = getProviderPriceTable('  DEEPSEEK  ', 'deepseek-chat ');
  assert.ok(table);
  assert.equal(table.outputUsdPerMillion, 1.1);
});

test('F11-011: precios publicados de CodeMorf por modelo real del gateway', () => {
  const cases: Array<[string, number, number]> = [
    ['deepseek/deepseek-v4-flash', 0.037, 0.073],
    ['deepseek/deepseek-v4-pro', 0.163, 0.326],
    ['openai/gpt-5.4-nano', 0.075, 0.468],
    ['openai/gpt-5.4-mini', 0.168, 1.01],
    ['openai/gpt-5.6-terra', 0.494, 2.96],
    ['openai/gpt-5.3-codex', 0.393, 3.14],
    ['google/gemini-3.1-flash-lite', 0.094, 0.561],
    ['google/gemini-3-flash-preview', 0.112, 0.673],
    ['google/gemini-3.5-flash', 0.337, 2.02],
    ['anthropic/claude-haiku-4.5', 0.224, 1.12],
    ['kimi-k2.7-code-highspeed', 0.473, 2.24],
  ];
  for (const [model, input, output] of cases) {
    const table = getProviderPriceTable('codemorf', model);
    assert.ok(table, model);
    assert.equal(table.inputUsdPerMillion, input, model);
    assert.equal(table.outputUsdPerMillion, output, model);
    assert.equal(table.source, 'https://codemorf.tech/chat/docs/es/', model);
    const estimate = estimateProviderCostCents({
      provider: 'codemorf',
      model,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    assert.equal(estimate.pricing, 'configured', model);
    assert.equal(estimate.providerCostCents, Math.round((input * 1e6 + output * 1e6) / 10000), model);
  }
});

test('F11-012: costo cliente = proveedor × (1 + markup/100), sin piso de 1¢', () => {
  assert.equal(customerCostCentsFromProviderCents(0.02, 15), 0);
  assert.equal(customerCostCentsFromProviderCents(0.49, 15), 0);
  assert.equal(customerCostCentsFromProviderCents(0.5, 15), 1);
  assert.equal(customerCostCentsFromProviderCents(100, 15), 115);
  assert.equal(customerCostCentsFromProviderCents(0, 15), 0);
  assert.equal(customerCostCentsFromProviderCents(0.87, 15), 1);
  // Sin markup → el costo del proveedor redondeado.
  assert.equal(customerCostCentsFromProviderCents(3.4, 0), 3);
});
