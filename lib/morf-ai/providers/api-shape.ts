// Morf AI — Formas de API por proveedor (puro, sin I/O).
// Dos familias reales (verificadas en Fase 0/2):
// - 'openai-compatible': POST {base}/chat/completions con Bearer (CodeMorf,
//   NordRouter, DeepSeek, Kimi, OpenAI, OpenRouter);
// - 'gemini': POST {base}/models/{model}:generateContent con x-goog-api-key.
// Compartido por el test de conexión (Fase 2) y el runtime (Fase 3) para que
// ambos construyan URLs idénticas.

export type MorfProviderApiKind = 'openai-compatible' | 'gemini';

/** Quita espacios y slash final. No valida aquí (validación en validation.ts). */
export function normalizeMorfBaseUrl(baseUrl: string) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

/** URL de chat para la forma de API indicada (mismo formato que el test real). */
export function buildMorfChatUrl(kind: MorfProviderApiKind, baseUrl: string, model: string) {
  const normalized = normalizeMorfBaseUrl(baseUrl);
  if (kind === 'gemini') {
    return `${normalized}/models/${encodeURIComponent(model)}:generateContent`;
  }
  return `${normalized}/chat/completions`;
}
