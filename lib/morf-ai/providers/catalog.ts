// Morf AI — Provider Registry: catálogo estático.
// Fuente única de: nombres visibles, base URLs por defecto, modelos sugeridos,
// capabilities declaradas y cadenas de variables de entorno para la key.
// Precedencia (master prompt §74): DB (morf_ai_providers) = runtime source;
// env = secretos/bootstrap; config legacy (ai_configs) = compatibilidad.
// Módulo puro (sin dependencias) para poder testearse sin node_modules.

import type { MorfCapability, MorfProviderCode } from './types';
import type { MorfProviderApiKind } from './api-shape';

/** Forma de la API para requests reales (test Fase 2 y runtime Fase 3). */
export type MorfProviderTestKind = MorfProviderApiKind;

export type MorfProviderCatalogEntry = {
  code: MorfProviderCode;
  displayName: string;
  defaultBaseUrl: string;
  /** Modelo sugerido. null = debe configurarse en el panel antes de activar. */
  defaultModel: string | null;
  capabilities: MorfCapability[];
  envKeyChain: string[];
  /** Forma de la API para el test de conexión real (Fase 2). */
  testKind: MorfProviderTestKind;
  legacy?: boolean;
  docsUrl?: string;
};

// Los endpoints se verificaron vivos en sesión previa:
// NordRouter 200, CodeMorf gateway /v1 health ok (modelo morf-ai-auto),
// DeepSeek responde (401 sin key), Moonshot/Kimi responde.
// Los modelos marcados como sugeridos se re-verifican con petición real en
// el test de conexión del panel (Fase 2) antes de marcarlos ready.
export const MORF_PROVIDER_CATALOG: MorfProviderCatalogEntry[] = [
  {
    code: 'codemorf',
    displayName: 'CodeMorf',
    defaultBaseUrl: 'https://codemorf.tech/gateway/v1',
    defaultModel: 'morf-ai-auto',
    capabilities: ['text', 'structured_output', 'vision', 'tool_calling', 'classification', 'reasoning'],
    envKeyChain: ['MORF_AI_CODEMORF_API_KEY', 'CODEMORF_API_KEY'],
    testKind: 'openai-compatible',
    docsUrl: 'https://codemorf.tech/chat/docs/es/',
  },
  {
    code: 'nordrouter',
    displayName: 'NordRouter',
    defaultBaseUrl: 'https://nordrouter.com/api/v1',
    defaultModel: null,
    capabilities: ['text', 'structured_output', 'tool_calling', 'classification'],
    envKeyChain: ['MORF_AI_NORDROUTER_API_KEY', 'NORDROUTER_API_KEY'],
    testKind: 'openai-compatible',
    docsUrl: 'https://nordrouter.com/docs/es/',
  },
  {
    code: 'deepseek',
    displayName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    capabilities: ['text', 'structured_output', 'tool_calling', 'classification'],
    envKeyChain: ['MORF_AI_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'],
    testKind: 'openai-compatible',
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    code: 'kimi',
    displayName: 'Kimi (Moonshot)',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    capabilities: ['text', 'structured_output', 'tool_calling', 'classification', 'vision'],
    envKeyChain: ['MORF_AI_KIMI_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    testKind: 'openai-compatible',
    docsUrl: 'https://platform.moonshot.ai/',
  },
  {
    code: 'openai',
    displayName: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    capabilities: ['text', 'structured_output', 'vision', 'tool_calling', 'classification'],
    envKeyChain: ['MORF_AI_OPENAI_API_KEY', 'ALLSENDER_OPENAI_API_KEY', 'OPENAI_API_KEY'],
    testKind: 'openai-compatible',
    docsUrl: 'https://platform.openai.com/docs/',
  },
  {
    code: 'openrouter',
    displayName: 'OpenRouter (legacy)',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/auto',
    capabilities: ['text', 'structured_output', 'vision', 'tool_calling', 'classification'],
    envKeyChain: ['MORF_AI_OPENROUTER_API_KEY', 'ALLSENDER_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY'],
    testKind: 'openai-compatible',
    legacy: true,
    docsUrl: 'https://openrouter.ai/docs',
  },
  {
    code: 'gemini',
    displayName: 'Gemini (legacy)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: null,
    capabilities: ['text', 'structured_output', 'vision', 'classification'],
    envKeyChain: ['MORF_AI_GEMINI_API_KEY', 'ALLSENDER_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY'],
    testKind: 'gemini',
    legacy: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs',
  },
];

export function getMorfProviderCatalogEntry(code: MorfProviderCode): MorfProviderCatalogEntry | undefined {
  return MORF_PROVIDER_CATALOG.find((entry) => entry.code === code);
}
