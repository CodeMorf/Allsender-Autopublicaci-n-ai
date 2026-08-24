// Morf AI — Runtime (Fase 3): punto de entrada central.
// Uso desde módulos:
//   const result = await morfGenerate({ teamId, moduleCode, capability, messages, tools });
//   if (!result.ok) ... else result.text / result.toolCalls / result.usage

export * from './types';
export { callMorfAdapter, buildMorfOpenAiBody, buildMorfGeminiBody, parseMorfOpenAiResponse, parseMorfGeminiResponse, MorfAdapterError } from './adapters';
export { runMorfWithFallback } from './runtime-core';
export { morfGenerate } from './generate';
