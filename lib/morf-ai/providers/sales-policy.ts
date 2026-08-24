import type { MorfProviderCode, MorfProviderRecord } from './types';

/** Los módulos autónomos de atención y marketing usan exclusivamente CodeMorf. */
export const SALES_AI_PROVIDER_CODE: MorfProviderCode = 'codemorf';
export const SALES_AI_MODEL = 'morf-ai-auto';

const CODEMORF_ONLY_MODULE_CODES = new Set([
  'sales_ai',
  'sales-ai',
  'ventas_ia',
  'venta-ai',
  'payment_proof',
  'auto_calendar',
  'auto-cita',
  'auto_cita',
  'comments_ai',
  'comentarios-ia',
  'marketing_ai',
  'autopublicar',
  'auto_publish',
]);

export function isSalesAiModuleCode(moduleCode: unknown): boolean {
  const normalized = String(moduleCode || '').trim().toLowerCase();
  return ['sales_ai', 'sales-ai', 'ventas_ia', 'venta-ai', 'payment_proof'].includes(normalized);
}

export function isCodeMorfOnlyModuleCode(moduleCode: unknown): boolean {
  return CODEMORF_ONLY_MODULE_CODES.has(String(moduleCode || '').trim().toLowerCase());
}

export function scopeSalesAiProviders(providers: MorfProviderRecord[]): MorfProviderRecord[] {
  return providers.filter((provider) => provider.code === SALES_AI_PROVIDER_CODE);
}

export function scopeCodeMorfProviders(providers: MorfProviderRecord[]): MorfProviderRecord[] {
  return providers.filter((provider) => provider.code === SALES_AI_PROVIDER_CODE);
}
