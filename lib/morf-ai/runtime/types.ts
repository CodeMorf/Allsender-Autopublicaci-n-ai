// Morf AI — Runtime (Fase 3): tipos del contrato morf.generate().
// Contrato del master prompt §3.1/§9: el módulo pide una capability, no un
// proveedor. Módulo puro (sin dependencias) para poder testearse.

import type { MorfCapability, MorfProviderCode } from '../providers/types';

/** Parte de contenido multimodal: texto, imagen por URL o audio inline. */
export type MorfChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

/** Mensaje en formato OpenAI-compatible (los adapters mapean al proveedor). */
export type MorfChatMessage = {
  role: string;
  content?: string | null | MorfChatContentPart[];
  name?: string | null;
  tool_call_id?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function: { name: string; arguments: string };
  }>;
};

export type MorfRequest = {
  teamId: number;
  moduleCode: string;
  capability: MorfCapability;
  messages: MorfChatMessage[];
  tools?: unknown[];
  responseFormat?: unknown;
  modelHint?: string;
  metadata?: Record<string, unknown>;
};

export type MorfGenerateOptions = {
  /** Timeout por intento de provider (default 60s). */
  timeoutMs?: number;
  chatId?: number | null;
  /** Proveedor preferido para esta llamada (si soporta la capability). */
  preferCode?: MorfProviderCode;
  /** Saltar la validación de acceso/wallet (uso interno supervisado). */
  skipAccessCheck?: boolean;
  /** Clave estable por llamada para que metering y cobro sean idempotentes. */
  requestKey?: string;
  /** Shadow se bloquea antes del provider salvo aprobación explícita del tenant. */
  billingMode?: 'standard' | 'shadow';
  metadata?: Record<string, unknown>;
};

export type MorfToolCall = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type MorfUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type MorfGenerateSuccess = {
  ok: true;
  text: string | null;
  toolCalls: MorfToolCall[];
  usage: MorfUsage;
  provider: { code: MorfProviderCode; model: string };
  /** Proveedores listos intentados en orden (incluye fallbacks probados). */
  attempted: string[];
  latencyMs: number;
};

export type MorfGenerateFailure = {
  ok: false;
  reason:
    | 'invalid_request'
    | 'invalid_provider_set'
    | 'no_provider_ready'
    | 'capability_not_supported'
    | 'all_providers_failed'
    | 'access_denied'
    | 'billing_blocked'
    | 'metering_failed'
    | 'internal_error';
  /** Detalle legible (sin secretos, §49). */
  message: string;
  /** Razón de acceso específica (plan_not_allowed, no_balance, ...) cuando aplica. */
  accessReason?: string;
  attempted: string[];
  latencyMs?: number;
};

export type MorfGenerateResult = MorfGenerateSuccess | MorfGenerateFailure;

/** Respuesta normalizada del adapter (antes de resolver fallback/uso). */
export type MorfAdapterSuccess = {
  text: string | null;
  toolCalls: MorfToolCall[];
  usage: MorfUsage;
  /** Modelo real que respondió (puede diferir del default si el provider lo resuelve). */
  model: string;
};
