// Morf AI — Runtime (Fase 3): adapters de provider.
// Centraliza la forma de llamada y la normalización de respuesta (§11):
// - 'openai-compatible': /chat/completions, Bearer, mensajes/tools directos;
// - 'gemini': :generateContent, x-goog-api-key, mapeo system/contents/tools.
// Módulo puro (fetch + node:test). Errores saneados (§49): los secretos de
// respuestas upstream nunca llegan al módulo que llamó.

import type { MorfProviderConfig } from '../providers/types';
import { getMorfProviderCatalogEntry } from '../providers/catalog';
import { buildMorfChatUrl } from '../providers/api-shape';
import { sanitizeMorfAiErrorMessage } from '../providers/validation';
import type { MorfAdapterSuccess, MorfChatMessage, MorfRequest, MorfToolCall, MorfUsage } from './types';

export class MorfAdapterError extends Error {
  code: 'invalid_config' | 'network' | 'timeout' | 'http' | 'invalid_response';
  status?: number;

  constructor(
    code: 'invalid_config' | 'network' | 'timeout' | 'http' | 'invalid_response',
    message: string,
    status?: number,
  ) {
    super(sanitizeMorfAiErrorMessage(message));
    this.name = 'MorfAdapterError';
    this.code = code;
    this.status = status;
  }
}

/** Cuerpo OpenAI-compatible: mensajes + tools + response_format pasan directos. */
export function buildMorfOpenAiBody(request: MorfRequest, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages: request.messages };
  if (Array.isArray(request.tools) && request.tools.length > 0) body.tools = request.tools;
  if (request.responseFormat != null) body.response_format = request.responseFormat;
  return body;
}

function parseToolArguments(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Texto plano de un content (string | null | partes): las imágenes no aportan texto. */
function textFromMorfContent(content: MorfChatMessage['content']): string {
  if (typeof content === 'string' || content == null) return content ?? '';
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ');
  }
  return '';
}

function audioMimeType(format: string): string {
  const normalized = String(format || '').toLowerCase();
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'mp3') return 'audio/mpeg';
  if (normalized === 'ogg' || normalized === 'opus') return 'audio/ogg';
  if (normalized === 'webm') return 'audio/webm';
  if (normalized === 'm4a' || normalized === 'mp4') return 'audio/mp4';
  if (normalized === 'flac') return 'audio/flac';
  if (normalized === 'aac') return 'audio/aac';
  return `audio/${normalized || 'wav'}`;
}

/** Partes de usuario para Gemini: texto y audio inline; imágenes por URL no son inline → se omiten. */
function morfUserPartsToGemini(content: MorfChatMessage['content']): Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> {
  if (typeof content === 'string' || content == null) return [{ text: content ?? '' }];
  if (!Array.isArray(content)) return [{ text: '' }];
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  for (const part of content) {
    if (part.type === 'text') parts.push({ text: part.text });
    else if (part.type === 'image_url') {
      console.warn('[morf-ai] Gemini no acepta imágenes por URL inline; se omite la parte image_url.');
    } else if (part.type === 'input_audio') {
      parts.push({ inlineData: { mimeType: audioMimeType(part.input_audio.format), data: part.input_audio.data } });
    }
  }
  return parts.length > 0 ? parts : [{ text: '' }];
}

/** Mapea mensajes OpenAI-compatible a contents de Gemini (system/functionCall/functionResponse). */
export function mapMorfMessagesToGemini(messages: MorfChatMessage[]) {
  let system: string | null = null;
  const contents: unknown[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      system = [system, textFromMorfContent(message.content)].filter(Boolean).join('\n') || null;
      continue;
    }
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: morfUserPartsToGemini(message.content) });
      continue;
    }
    if (message.role === 'assistant') {
      const parts: unknown[] = [];
      const text = textFromMorfContent(message.content);
      if (text) parts.push({ text });
      for (const toolCall of message.tool_calls ?? []) {
        parts.push({
          functionCall: {
            name: toolCall.function?.name ?? '',
            args: parseToolArguments(toolCall.function?.arguments),
          },
        });
      }
      contents.push({ role: 'model', parts });
      continue;
    }
    if (message.role === 'tool') {
      const raw = typeof message.content === 'string' ? message.content : '{}';
      let response: unknown;
      try {
        response = JSON.parse(raw);
      } catch {
        response = { text: raw };
      }
      contents.push({
        role: 'function',
        parts: [{ functionResponse: { name: message.name ?? message.tool_call_id ?? 'unknown', response } }],
      });
      continue;
    }
    // Roles desconocidos: texto de usuario conservador.
    contents.push({ role: 'user', parts: morfUserPartsToGemini(message.content) });
  }

  return { system, contents };
}

/** Cuerpo Gemini: contents mapeados + systemInstruction + functionDeclarations + JSON si aplica. */
export function buildMorfGeminiBody(request: MorfRequest, model: string): Record<string, unknown> {
  const { system, contents } = mapMorfMessagesToGemini(request.messages);
  const body: Record<string, unknown> = { contents };

  if (system) body.systemInstruction = { parts: [{ text: system }] };

  if (Array.isArray(request.tools) && request.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: request.tools.map((tool) => {
          const definition = (tool as Record<string, unknown>)?.function as Record<string, unknown> | undefined;
          const source = definition ?? (tool as Record<string, unknown>);
          return {
            name: String(source?.name ?? ''),
            description: source?.description != null ? String(source.description) : undefined,
            parameters: source?.parameters ?? undefined,
          };
        }),
      },
    ];
  }

  if (request.responseFormat != null) {
    const generationConfig: Record<string, unknown> = { responseMimeType: 'application/json' };
    const format = request.responseFormat as Record<string, unknown>;
    if (format?.json_schema != null) generationConfig.responseSchema = format.json_schema;
    body.generationConfig = generationConfig;
  }

  return body;
}

/** Extrae text/toolCalls/usage de una respuesta openai-compatible. */
export function parseMorfOpenAiResponse(json: unknown): MorfAdapterSuccess {
  const data = (json ?? {}) as Record<string, any>;
  const choice = Array.isArray(data.choices) ? (data.choices[0] as Record<string, any> | undefined) : undefined;
  const message = choice?.message ?? {};

  const toolCalls: MorfToolCall[] = Array.isArray(message.tool_calls)
    ? message.tool_calls.map((toolCall: Record<string, any>) => ({
        id: toolCall.id != null ? String(toolCall.id) : undefined,
        name: String(toolCall.function?.name ?? ''),
        arguments: parseToolArguments(toolCall.function?.arguments),
      }))
    : [];

  const usage: MorfUsage = {
    inputTokens: Math.max(0, Number(data.usage?.prompt_tokens ?? 0)),
    outputTokens: Math.max(0, Number(data.usage?.completion_tokens ?? 0)),
  };

  const model = String(data.model ?? '') || undefined;
  return {
    text: message.content != null ? String(message.content) : null,
    toolCalls,
    usage,
    model: model ?? '',
  };
}

/** Extrae text/toolCalls/usage de una respuesta Gemini. */
export function parseMorfGeminiResponse(json: unknown): MorfAdapterSuccess {
  const data = (json ?? {}) as Record<string, any>;
  const candidate = Array.isArray(data.candidates) ? (data.candidates[0] as Record<string, any> | undefined) : undefined;
  const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

  const texts = parts.filter((part) => typeof part?.text === 'string').map((part) => part.text as string);
  const toolCalls: MorfToolCall[] = parts
    .filter((part) => part?.functionCall != null)
    .map((part) => ({
      id: undefined,
      name: String(part.functionCall.name ?? ''),
      arguments: part.functionCall.args && typeof part.functionCall.args === 'object' ? part.functionCall.args : {},
    }));

  const usageMetadata = data.usageMetadata ?? {};
  const usage: MorfUsage = {
    inputTokens: Math.max(0, Number(usageMetadata.promptTokenCount ?? 0)),
    outputTokens: Math.max(0, Number(usageMetadata.candidatesTokenCount ?? 0)),
  };

  return {
    text: texts.length > 0 ? texts.join('\n') : null,
    toolCalls,
    usage,
    model: '',
  };
}

function validateConfig(config: MorfProviderConfig, kind: string) {
  const baseUrl = String(config.baseUrl || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
    throw new MorfAdapterError('invalid_config', `La URL base del provider ${config.code} no es válida.`);
  }
  if (!kind) {
    throw new MorfAdapterError('invalid_config', `Forma de API desconocida para el provider ${config.code}.`);
  }
  if (!config.apiKey) {
    throw new MorfAdapterError('invalid_config', `El provider ${config.code} no tiene key configurada.`);
  }
}

/**
 * Ejecuta una request contra un provider concreto.
 * - timeout por intento (AbortSignal.timeout, §48);
 * - errores saneados (§49): HTTP no 2xx, red, timeout y JSON inválido
 *   nunca exponen secretos ni stacks.
 */
export async function callMorfAdapter(
  config: MorfProviderConfig,
  request: MorfRequest,
  timeoutMs: number,
): Promise<MorfAdapterSuccess> {
  const catalogEntry = getMorfProviderCatalogEntry(config.code);
  const kind = catalogEntry?.testKind ?? 'openai-compatible';
  const model = (request.modelHint || config.model || '').trim();

  validateConfig(config, kind);
  if (!model) {
    throw new MorfAdapterError('invalid_config', `El provider ${config.code} necesita un modelo para ejecutar.`);
  }

  const url = buildMorfChatUrl(kind, config.baseUrl, model);
  const body = kind === 'gemini' ? buildMorfGeminiBody(request, model) : buildMorfOpenAiBody(request, model);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (kind === 'gemini') {
    headers['x-goog-api-key'] = config.apiKey;
  } else {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    throw new MorfAdapterError(
      isTimeout ? 'timeout' : 'network',
      isTimeout ? `Tiempo de espera agotado (${timeoutMs} ms)` : 'Error de red al conectar con el proveedor.',
    );
  }

  const raw = await response.text().catch(() => '');
  if (!response.ok) {
    const detail = sanitizeMorfAiErrorMessage(raw.slice(0, 200));
    throw new MorfAdapterError('http', `HTTP ${response.status}${detail ? ` — ${detail}` : ''}`, response.status);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw || '{}');
  } catch {
    throw new MorfAdapterError('invalid_response', 'El proveedor devolvió una respuesta no JSON.');
  }

  const parsed = kind === 'gemini' ? parseMorfGeminiResponse(json) : parseMorfOpenAiResponse(json);
  if (!parsed.model) parsed.model = model;
  return parsed;
}
