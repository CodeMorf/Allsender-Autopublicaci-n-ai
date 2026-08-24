// Morf AI — Provider Registry: tipos.
// Módulo puro (sin dependencias) para poder testearse sin node_modules.

export const MORF_CAPABILITIES = [
  'text',
  'structured_output',
  'vision',
  'tool_calling',
  'classification',
  'reasoning',
] as const;

export type MorfCapability = (typeof MORF_CAPABILITIES)[number];

export const MORF_PROVIDER_CODES = [
  'codemorf',
  'nordrouter',
  'deepseek',
  'kimi',
  'openai',
  'openrouter',
  'gemini',
] as const;

export type MorfProviderCode = (typeof MORF_PROVIDER_CODES)[number];

export type MorfProviderStatus = 'disabled' | 'missing_key' | 'missing_model' | 'ready' | 'error';

export type MorfProviderRecord = {
  id?: number;
  code: MorfProviderCode;
  display_name: string;
  base_url: string;
  default_model: string | null;
  is_enabled: boolean;
  is_primary: boolean;
  fallback_priority: number | null;
  capabilities: MorfCapability[];
  metadata: Record<string, unknown>;
  last_test_status: string | null;
  last_test_message_sanitized: string | null;
  last_test_at: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type MorfProviderInput = {
  code: MorfProviderCode;
  display_name: string;
  base_url: string;
  default_model?: string | null;
  is_enabled?: boolean;
  is_primary?: boolean;
  fallback_priority?: number | null;
  capabilities?: MorfCapability[];
  metadata?: Record<string, unknown>;
};

/** Configuración resuelta (registro + key real de env) lista para ejecutar. */
export type MorfProviderConfig = {
  code: MorfProviderCode;
  displayName: string;
  baseUrl: string;
  model: string | null;
  apiKey: string;
  capabilities: MorfCapability[];
  ready: boolean;
  status: MorfProviderStatus;
};

export type MorfProviderResolution = {
  ok: boolean;
  provider?: MorfProviderConfig;
  /** Proveedores considerados en orden, con su motivo de descarte en `reason`. */
  attempted: string[];
  reason?: string;
  issues?: string[];
};

export type MorfProviderErrorCode =
  | 'PROVIDER_NOT_FOUND'
  | 'INVALID_RECORD'
  | 'INVALID_PROVIDER_SET'
  | 'NO_PROVIDER_AVAILABLE'
  | 'CAPABILITY_NOT_SUPPORTED';
