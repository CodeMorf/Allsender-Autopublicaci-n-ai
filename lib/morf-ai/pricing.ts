// Morf AI — Metering / Pricing (Fase 11): cálculo de costo por proveedor.
// Regla del master prompt: NO inventar precios. Solo se reporta
// provider_cost_cents cuando existe un precio real publicado en la tabla
// estática o un override explícito del Super Admin en el metadata del provider
// (price_input_usd_per_m / price_output_usd_per_m). En cualquier otro caso el
// registro se marca `pricing: 'not_configured'` y el costo de proveedor es 0.
// Módulo puro (sin dependencias) para poder testearse sin node_modules.
//
// El cobro al cliente parte del precio publicado de CodeMorf
// (https://codemorf.tech/chat/docs/es/) y se le aplica el markup dinámico del
// Super Admin en core.ts (customerCostCentsFromProviderCents).

export type ProviderPriceTable = {
  /** USD por 1M tokens de entrada. */
  inputUsdPerMillion: number;
  /** USD por 1M tokens de salida. */
  outputUsdPerMillion: number;
  /** Fuente pública del precio (para verificación humana). */
  source: string;
  /** Fecha de vigencia de la lista publicada. */
  asOf?: string;
};

export type ProviderCostEstimate = {
  /** Costo del proveedor en centavos USD (0 si no hay precio configurado). */
  providerCostCents: number;
  pricing: 'configured' | 'not_configured';
  priceTable: ProviderPriceTable | null;
};

// Precios de lista publicados por los proveedores (solo precios reales que se
// pueden verificar en la documentación pública). Cualquier modelo fuera de esta
// tabla queda en `not_configured`; el Super Admin puede sobrescribir vía
// metadata del provider (price_input_usd_per_m / price_output_usd_per_m).
const MORF_PROVIDER_PRICES: Record<string, Record<string, ProviderPriceTable>> = {
  deepseek: {
    'deepseek-chat': {
      inputUsdPerMillion: 0.27,
      outputUsdPerMillion: 1.1,
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
      asOf: '2026-06',
    },
    'deepseek-reasoner': {
      inputUsdPerMillion: 0.55,
      outputUsdPerMillion: 2.19,
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
      asOf: '2026-06',
    },
  },
  openai: {
    'gpt-4o-mini': {
      inputUsdPerMillion: 0.15,
      outputUsdPerMillion: 0.6,
      source: 'https://openai.com/api/pricing',
      asOf: '2026-06',
    },
    'gpt-4o': {
      inputUsdPerMillion: 2.5,
      outputUsdPerMillion: 10,
      source: 'https://openai.com/api/pricing',
      asOf: '2026-06',
    },
    'gpt-4.1-mini': {
      inputUsdPerMillion: 0.4,
      outputUsdPerMillion: 1.6,
      source: 'https://openai.com/api/pricing',
      asOf: '2026-06',
    },
    'gpt-4.1': {
      inputUsdPerMillion: 2,
      outputUsdPerMillion: 8,
      source: 'https://openai.com/api/pricing',
      asOf: '2026-06',
    },
  },
  gemini: {
    'gemini-1.5-flash-8b': {
      inputUsdPerMillion: 0.0375,
      outputUsdPerMillion: 0.15,
      source: 'https://ai.google.dev/pricing',
      asOf: '2026-06',
    },
    'gemini-1.5-flash': {
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.3,
      source: 'https://ai.google.dev/pricing',
      asOf: '2026-06',
    },
    'gemini-1.5-pro': {
      inputUsdPerMillion: 1.25,
      outputUsdPerMillion: 5,
      source: 'https://ai.google.dev/pricing',
      asOf: '2026-06',
    },
    'gemini-2.0-flash': {
      inputUsdPerMillion: 0.1,
      outputUsdPerMillion: 0.4,
      source: 'https://ai.google.dev/pricing',
      asOf: '2026-06',
    },
  },
  // Tarifa publicada de CodeMorf (agregador usado por Morf AI). Claves = nombre
  // real del modelo que devuelve el gateway. Fuente: docs oficiales de CodeMorf.
  codemorf: {
    'deepseek/deepseek-v4-flash': {
      inputUsdPerMillion: 0.037,
      outputUsdPerMillion: 0.073,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'deepseek/deepseek-v4-pro': {
      inputUsdPerMillion: 0.163,
      outputUsdPerMillion: 0.326,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'openai/gpt-5.4-nano': {
      inputUsdPerMillion: 0.075,
      outputUsdPerMillion: 0.468,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'openai/gpt-5.4-mini': {
      inputUsdPerMillion: 0.168,
      outputUsdPerMillion: 1.01,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'openai/gpt-5.6-terra': {
      inputUsdPerMillion: 0.494,
      outputUsdPerMillion: 2.96,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'openai/gpt-5.3-codex': {
      inputUsdPerMillion: 0.393,
      outputUsdPerMillion: 3.14,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'google/gemini-3.1-flash-lite': {
      inputUsdPerMillion: 0.094,
      outputUsdPerMillion: 0.561,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'google/gemini-3-flash-preview': {
      inputUsdPerMillion: 0.112,
      outputUsdPerMillion: 0.673,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'google/gemini-3.5-flash': {
      inputUsdPerMillion: 0.337,
      outputUsdPerMillion: 2.02,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'anthropic/claude-haiku-4.5': {
      inputUsdPerMillion: 0.224,
      outputUsdPerMillion: 1.12,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
    'kimi-k2.7-code-highspeed': {
      inputUsdPerMillion: 0.473,
      outputUsdPerMillion: 2.24,
      source: 'https://codemorf.tech/chat/docs/es/',
      asOf: '2026-08',
    },
  },
};

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toFiniteNonNegative(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

/**
 * Override del Super Admin en el metadata del provider
 * (price_input_usd_per_m / price_output_usd_per_m). Ambos valores son
 * necesarios y deben ser numéricos ≥ 0 para contar como configurados.
 */
export function getProviderPriceOverride(metadata: Record<string, unknown> | null | undefined): ProviderPriceTable | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const input = toFiniteNonNegative(metadata.price_input_usd_per_m);
  const output = toFiniteNonNegative(metadata.price_output_usd_per_m);
  if (input === null || output === null) return null;
  return {
    inputUsdPerMillion: input,
    outputUsdPerMillion: output,
    source: typeof metadata.price_source === 'string' && metadata.price_source.trim()
      ? metadata.price_source.trim()
      : 'super_admin_override',
    asOf: typeof metadata.price_as_of === 'string' && metadata.price_as_of.trim()
      ? metadata.price_as_of.trim()
      : undefined,
  };
}

/**
 * Precio publicado del provider+modelo. Primero el override admin; luego la
 * tabla estática con coincidencia exacta y, si no, por prefijo (el prefijo más
 * largo gana para no confundir p. ej. gemini-1.5-flash-8b con gemini-1.5-flash).
 */
export function getProviderPriceTable(
  provider: string,
  model: string,
  metadata?: Record<string, unknown> | null,
): ProviderPriceTable | null {
  const override = getProviderPriceOverride(metadata);
  if (override) return override;

  const byProvider = MORF_PROVIDER_PRICES[String(provider || '').trim().toLowerCase()];
  const normalizedModel = String(model || '').trim();
  if (!byProvider || !normalizedModel) return null;

  const exact = byProvider[normalizedModel];
  if (exact) return exact;

  const keys = Object.keys(byProvider).filter((key) => normalizedModel.startsWith(key));
  if (keys.length === 0) return null;
  keys.sort((a, b) => b.length - a.length);
  return byProvider[keys[0]];
}

/**
 * Estimación de costo del proveedor en centavos USD a partir de tokens reales
 * (o estimados) y el precio publicado/overridden. Sin precio configurado →
 * `not_configured` y 0 centavos (nunca se inventa un precio).
 */
export function estimateProviderCostCents(params: {
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  metadata?: Record<string, unknown> | null;
}): ProviderCostEstimate {
  const priceTable = getProviderPriceTable(params.provider, params.model, params.metadata);
  if (!priceTable) {
    return { providerCostCents: 0, pricing: 'not_configured', priceTable: null };
  }

  const inputTokens = Math.max(0, Math.round(Number(params.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.round(Number(params.outputTokens) || 0));
  const providerCostCents = Math.round(
    (inputTokens * priceTable.inputUsdPerMillion + outputTokens * priceTable.outputUsdPerMillion) / 10000,
  );
  return { providerCostCents, pricing: 'configured', priceTable };
}

/**
 * Costo para el cliente: costo del proveedor × (1 + markup/100). Se redondea
 * primero el costo del proveedor a centavos enteros (mitad hacia arriba) y el
 * resultado no tiene piso de 1¢: llamadas sub-centavo no descuentan del wallet
 * (los precios CodeMorf hacen que casi todas las llamadas cuesten < 0.5¢).
 */
export function customerCostCentsFromProviderCents(providerCostCents: number, markupPercent: number): number {
  const provider = Math.round(Math.max(0, Number(providerCostCents) || 0));
  const markup = Number(markupPercent);
  const effectiveMarkup = Number.isFinite(markup) && markup >= 0 ? markup : 0;
  return Math.round(provider * (1 + effectiveMarkup / 100));
}
