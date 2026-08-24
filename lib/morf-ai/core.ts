import 'server-only';

import { Polar } from '@polar-sh/sdk';
import { client } from '@/lib/db/drizzle';
import { getProviderPriceTable, customerCostCentsFromProviderCents } from '@/lib/morf-ai/pricing';

export const MORF_AI_MODULE_CODE = 'morf_ai';

type PolarServer = 'sandbox' | 'production';
type AnyRecord = Record<string, any>;

type RechargePackageRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  amount_cents: number;
  credit_cents: number;
  currency: string;
  polar_product_id: string | null;
  polar_price_id: string | null;
  is_active: boolean;
  sort_order: number;
};

type MorfAiCouponRow = {
  id: number;
  code: string;
  description: string | null;
  bonus_credit_cents: number;
  max_redemptions: number | null;
  redeemed_count: number;
  expires_at: Date | null;
  is_active: boolean;
};

function cleanText(value: unknown) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, (_key, item) => {
      if (item instanceof Date) return item.toISOString();
      return item;
    });
  } catch {
    return '{}';
  }
}

function moneyCents(value: unknown, fallback = 0) {
  const number = Number(String(value ?? '').replace(',', '.'));
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function isRealPolarId(value: unknown) {
  const id = String(value || '').trim();
  if (!id) return false;
  if (id.startsWith('PRODUCT_ID_')) return false;
  if (id.startsWith('PRICE_ID_')) return false;
  return true;
}

function getPolarServer(): PolarServer {
  return process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox';
}

function getPolarAccessToken() {
  return (
    process.env.POLAR_ACCESS_TOKEN ||
    process.env.POLAR_OAT ||
    process.env.POLAR_ORGANIZATION_ACCESS_TOKEN ||
    process.env.POLAR_API_KEY ||
    ''
  ).trim();
}

function getPolarClient() {
  const accessToken = getPolarAccessToken();
  if (!accessToken) throw new Error('polar_not_ready');
  return new Polar({ accessToken, server: getPolarServer() as any }) as any;
}

export function getMorfAiGlobalApiKey(provider: string) {
  const cleanProvider = String(provider || '').toLowerCase();

  if (cleanProvider === 'openai') {
    return (
      process.env.MORF_AI_OPENAI_API_KEY ||
      process.env.ALLSENDER_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      ''
    ).trim();
  }

  if (cleanProvider === 'gemini') {
    return (
      process.env.MORF_AI_GEMINI_API_KEY ||
      process.env.ALLSENDER_GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_AI_API_KEY ||
      ''
    ).trim();
  }

  return (
    process.env.MORF_AI_OPENROUTER_API_KEY ||
    process.env.ALLSENDER_OPENROUTER_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    ''
  ).trim();
}

export async function ensureMorfAiCoreTables() {
  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_wallets (
      id BIGSERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
      balance_cents BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
      monthly_limit_cents BIGINT,
      status TEXT NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_usage_logs (
      id BIGSERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      chat_id INTEGER,
      module_code TEXT NOT NULL DEFAULT 'base_ai',
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      provider_cost_cents BIGINT NOT NULL DEFAULT 0,
      customer_cost_cents BIGINT NOT NULL DEFAULT 0,
      markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
      status TEXT NOT NULL DEFAULT 'completed',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  await client`ALTER TABLE morf_ai_usage_logs ADD COLUMN IF NOT EXISTS request_key TEXT`;
  await client`
    CREATE UNIQUE INDEX IF NOT EXISTS morf_ai_usage_logs_team_request_uidx
    ON morf_ai_usage_logs(team_id, request_key)
    WHERE request_key IS NOT NULL
  `;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_recharges (
      id BIGSERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      package_id BIGINT,
      provider TEXT NOT NULL DEFAULT 'polar',
      checkout_id TEXT,
      external_payment_id TEXT,
      amount_cents BIGINT NOT NULL DEFAULT 0,
      credited_cents BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL DEFAULT 'pending',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await client`ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS package_id BIGINT`;
  await client`ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS polar_product_id TEXT`;
  await client`ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS polar_price_id TEXT`;
  await client`ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS coupon_id BIGINT`;
  await client`ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS coupon_code TEXT`;
  await client`ALTER TABLE morf_ai_recharges ADD COLUMN IF NOT EXISTS coupon_bonus_cents BIGINT NOT NULL DEFAULT 0`;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_wallet_transactions (
      id BIGSERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      transaction_key TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      amount_cents BIGINT NOT NULL DEFAULT 0,
      balance_after_cents BIGINT NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (team_id, transaction_key)
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_coupons (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      bonus_credit_cents BIGINT NOT NULL DEFAULT 0,
      max_redemptions INTEGER,
      redeemed_count INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMP,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_coupon_redemptions (
      id BIGSERIAL PRIMARY KEY,
      coupon_id BIGINT NOT NULL REFERENCES morf_ai_coupons(id) ON DELETE CASCADE,
      recharge_id BIGINT NOT NULL REFERENCES morf_ai_recharges(id) ON DELETE CASCADE,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      bonus_credit_cents BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (coupon_id, recharge_id)
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_global_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      default_provider TEXT NOT NULL DEFAULT 'openrouter',
      default_model TEXT NOT NULL DEFAULT 'openrouter/auto',
      markup_percent NUMERIC(8,2) NOT NULL DEFAULT 15.00,
      default_message_cost_cents BIGINT NOT NULL DEFAULT 1,
      enable_smart_routing BOOLEAN NOT NULL DEFAULT TRUE,
      enable_client_own_key BOOLEAN NOT NULL DEFAULT TRUE,
      polar_recharge_product_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT morf_ai_global_settings_singleton CHECK (id = 1)
    )
  `;
  await client`ALTER TABLE morf_ai_global_settings ADD COLUMN IF NOT EXISTS default_message_cost_cents BIGINT NOT NULL DEFAULT 1`;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_recharge_packages (
      id BIGSERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      amount_cents BIGINT NOT NULL DEFAULT 0,
      credit_cents BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      polar_product_id TEXT,
      polar_price_id TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await client`
    CREATE TABLE IF NOT EXISTS morf_ai_team_settings (
      id BIGSERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL UNIQUE REFERENCES teams(id) ON DELETE CASCADE,
      is_enabled BOOLEAN,
      monthly_limit_cents BIGINT,
      status TEXT NOT NULL DEFAULT 'inherit',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;

  await client`CREATE INDEX IF NOT EXISTS morf_ai_usage_logs_team_created_idx ON morf_ai_usage_logs(team_id, created_at DESC)`;
  await client`CREATE INDEX IF NOT EXISTS morf_ai_usage_logs_module_idx ON morf_ai_usage_logs(team_id, module_code, created_at DESC)`;
  await client`CREATE INDEX IF NOT EXISTS morf_ai_recharges_team_created_idx ON morf_ai_recharges(team_id, created_at DESC)`;
  await client`CREATE INDEX IF NOT EXISTS morf_ai_recharges_checkout_idx ON morf_ai_recharges(checkout_id)`;
  await client`CREATE INDEX IF NOT EXISTS morf_ai_coupons_active_idx ON morf_ai_coupons(is_active, expires_at)`;
  await client`CREATE INDEX IF NOT EXISTS morf_ai_coupon_redemptions_coupon_idx ON morf_ai_coupon_redemptions(coupon_id, created_at DESC)`;

  await client`
    INSERT INTO morf_ai_global_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `;

  await client`
    INSERT INTO morf_ai_recharge_packages (code, name, description, amount_cents, credit_cents, currency, sort_order, metadata, created_at, updated_at)
    VALUES
      ('morf_5', 'Inicial', 'Para validar el flujo con pocas conversaciones asistidas.', 500, 500, 'USD', 10, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW()),
      ('morf_10', 'Básico', 'Para negocios pequeños con atención ocasional.', 1000, 1000, 'USD', 20, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW()),
      ('morf_25', 'Recomendado', 'Para ventas, citas y chats con actividad diaria.', 2500, 2500, 'USD', 30, '{"seed":"fase1_3","recommended":true}'::jsonb, NOW(), NOW()),
      ('morf_50', 'Activo', 'Para equipos con WhatsApp, WebChat y agentes activos.', 5000, 5000, 'USD', 40, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW()),
      ('morf_100', 'Alto volumen', 'Para alto volumen de atención, ventas y automatizaciones.', 10000, 10000, 'USD', 50, '{"seed":"fase1_3"}'::jsonb, NOW(), NOW())
    ON CONFLICT (code) DO NOTHING
  `;
}

export async function ensureMorfAiWallet(teamId: number) {
  await ensureMorfAiCoreTables();
  await client`
    INSERT INTO morf_ai_wallets (team_id, currency, markup_percent, status, created_at, updated_at)
    VALUES (${teamId}, 'USD', COALESCE((SELECT markup_percent FROM morf_ai_global_settings WHERE id = 1), 15.00), 'active', NOW(), NOW())
    ON CONFLICT (team_id) DO NOTHING
  `;

  const rows = await client<AnyRecord[]>`
    SELECT *
    FROM morf_ai_wallets
    WHERE team_id = ${teamId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function getMorfAiRechargePackages() {
  await ensureMorfAiCoreTables();
  return await client<RechargePackageRow[]>`
    SELECT
      id::int,
      code,
      name,
      description,
      amount_cents::int,
      credit_cents::int,
      currency,
      NULLIF(COALESCE(polar_product_id, ''), '') AS polar_product_id,
      NULLIF(COALESCE(polar_price_id, ''), '') AS polar_price_id,
      is_active,
      sort_order
    FROM morf_ai_recharge_packages
    WHERE is_active = true
    ORDER BY sort_order ASC, amount_cents ASC
  `;
}

export async function getMorfAiAdminSnapshot() {
  await ensureMorfAiCoreTables();

  const [settings] = await client<AnyRecord[]>`
    SELECT
      id,
      default_provider,
      default_model,
      markup_percent::text,
      default_message_cost_cents::int,
      enable_smart_routing,
      enable_client_own_key,
      metadata
    FROM morf_ai_global_settings
    WHERE id = 1
    LIMIT 1
  `;

  const packages = await client<RechargePackageRow[]>`
    SELECT id::int, code, name, description, amount_cents::int, credit_cents::int, currency,
           NULLIF(COALESCE(polar_product_id, ''), '') AS polar_product_id,
           NULLIF(COALESCE(polar_price_id, ''), '') AS polar_price_id,
           is_active,
           sort_order
    FROM morf_ai_recharge_packages
    ORDER BY sort_order ASC, amount_cents ASC
  `;

  const [summary] = await client<AnyRecord[]>`
    SELECT
      COALESCE(SUM(balance_cents), 0)::bigint AS total_balance_cents,
      COUNT(*)::int AS wallet_count,
      (SELECT COUNT(*)::int FROM morf_ai_recharges WHERE status IN ('completed','paid','credited')) AS completed_recharges,
      (SELECT COALESCE(SUM(customer_cost_cents), 0)::bigint FROM morf_ai_usage_logs WHERE created_at >= NOW() - INTERVAL '30 days') AS usage_30d_cents
    FROM morf_ai_wallets
  `;

  const coupons = await client<MorfAiCouponRow[]>`
    SELECT id::int,
           code,
           description,
           bonus_credit_cents::int,
           max_redemptions,
           redeemed_count,
           expires_at,
           is_active
    FROM morf_ai_coupons
    ORDER BY created_at DESC, id DESC
  `;

  return { settings: settings || {}, packages, coupons, summary: summary || {} };
}

export async function getMorfAiTeamDashboard(teamId: number) {
  const wallet = await ensureMorfAiWallet(teamId);
  const packages = await getMorfAiRechargePackages();

  const recharges = await client<AnyRecord[]>`
    SELECT amount_cents::int, credited_cents::int, currency, status, created_at
    FROM morf_ai_recharges
    WHERE team_id = ${teamId}
      AND status NOT IN ('failed','cancelled','expired')
    ORDER BY created_at DESC
    LIMIT 10
  `;

  const [usage] = await client<AnyRecord[]>`
    SELECT
      COALESCE(SUM(customer_cost_cents), 0)::int AS total_cost_cents,
      COUNT(*)::int AS total_events
    FROM morf_ai_usage_logs
    WHERE team_id = ${teamId}
      AND created_at >= NOW() - INTERVAL '30 days'
  `;

  const access = await getMorfAiAccess(teamId);
  return { wallet, packages, recharges, usage: usage || { total_cost_cents: 0, total_events: 0 }, access };
}

export async function getMorfAiAccess(teamId: number) {
  await ensureMorfAiCoreTables();

  const [row] = await client<AnyRecord[]>`
    SELECT
      t.id AS team_id,
      t.plan_id,
      COALESCE(p.is_ai_enabled, false) AS plan_ai_enabled,
      COALESCE(wallet.balance_cents, 0)::bigint AS balance_cents,
      COALESCE(wallet.status, 'active') AS wallet_status,
      team_settings.is_enabled AS team_override_enabled,
      COALESCE(team_settings.status, 'inherit') AS team_override_status,
      EXISTS (
        SELECT 1
        FROM plan_module_entitlements pme
        WHERE pme.plan_id = t.plan_id
          AND pme.module_code IN (${MORF_AI_MODULE_CODE}, 'ai_basic', 'ia_basica', 'agente_ia_basico')
          AND pme.is_allowed = true
      ) AS plan_module_enabled,
      EXISTS (
        SELECT 1
        FROM team_module_subscriptions tms
        WHERE tms.team_id = t.id
          AND tms.module_code IN (${MORF_AI_MODULE_CODE}, 'ai_basic', 'ia_basica', 'agente_ia_basico')
          AND tms.status IN ('active','trialing')
      ) AS team_module_enabled
    FROM teams t
    LEFT JOIN plans p ON p.id = t.plan_id
    LEFT JOIN morf_ai_wallets wallet ON wallet.team_id = t.id
    LEFT JOIN morf_ai_team_settings team_settings ON team_settings.team_id = t.id
    WHERE t.id = ${teamId}
    LIMIT 1
  `;

  if (!row) {
    return {
      allowed: false,
      reason: 'team_not_found',
      message: 'No se pudo validar el equipo activo.',
      balanceCents: 0,
      status: 'inactive',
    };
  }

  const explicitlyDisabled = row.team_override_enabled === false || String(row.team_override_status || '').toLowerCase() === 'disabled';
  const allowedByPlanOrTeam = Boolean(row.plan_ai_enabled || row.plan_module_enabled || row.team_module_enabled || row.team_override_enabled === true);
  const balanceCents = Number(row.balance_cents || 0);
  const walletActive = !['disabled', 'blocked', 'paused'].includes(String(row.wallet_status || '').toLowerCase());

  if (explicitlyDisabled || !allowedByPlanOrTeam) {
    return {
      allowed: false,
      reason: 'plan_not_allowed',
      message: 'Morf AI no está incluido en tu plan actual. Actualiza tu plan o compra créditos para activar el servicio.',
      balanceCents,
      status: row.wallet_status || 'inactive',
    };
  }

  if (!walletActive) {
    return {
      allowed: false,
      reason: 'wallet_not_active',
      message: 'Morf AI no está disponible para este equipo en este momento.',
      balanceCents,
      status: row.wallet_status || 'paused',
    };
  }

  if (balanceCents <= 0) {
    return {
      allowed: false,
      reason: 'no_balance',
      message: 'Recarga créditos para continuar usando Morf AI.',
      balanceCents,
      status: row.wallet_status || 'active',
    };
  }

  return {
    allowed: true,
    reason: 'ok',
    message: 'Tu saldo Morf AI está disponible.',
    balanceCents,
    status: row.wallet_status || 'active',
  };
}

/**
 * Billing guard para shadow: requiere el kill-switch global y una aprobacion
 * persistida en el tenant. Ningun modulo puede habilitar cobro shadow solo con
 * parametros de la llamada.
 */
export async function isMorfBilledShadowApproved(teamId: number) {
  if (process.env.VENDOR_AI_ALLOW_BILLED_SHADOW !== 'true') return false;
  await ensureMorfAiCoreTables();
  const [row] = await client<AnyRecord[]>`
    SELECT
      COALESCE((metadata ->> 'vendor_ai_allow_billed_shadow')::boolean, false) AS approved,
      COALESCE(status, 'inherit') AS status
    FROM morf_ai_team_settings
    WHERE team_id = ${teamId}
    LIMIT 1
  `;
  return Boolean(row?.approved) && !['disabled', 'blocked', 'paused'].includes(String(row?.status || '').toLowerCase());
}

export type MorfAiCostEstimate = {
  providerCostCents: number;
  providerCostExactCents: number;
  customerCostCents: number;
  pricing: 'configured' | 'not_configured';
  priceSource: string | null;
  markupPercent: number;
};

export async function estimateMorfAiCustomerCostCents(params: {
  provider: string;
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): Promise<MorfAiCostEstimate> {
  await ensureMorfAiCoreTables();
  const [settings] = await client<{ markup_percent: string | number | null }[]>`
    SELECT markup_percent
    FROM morf_ai_global_settings
    WHERE id = 1
    LIMIT 1
  `;
  const parsedMarkup = Number(settings?.markup_percent);
  const markupPercent = Number.isFinite(parsedMarkup) && parsedMarkup >= 0 ? parsedMarkup : 15;

  const provider = String(params.provider || '').trim();
  const model = String(params.model || '').trim();
  const inputTokens = Math.max(0, Math.round(Number(params.inputTokens) || 0));
  const outputTokens = Math.max(0, Math.round(Number(params.outputTokens) || 0));

  // 1) Precio dinámico del Super Admin (morf_ai_provider_pricing): coincidencia
  // exacta (provider, model); si no, cualquier fila publicada de CodeMorf con
  // ese modelo o su forma sin prefijo de proveedor.
  let price: { inputCentsPerMillion: number; outputCentsPerMillion: number; source: string } | null = null;
  if (provider && model) {
    const strippedModel = model.includes('/') ? model.slice(model.indexOf('/') + 1) : model;
    const rows = await client<AnyRecord[]>`
      SELECT input_per_million_cents::numeric::float8 AS input_cents,
             output_per_million_cents::numeric::float8 AS output_cents,
             COALESCE(source_url, '') AS source_url
      FROM morf_ai_provider_pricing
      WHERE is_active = true
        AND ((provider = ${provider} AND model = ${model})
          OR (source_url ILIKE '%codemorf%' AND model IN (${model}, ${strippedModel})))
      ORDER BY (provider = ${provider}) DESC
      LIMIT 1
    `;
    if (rows[0]) {
      price = {
        inputCentsPerMillion: Number(rows[0].input_cents),
        outputCentsPerMillion: Number(rows[0].output_cents),
        source: String(rows[0].source_url || '') || 'morf_ai_provider_pricing',
      };
    }
  }

  // 2) Fallback: mapa estático de precios publicados (pricing.ts).
  if (!price) {
    const table = getProviderPriceTable(provider, model);
    if (table) {
      price = {
        inputCentsPerMillion: table.inputUsdPerMillion * 100,
        outputCentsPerMillion: table.outputUsdPerMillion * 100,
        source: table.source,
      };
    }
  }

  if (!price) {
    return {
      providerCostCents: 0,
      providerCostExactCents: 0,
      customerCostCents: 0,
      pricing: 'not_configured',
      priceSource: null,
      markupPercent,
    };
  }

  const providerCostExactCents =
    (inputTokens * price.inputCentsPerMillion + outputTokens * price.outputCentsPerMillion) / 1_000_000;
  const providerCostCents = Math.round(providerCostExactCents);
  const customerCostCents = customerCostCentsFromProviderCents(providerCostExactCents, markupPercent);
  return {
    providerCostCents,
    providerCostExactCents,
    customerCostCents,
    pricing: 'configured',
    priceSource: price.source,
    markupPercent,
  };
}

export async function recordMorfAiUsage(params: {
  teamId: number;
  chatId?: number | null;
  moduleCode?: string | null;
  provider: string;
  model: string;
  inputText?: string | null;
  outputText?: string | null;
  /** Tokens reales reportados por el provider (Fase 3). Si faltan, se estiman del texto. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  requestKey?: string | null;
  metadata?: AnyRecord;
}) {
  await ensureMorfAiCoreTables();
  await ensureMorfAiWallet(params.teamId);

  const hasRealTokens = Number.isFinite(params.inputTokens) && Number.isFinite(params.outputTokens);
  const inputTokens = hasRealTokens
    ? Math.max(0, Math.round(Number(params.inputTokens)))
    : Math.ceil(String(params.inputText || '').length / 4);
  const outputTokens = hasRealTokens
    ? Math.max(0, Math.round(Number(params.outputTokens)))
    : Math.ceil(String(params.outputText || '').length / 4);

  // Cobro por token x precio publicado (morf_ai_provider_pricing del Super
  // Admin; fallback pricing.ts) x (1 + markup_percent/100). Sin precio
  // configurado -> 0 centavos: nunca se inventa un precio.
  const estimate = await estimateMorfAiCustomerCostCents({
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
  });
  const customerCostCents = estimate.customerCostCents;
  const markupPercent = estimate.markupPercent;
  const providerCostCents = estimate.providerCostCents;
  const requestKey = String(params.requestKey || '').trim().slice(0, 220) || null;
  return client.begin(async (tx) => {
    await tx`SELECT team_id FROM morf_ai_wallets WHERE team_id = ${params.teamId} FOR UPDATE`;
    const inserted = await tx<AnyRecord[]>`
      INSERT INTO morf_ai_usage_logs (
        team_id, chat_id, module_code, provider, model, input_tokens,
        output_tokens, provider_cost_cents, customer_cost_cents,
        markup_percent, status, request_key, metadata, created_at
      ) VALUES (
        ${params.teamId}, ${params.chatId || null}, ${params.moduleCode || 'base_ai'},
        ${params.provider}, ${params.model}, ${inputTokens}, ${outputTokens},
        ${providerCostCents}, ${customerCostCents}, ${markupPercent}, 'completed',
        ${requestKey}, ${safeJson({
          ...(params.metadata || {}),
          estimated: !hasRealTokens,
          pricing: estimate.pricing,
          price_source: estimate.priceSource,
          provider_cost_exact_cents: estimate.providerCostExactCents,
        })}::jsonb, NOW()
      )
      ON CONFLICT (team_id, request_key) WHERE request_key IS NOT NULL DO NOTHING
      RETURNING id
    `;
    if (requestKey && !inserted[0]) {
      return { ok: true as const, idempotent: true, requestKey };
    }
    await tx`
      UPDATE morf_ai_wallets
      SET balance_cents = GREATEST(0, balance_cents - ${customerCostCents}),
          updated_at = NOW()
      WHERE team_id = ${params.teamId}
    `;
    return { ok: true as const, idempotent: false, requestKey, usageLogId: inserted[0]?.id || null };
  });
}

export async function createMorfAiRechargeCheckout(input: {
  teamId: number;
  userId: number;
  userEmail: string;
  userName?: string | null;
  packageId: number;
  couponCode?: string | null;
  successUrl: string;
  cancelUrl: string;
  customerIpAddress?: string | null;
}) {
  await ensureMorfAiCoreTables();
  await ensureMorfAiWallet(input.teamId);

  const [pack] = await client<RechargePackageRow[]>`
    SELECT id::int, code, name, description, amount_cents::int, credit_cents::int, currency,
           NULLIF(COALESCE(polar_product_id, ''), '') AS polar_product_id,
           NULLIF(COALESCE(polar_price_id, ''), '') AS polar_price_id,
           is_active,
           sort_order
    FROM morf_ai_recharge_packages
    WHERE id = ${input.packageId}
      AND is_active = true
    LIMIT 1
  `;

  if (!pack) return { ok: false as const, reason: 'package_not_available' };
  if (!isRealPolarId(pack.polar_product_id)) return { ok: false as const, reason: 'package_not_connected' };

  const couponCode = String(input.couponCode || '').trim().toUpperCase().slice(0, 64);
  let coupon: MorfAiCouponRow | null = null;
  if (couponCode) {
    const [matchedCoupon] = await client<MorfAiCouponRow[]>`
      SELECT id::int,
             code,
             description,
             bonus_credit_cents::int,
             max_redemptions,
             redeemed_count,
             expires_at,
             is_active
      FROM morf_ai_coupons
      WHERE code = ${couponCode}
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
        AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)
      LIMIT 1
    `;
    if (!matchedCoupon || Number(matchedCoupon.bonus_credit_cents || 0) <= 0) {
      return { ok: false as const, reason: 'coupon_invalid' };
    }
    coupon = matchedCoupon;
  }

  const [recharge] = await client<{ id: number }[]>`
    INSERT INTO morf_ai_recharges (
      team_id,
      package_id,
      provider,
      amount_cents,
      credited_cents,
      currency,
      coupon_id,
      coupon_code,
      coupon_bonus_cents,
      status,
      polar_product_id,
      polar_price_id,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      ${input.teamId},
      ${pack.id},
      'polar',
      ${pack.amount_cents},
      ${pack.credit_cents},
      ${pack.currency},
      ${coupon?.id || null},
      ${coupon?.code || null},
      ${Number(coupon?.bonus_credit_cents || 0)},
      'pending',
      ${pack.polar_product_id},
      ${pack.polar_price_id || null},
      ${safeJson({ package_code: pack.code, package_name: pack.name, source: 'morf_ai_recharge_checkout', coupon_code: coupon?.code || null, coupon_bonus_cents: Number(coupon?.bonus_credit_cents || 0) })}::jsonb,
      NOW(),
      NOW()
    )
    RETURNING id::int
  `;

  const metadata = {
    billing_type: 'morf_ai_recharge',
    source: 'allsender_morf_ai',
    tenant_id: String(input.teamId),
    team_id: String(input.teamId),
    user_id: String(input.userId),
    recharge_id: String(recharge.id),
    package_id: String(pack.id),
    package_code: pack.code,
    amount_cents: String(pack.amount_cents),
    credit_cents: String(pack.credit_cents),
    currency: pack.currency,
    coupon_code: coupon?.code || null,
    coupon_bonus_cents: String(coupon?.bonus_credit_cents || 0),
  };

  const polar = getPolarClient();
  const checkout = await polar.checkouts.create({
    products: [pack.polar_product_id],
    externalCustomerId: `team_${input.teamId}`,
    customerEmail: input.userEmail,
    customerName: input.userName || undefined,
    customerIpAddress: input.customerIpAddress || undefined,
    successUrl: input.successUrl,
    returnUrl: input.cancelUrl,
    allowDiscountCodes: false,
    metadata,
    customerMetadata: {
      team_id: String(input.teamId),
      user_id: String(input.userId),
      source: 'allsender_morf_ai_recharge',
    },
  });

  const checkoutId = checkout?.id || null;
  const checkoutUrl = checkout?.url || checkout?.checkoutUrl || null;

  if (!checkoutUrl) {
    await client`
      UPDATE morf_ai_recharges
      SET status = 'failed', updated_at = NOW(), metadata = metadata || ${safeJson({ reason: 'checkout_not_available' })}::jsonb
      WHERE id = ${recharge.id}
    `;
    return { ok: false as const, reason: 'checkout_not_available' };
  }

  await client`
    UPDATE morf_ai_recharges
    SET checkout_id = ${checkoutId},
        status = 'checkout_created',
        metadata = metadata || ${safeJson({ checkout_url_created: true })}::jsonb,
        updated_at = NOW()
    WHERE id = ${recharge.id}
  `;

  try {
    await client`
      INSERT INTO polar_checkout_sessions (
        checkout_id,
        team_id,
        user_id,
        plan_id,
        polar_product_id,
        polar_price_id,
        checkout_url,
        status,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        ${checkoutId},
        ${input.teamId},
        ${input.userId},
        NULL,
        ${pack.polar_product_id},
        ${pack.polar_price_id || null},
        ${checkoutUrl},
        'created',
        ${safeJson(metadata)}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT (checkout_id) DO UPDATE SET
        checkout_url = EXCLUDED.checkout_url,
        metadata = polar_checkout_sessions.metadata || EXCLUDED.metadata,
        updated_at = NOW()
    `;
  } catch {
    // El checkout ya existe en Polar; el registro Morf AI conserva la trazabilidad comercial.
  }

  return { ok: true as const, checkoutUrl, checkoutId, package: pack, rechargeId: recharge.id };
}

export async function completeMorfAiRechargeFromPolar(input: {
  teamId: number;
  checkoutId?: string | null;
  orderId?: string | null;
  paymentId?: string | null;
  metadata?: AnyRecord;
}) {
  await ensureMorfAiCoreTables();
  await ensureMorfAiWallet(input.teamId);

  const meta = input.metadata || {};
  const rechargeId = Number(meta.recharge_id || meta.rechargeId || 0);
  const packageId = Number(meta.package_id || meta.packageId || 0);
  const checkoutId = cleanText(input.checkoutId || meta.checkout_id || meta.checkoutId);

  // Acreditación idempotente y atómica: la fila de recarga se bloquea con FOR UPDATE
  // dentro de una única transacción, de modo que dos webhooks concurrentes (p. ej.
  // checkout.confirmed + order.paid con event_ids distintos) serializan el crédito:
  // solo el primero ve status 'checkout_created' y acredita; el resto ve 'completed'.
  const outcome = await client.begin(async (tx) => {
    let recharge: AnyRecord | undefined;
    if (rechargeId > 0) {
      recharge = (await tx<AnyRecord[]>`SELECT * FROM morf_ai_recharges WHERE id = ${rechargeId} LIMIT 1 FOR UPDATE`)[0];
    }
    if (!recharge && checkoutId) {
      recharge = (await tx<AnyRecord[]>`SELECT * FROM morf_ai_recharges WHERE checkout_id = ${checkoutId} ORDER BY created_at DESC LIMIT 1 FOR UPDATE`)[0];
    }
    if (!recharge && packageId > 0) {
      recharge = (await tx<AnyRecord[]>`
        SELECT *
        FROM morf_ai_recharges
        WHERE team_id = ${input.teamId}
          AND package_id = ${packageId}
          AND status IN ('pending','checkout_created')
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE
      `)[0];
    }

    if (!recharge) return { ok: false as const, reason: 'recharge_not_found' };
    if (['completed', 'paid', 'credited'].includes(String(recharge.status || '').toLowerCase())) {
      return { ok: true as const, alreadyCredited: true, creditedCents: moneyCents(recharge.credited_cents) };
    }

    const creditedCents = moneyCents(recharge.credited_cents, Number(meta.credit_cents || 0));
    if (creditedCents <= 0) return { ok: false as const, reason: 'credit_not_available' };

    let couponBonusCents = 0;
    const couponId = Number(recharge.coupon_id || 0);
    if (couponId > 0 && Number(recharge.coupon_bonus_cents || 0) > 0) {
      const [coupon] = await tx<AnyRecord[]>`
        SELECT id, max_redemptions, redeemed_count, is_active, expires_at
        FROM morf_ai_coupons
        WHERE id = ${couponId}
        LIMIT 1
        FOR UPDATE
      `;
      const couponStillValid = Boolean(
        coupon &&
        coupon.is_active !== false &&
        (!coupon.expires_at || new Date(coupon.expires_at).getTime() > Date.now()) &&
        (coupon.max_redemptions === null || Number(coupon.redeemed_count || 0) < Number(coupon.max_redemptions)),
      );
      if (couponStillValid) {
        const insertedRedemption = await tx<AnyRecord[]>`
          INSERT INTO morf_ai_coupon_redemptions (coupon_id, recharge_id, team_id, bonus_credit_cents, created_at)
          VALUES (${couponId}, ${Number(recharge.id)}, ${input.teamId}, ${moneyCents(recharge.coupon_bonus_cents)}, NOW())
          ON CONFLICT (coupon_id, recharge_id) DO NOTHING
          RETURNING id
        `;
        if (insertedRedemption.length) {
          couponBonusCents = moneyCents(recharge.coupon_bonus_cents);
          await tx`
            UPDATE morf_ai_coupons
            SET redeemed_count = redeemed_count + 1,
                updated_at = NOW()
            WHERE id = ${couponId}
          `;
        }
      }
    }

    const totalCreditCents = creditedCents + couponBonusCents;

    await tx`
      UPDATE morf_ai_wallets
      SET balance_cents = balance_cents + ${totalCreditCents},
          currency = COALESCE(NULLIF(${recharge.currency || 'USD'}, ''), currency),
          updated_at = NOW()
      WHERE team_id = ${input.teamId}
    `;

    await tx`
      INSERT INTO morf_ai_wallet_transactions (
        team_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
      )
      SELECT ${input.teamId}, ${`morf_recharge:${Number(recharge.id)}`}, 'recharge', ${totalCreditCents}, balance_cents,
             ${safeJson({ recharge_id: Number(recharge.id), coupon_code: recharge.coupon_code || null, coupon_bonus_cents: couponBonusCents, source: 'polar_webhook' })}::jsonb,
             NOW()
      FROM morf_ai_wallets WHERE team_id = ${input.teamId}
      ON CONFLICT (team_id, transaction_key) DO NOTHING
    `;

    await tx`
      UPDATE morf_ai_recharges
      SET status = 'completed',
          checkout_id = COALESCE(NULLIF(${checkoutId || ''}, ''), checkout_id),
          external_payment_id = COALESCE(NULLIF(${input.orderId || input.paymentId || ''}, ''), external_payment_id),
          metadata = metadata || ${safeJson({ ...meta, completed_from: 'polar_webhook', order_id: input.orderId || null, payment_id: input.paymentId || null })}::jsonb,
          updated_at = NOW()
      WHERE id = ${Number(recharge.id)}
    `;

    return { ok: true as const, creditedCents: totalCreditCents, baseCreditedCents: creditedCents, couponBonusCents, rechargeId: Number(recharge.id) };
  });

  return outcome;
}

export async function grantMorfAiPromotionalCredit(input: {
  teamId: number;
  amountCents: number;
  transactionKey: string;
  metadata?: AnyRecord;
}) {
  await ensureMorfAiCoreTables();
  const amountCents = moneyCents(input.amountCents);
  if (amountCents <= 0) return { ok: false as const, reason: 'credit_invalid' };
  const transactionKey = cleanText(input.transactionKey)?.slice(0, 180);
  if (!transactionKey) return { ok: false as const, reason: 'transaction_key_required' };

  return client.begin(async (tx) => {
    await tx`
      INSERT INTO morf_ai_wallets (team_id, currency, markup_percent, status, created_at, updated_at)
      VALUES (${input.teamId}, 'USD', COALESCE((SELECT markup_percent FROM morf_ai_global_settings WHERE id = 1), 15.00), 'active', NOW(), NOW())
      ON CONFLICT (team_id) DO NOTHING
    `;
    const [wallet] = await tx<AnyRecord[]>`
      SELECT balance_cents FROM morf_ai_wallets WHERE team_id = ${input.teamId} LIMIT 1 FOR UPDATE
    `;
    if (!wallet) return { ok: false as const, reason: 'wallet_not_found' };

    const inserted = await tx<AnyRecord[]>`
      INSERT INTO morf_ai_wallet_transactions (
        team_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
      )
      VALUES (
        ${input.teamId}, ${transactionKey}, 'promotional_credit', ${amountCents}, ${moneyCents(wallet.balance_cents) + amountCents},
        ${safeJson({ ...(input.metadata || {}), source: 'super_admin_promotional_credit', transaction_key: transactionKey })}::jsonb, NOW()
      )
      ON CONFLICT (team_id, transaction_key) DO NOTHING
      RETURNING id
    `;
    if (!inserted.length) {
      return { ok: true as const, alreadyApplied: true, balanceCents: moneyCents(wallet.balance_cents) };
    }

    const [updatedWallet] = await tx<AnyRecord[]>`
      UPDATE morf_ai_wallets
      SET balance_cents = balance_cents + ${amountCents}, updated_at = NOW()
      WHERE team_id = ${input.teamId}
      RETURNING balance_cents
    `;
    await tx`
      INSERT INTO morf_ai_recharges (
        team_id, provider, amount_cents, credited_cents, currency, status, metadata, created_at, updated_at
      ) VALUES (
        ${input.teamId}, 'admin', 0, ${amountCents}, 'USD', 'completed',
        ${safeJson({ ...(input.metadata || {}), source: 'super_admin_promotional_credit', transaction_key: transactionKey })}::jsonb, NOW(), NOW()
      )
    `;
    return { ok: true as const, alreadyApplied: false, balanceCents: moneyCents(updatedWallet?.balance_cents) };
  });
}
