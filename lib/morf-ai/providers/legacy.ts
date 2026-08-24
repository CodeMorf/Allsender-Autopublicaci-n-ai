// Morf AI — Provider Registry: mappings legacy.
// Compatibilidad con la configuración existente (master prompt §6.2, §27):
// - ai_configs por tenant solo acepta openrouter/openai/gemini;
// - aliases de módulo chatbot: agente_ia_basico / ai_basic / ia_basica => base_ai.
// Módulo puro (sin dependencias) para poder testearse sin node_modules.

import { MORF_PROVIDER_CODES, type MorfProviderCode } from './types';

export const MORF_LEGACY_PROVIDER_CODES: ReadonlyArray<string> = ['openrouter', 'openai', 'gemini'];

/** Alias de módulos de chatbot existentes hacia base_ai (master prompt §4). */
export const MORF_MODULE_CODE_ALIASES: Record<string, string> = {
  agente_ia_basico: 'base_ai',
  ai_basic: 'base_ai',
  ia_basica: 'base_ai',
  chatbot: 'base_ai',
};

/**
 * Normalizador único de proveedor (reemplaza los normalize hardcodeados de
 * settings/ai/actions.ts y lib/plugins/ai-chat/service.ts).
 * Comportamiento legacy conservado: valor desconocido => gemini.
 */
export function normalizeMorfProvider(value: unknown): MorfProviderCode {
  const clean = String(value ?? '').trim().toLowerCase();
  if ((MORF_PROVIDER_CODES as readonly string[]).includes(clean)) {
    return clean as MorfProviderCode;
  }
  if (clean === 'moonshot' || clean === 'kimi-moonshot') {
    return 'kimi';
  }
  return 'gemini';
}

/** Mapea un valor legacy de ai_configs a un código del registry. */
export function mapLegacyProviderToMorf(provider: string): MorfProviderCode {
  return normalizeMorfProvider(provider);
}

/** Normaliza un module_code respetando los aliases del chatbot. */
export function normalizeModuleCode(value: string): string {
  const clean = String(value ?? '').trim().toLowerCase();
  return MORF_MODULE_CODE_ALIASES[clean] ?? clean;
}
