import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

test('MORF-UI-001: proveedores globales viven en Super Admin Gestion, no en Pagos', () => {
  const managementPage = read('app/[locale]/super-admin/(panel)/gestion/page.tsx');
  const paymentsPage = read('app/[locale]/super-admin/(panel)/pagos/page.tsx');

  assert.match(managementPage, /id="morf-ai-providers"/);
  assert.match(managementPage, /AllSender IA Global — Motor Multimódulo/);
  assert.match(managementPage, /saveMorfAiProvider/);
  assert.match(managementPage, /testMorfAiProvider/);
  assert.doesNotMatch(paymentsPage, /id="morf-ai-providers"/);
  assert.doesNotMatch(paymentsPage, /saveMorfAiProvider|testMorfAiProvider|Key API del proveedor/);
});

test('MORF-UI-002: acciones regresan a Gestion y CodeMorf exige key de entorno', () => {
  const actions = read('app/[locale]/super-admin/(panel)/gestion/morf-ai-provider-actions.ts');
  const catalog = read('lib/morf-ai/providers/catalog.ts');

  assert.match(actions, /\/es\/super-admin\/gestion\?morf_status=/);
  assert.doesNotMatch(actions, /\/es\/super-admin\/pagos\?morf_status=provider/);
  assert.match(catalog, /envKeyChain: \['MORF_AI_CODEMORF_API_KEY', 'CODEMORF_API_KEY'\]/);
});

test('MORF-UI-003: API solo expone estado de key, nunca su valor', () => {
  const route = read('app/api/super-admin/ai-router/route.ts');

  assert.match(route, /keyConfigured: Boolean\(config\.apiKey\)/);
  assert.doesNotMatch(route, /apiKey:\s*config\.apiKey/);
});

test('MORF-UI-004: consumo usa ledger real y el reinicio crea baseline sin borrar historial', () => {
  const managementPage = read('app/[locale]/super-admin/(panel)/gestion/page.tsx');
  const actions = read('app/[locale]/super-admin/(panel)/gestion/morf-ai-provider-actions.ts');
  const route = read('app/api/super-admin/ai-router/route.ts');

  assert.match(route, /FROM morf_ai_usage_logs usage/);
  assert.match(route, /SUM\(usage\.input_tokens \+ usage\.output_tokens\)/);
  assert.doesNotMatch(route, /LEFT JOIN messages|tokenEstimate|costEstimateUsd/);
  assert.match(actions, /usage_baseline_at/);
  assert.match(actions, /usage_baseline_history/);
  assert.doesNotMatch(actions, /DELETE\s+FROM\s+morf_ai_usage_logs|TRUNCATE/i);
  assert.match(managementPage, /Iniciar ciclo desde cero/);
  assert.match(managementPage, /No elimina consumo histórico, conversaciones, órdenes, memoria ni saldos/);
});
