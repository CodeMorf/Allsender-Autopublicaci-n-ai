import 'server-only';

import { client } from '@/lib/db/drizzle';

type AnyRecord = Record<string, any>;

export type VendorAiReservation = {
  ok: boolean;
  code: string;
  usageLogId?: number;
  requestKey: string;
  reservedCustomerCostCents: number;
  balanceCents: number;
  markupPercent: number;
  idempotent: boolean;
};

export function customerCostFromProviderCost(providerCostCents: number, markupPercent: number) {
  const provider = Math.max(0, Number(providerCostCents) || 0);
  const markup = Math.max(0, Number(markupPercent) || 0);
  if (provider === 0) return 0;
  return Math.max(1, Math.ceil(provider * (1 + markup / 100)));
}

export async function calculateVendorAiProviderCost(input: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  providerCalls: number;
  cachedInputTokens?: number;
}) {
  const [pricing] = await client<AnyRecord[]>`
    SELECT input_per_million_cents, cached_input_per_million_cents,
           output_per_million_cents, request_cost_cents, currency, source_url, effective_at
    FROM morf_ai_provider_pricing
    WHERE provider = ${input.provider} AND model = ${input.model} AND is_active = true
    LIMIT 1
  `;
  if (!pricing) return { ok: false as const, code: 'provider_pricing_not_configured', providerCostCents: 0 };
  const totalInputTokens = Math.max(0, Number(input.inputTokens) || 0);
  const cachedInputTokens = Math.min(totalInputTokens, Math.max(0, Number(input.cachedInputTokens) || 0));
  const uncachedInputTokens = Math.max(0, totalInputTokens - cachedInputTokens);
  const inputRate = numeric(pricing.input_per_million_cents);
  const cachedRate = pricing.cached_input_per_million_cents == null
    ? inputRate
    : numeric(pricing.cached_input_per_million_cents);
  const exactProviderCostCents =
    (uncachedInputTokens * inputRate / 1_000_000) +
    (cachedInputTokens * cachedRate / 1_000_000) +
    (Math.max(0, input.outputTokens) * numeric(pricing.output_per_million_cents) / 1_000_000) +
    (Math.max(0, input.providerCalls) * numeric(pricing.request_cost_cents));
  return {
    ok: true as const,
    code: 'provider_cost_calculated',
    providerCostCents: exactProviderCostCents === 0 ? 0 : Math.max(1, Math.ceil(exactProviderCostCents)),
    exactProviderCostCents,
    inputTokens: totalInputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    sourceUrl: String(pricing.source_url || ''),
    effectiveAt: pricing.effective_at || null,
  };
}

export async function calculateVendorAiAudioProviderCost(input: { provider: string; model: string; durationSeconds: number }) {
  const [pricing] = await client<AnyRecord[]>`
    SELECT audio_per_minute_cents, source_url, effective_at
    FROM morf_ai_provider_pricing
    WHERE provider = ${input.provider} AND model = ${input.model} AND is_active = true
    LIMIT 1
  `;
  if (!pricing) return { ok: false as const, code: 'audio_provider_pricing_not_configured', exactProviderCostCents: 0 };
  if (!(input.durationSeconds > 0)) return { ok: false as const, code: 'audio_duration_required_for_billing', exactProviderCostCents: 0 };
  const exactProviderCostCents = (input.durationSeconds / 60) * numeric(pricing.audio_per_minute_cents);
  return { ok: true as const, code: 'audio_provider_cost_calculated', exactProviderCostCents, sourceUrl: String(pricing.source_url || ''), effectiveAt: pricing.effective_at || null };
}

function boundedKey(value: string) {
  return String(value || '').trim().slice(0, 180);
}

const STALE_RESERVATION_MS = 15 * 60_000;

/** Crédito inicial único ($5 USD) para equipos con plan de pago (amount > 0). */
const VENTA_AI_PAID_PLAN_INITIAL_CREDIT_CENTS = 500;

function isStaleReservation(reservedAt: unknown) {
  if (!reservedAt) return true; // missing timestamp (pre-migration / crash) → treat as stale
  const time = new Date(reservedAt as any).getTime();
  return Number.isFinite(time) && Date.now() - time > STALE_RESERVATION_MS;
}

function numeric(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function ensureWalletAndInitialCredit(teamId: number) {
  return client.begin(async (tx) => {
    const [settings] = await tx<AnyRecord[]>`
      SELECT markup_percent, initial_credit_enabled, initial_credit_cents
      FROM morf_ai_global_settings WHERE id = 1 LIMIT 1
    `;
    if (!settings) throw new Error('morf_ai_settings_missing');
    await tx`
      INSERT INTO morf_ai_wallets (team_id, balance_cents, currency, markup_percent, status, metadata, created_at, updated_at)
      VALUES (${teamId}, 0, 'USD', ${numeric(settings.markup_percent)}, 'active', '{}'::jsonb, NOW(), NOW())
      ON CONFLICT (team_id) DO NOTHING
    `;
    const [plan] = await tx<AnyRecord[]>`
      SELECT COALESCE(p.amount, 0) AS plan_amount
      FROM teams t
      LEFT JOIN plans p ON p.id = t.plan_id
      WHERE t.id = ${teamId} LIMIT 1
    `;
    const baseCredit = settings.initial_credit_enabled ? Math.max(0, Math.round(numeric(settings.initial_credit_cents))) : 0;
    const paidPlanCredit = numeric(plan?.plan_amount) > 0 ? VENTA_AI_PAID_PLAN_INITIAL_CREDIT_CENTS : 0;
    const initialCredit = Math.max(baseCredit, paidPlanCredit);
    if (initialCredit > 0) {
      const metadata = paidPlanCredit > baseCredit
        ? { source: 'plan_entitlement_venta_ai', plan_amount_cents: numeric(plan?.plan_amount) }
        : { source: 'morf_ai_global_settings' };
      const inserted = await tx<AnyRecord[]>`
        INSERT INTO morf_ai_wallet_transactions (
          team_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
        )
        SELECT ${teamId}, 'initial_credit', 'initial_credit', ${initialCredit}, balance_cents + ${initialCredit},
               ${JSON.stringify(metadata)}::jsonb, NOW()
        FROM morf_ai_wallets WHERE team_id = ${teamId}
        ON CONFLICT (team_id, transaction_key) DO NOTHING
        RETURNING id
      `;
      if (inserted.length) {
        await tx`
          UPDATE morf_ai_wallets
          SET balance_cents = balance_cents + ${initialCredit}, updated_at = NOW()
          WHERE team_id = ${teamId}
        `;
      }
    }
    const [wallet] = await tx<AnyRecord[]>`
      SELECT balance_cents, markup_percent, status FROM morf_ai_wallets WHERE team_id = ${teamId} LIMIT 1
    `;
    return wallet;
  });
}

async function hasVendorAiEntitlement(teamId: number) {
  const [row] = await client<AnyRecord[]>`
    SELECT
      COALESCE(p.is_ai_enabled, false) AS plan_ai_enabled,
      settings.is_enabled AS team_override_enabled,
      COALESCE(settings.status, 'inherit') AS team_override_status,
      EXISTS (
        SELECT 1 FROM plan_module_entitlements pme
        WHERE pme.plan_id = t.plan_id
          AND pme.module_code IN ('morf_ai', 'ai_basic', 'ia_basica')
          AND pme.is_allowed = true
      ) AS plan_module_enabled,
      EXISTS (
        SELECT 1 FROM team_module_subscriptions tms
        WHERE tms.team_id = t.id
          AND tms.module_code IN ('morf_ai', 'ai_basic', 'ia_basica')
          AND tms.status IN ('active', 'trialing')
      ) AS team_module_enabled
    FROM teams t
    LEFT JOIN plans p ON p.id = t.plan_id
    LEFT JOIN morf_ai_team_settings settings ON settings.team_id = t.id
    WHERE t.id = ${teamId}
    LIMIT 1
  `;
  if (!row) return false;
  const disabled = row.team_override_enabled === false || String(row.team_override_status).toLowerCase() === 'disabled';
  return !disabled && Boolean(row.plan_ai_enabled || row.plan_module_enabled || row.team_module_enabled || row.team_override_enabled === true);
}

export async function getVendorAiReserveEstimateCents() {
  const [settings] = await client<AnyRecord[]>`
    SELECT vendor_ai_reserve_cents FROM morf_ai_global_settings WHERE id = 1 LIMIT 1
  `;
  return Math.max(1, Math.round(numeric(settings?.vendor_ai_reserve_cents) || 10));
}

export async function reserveVendorAiUsage(input: {
  teamId: number;
  chatId: number;
  requestKey: string;
  provider: string;
  model: string;
  estimatedCustomerCostCents?: number;
  moduleCode?: string;
  metadata?: AnyRecord;
}): Promise<VendorAiReservation> {
  const requestKey = boundedKey(input.requestKey);
  if (!requestKey) return { ok: false, code: 'request_key_required', requestKey, reservedCustomerCostCents: 0, balanceCents: 0, markupPercent: 0, idempotent: false };
  if (!(await hasVendorAiEntitlement(input.teamId))) {
    return { ok: false, code: 'entitlement_required', requestKey, reservedCustomerCostCents: 0, balanceCents: 0, markupPercent: 0, idempotent: false };
  }
  await ensureWalletAndInitialCredit(input.teamId);
  const estimate = Math.max(1, Math.round(input.estimatedCustomerCostCents || await getVendorAiReserveEstimateCents()));
  return client.begin(async (tx) => {
    // Lock the team wallet FIRST: this serializes concurrent reserves for the same team
    // (READ COMMITTED → the second tx re-reads the usage log after the first commits,
    // so the same request can never be reserved twice and stale recovery cannot double-refund).
    const [wallet] = await tx<AnyRecord[]>`
      SELECT balance_cents, markup_percent, status
      FROM morf_ai_wallets WHERE team_id = ${input.teamId} FOR UPDATE
    `;
    if (!wallet || ['disabled', 'blocked', 'paused'].includes(String(wallet.status).toLowerCase())) {
      return { ok: false, code: 'wallet_not_active', requestKey, reservedCustomerCostCents: 0, balanceCents: numeric(wallet?.balance_cents), markupPercent: numeric(wallet?.markup_percent), idempotent: false };
    }
    const [existing] = await tx<AnyRecord[]>`
      SELECT id, status, reserved_customer_cost_cents, markup_percent, attempt_count, reserved_at
      FROM morf_ai_usage_logs
      WHERE team_id = ${input.teamId} AND request_key = ${requestKey}
      LIMIT 1
    `;
    if (existing && String(existing.status) === 'reserved' && isStaleReservation(existing.reserved_at)) {
      const refund = numeric(existing.reserved_customer_cost_cents);
      const balanceAfterRefund = numeric(wallet.balance_cents) + refund;
      await tx`
        UPDATE morf_ai_wallets SET balance_cents = ${balanceAfterRefund}, updated_at = NOW()
        WHERE team_id = ${input.teamId}
      `;
      await tx`
        UPDATE morf_ai_usage_logs
        SET status = 'stale_recovered', error_code = 'stale_reservation_recovered', reconciled_at = NOW()
        WHERE id = ${numeric(existing.id)}
      `;
      await tx`
        INSERT INTO morf_ai_wallet_transactions (
          team_id, usage_log_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
        ) VALUES (
          ${input.teamId}, ${numeric(existing.id)}, ${`recover:${requestKey}:${numeric(existing.attempt_count)}`}, 'usage_recovery', ${refund}, ${balanceAfterRefund},
          ${JSON.stringify({ recovered: true })}::jsonb, NOW()
        ) ON CONFLICT (team_id, transaction_key) DO NOTHING
      `;
      wallet.balance_cents = balanceAfterRefund;
    } else if (existing && !['failed', 'stale_recovered'].includes(String(existing.status))) {
      const status = String(existing.status);
      return { ok: ['reserved', 'completed', 'completed_shortfall', 'shadow_metered'].includes(status), code: `usage_${status}`, usageLogId: numeric(existing.id), requestKey, reservedCustomerCostCents: numeric(existing.reserved_customer_cost_cents), balanceCents: numeric(wallet.balance_cents), markupPercent: numeric(existing.markup_percent), idempotent: true };
    }
    if (numeric(wallet.balance_cents) < estimate) {
      return { ok: false, code: 'insufficient_balance', requestKey, reservedCustomerCostCents: 0, balanceCents: numeric(wallet.balance_cents), markupPercent: numeric(wallet.markup_percent), idempotent: false };
    }
    const attempt = existing ? numeric(existing.attempt_count) + 1 : 0;
    const inserted = existing
      ? await tx<AnyRecord[]>`
          UPDATE morf_ai_usage_logs
          SET status = 'reserved', reserved_customer_cost_cents = ${estimate}, customer_cost_cents = 0,
              provider_cost_cents = 0, input_tokens = 0, output_tokens = 0, error_code = NULL,
              reconciled_at = NULL, reserved_at = NOW(), attempt_count = ${attempt}, metadata = metadata || ${JSON.stringify({ retry_reserved: true })}::jsonb
          WHERE id = ${numeric(existing.id)}
          RETURNING id
        `
      : await tx<AnyRecord[]>`
        INSERT INTO morf_ai_usage_logs (
        team_id, chat_id, module_code, provider, model, input_tokens, output_tokens,
        provider_cost_cents, customer_cost_cents, reserved_customer_cost_cents,
        markup_percent, status, request_key, attempt_count, reserved_at, metadata, created_at
      ) VALUES (
        ${input.teamId}, ${input.chatId}, ${input.moduleCode || 'sales_ai'}, ${input.provider}, ${input.model}, 0, 0,
        0, 0, ${estimate}, ${numeric(wallet.markup_percent)}, 'reserved', ${requestKey}, 0, NOW(),
        ${JSON.stringify(input.metadata || {})}::jsonb, NOW()
      )
      ON CONFLICT (team_id, request_key) WHERE request_key IS NOT NULL DO NOTHING
      RETURNING id
    `;
    const usageLogId = numeric(inserted[0]?.id);
    if (!usageLogId) {
      const [winner] = await tx<AnyRecord[]>`
        SELECT id, status, reserved_customer_cost_cents, markup_percent
        FROM morf_ai_usage_logs
        WHERE team_id = ${input.teamId} AND request_key = ${requestKey}
        LIMIT 1
      `;
      const status = String(winner?.status || 'reserved');
      return { ok: ['reserved', 'completed', 'completed_shortfall', 'shadow_metered'].includes(status), code: `usage_${status}`, usageLogId: numeric(winner?.id), requestKey, reservedCustomerCostCents: numeric(winner?.reserved_customer_cost_cents), balanceCents: numeric(wallet.balance_cents), markupPercent: numeric(winner?.markup_percent), idempotent: true };
    }
    const balanceAfter = numeric(wallet.balance_cents) - estimate;
    await tx`UPDATE morf_ai_wallets SET balance_cents = ${balanceAfter}, updated_at = NOW() WHERE team_id = ${input.teamId}`;
    await tx`
      INSERT INTO morf_ai_wallet_transactions (
        team_id, usage_log_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
      ) VALUES (
        ${input.teamId}, ${usageLogId}, ${`reserve:${requestKey}:${attempt}`}, 'usage_reserve', ${-estimate}, ${balanceAfter}, '{}'::jsonb, NOW()
      )
    `;
    return { ok: true, code: 'usage_reserved', usageLogId, requestKey, reservedCustomerCostCents: estimate, balanceCents: balanceAfter, markupPercent: numeric(wallet.markup_percent), idempotent: false };
  });
}

export async function reconcileVendorAiUsage(input: {
  teamId: number;
  requestKey: string;
  providerRequestId?: string | null;
  providerCostCents: number;
  inputTokens: number;
  outputTokens: number;
  charge?: boolean;
  metadata?: AnyRecord;
}) {
  const requestKey = boundedKey(input.requestKey);
  const charge = input.charge !== false;
  return client.begin(async (tx) => {
    const [usage] = await tx<AnyRecord[]>`
      SELECT * FROM morf_ai_usage_logs
      WHERE team_id = ${input.teamId} AND request_key = ${requestKey}
      FOR UPDATE
    `;
    if (!usage) return { ok: false as const, code: 'reservation_not_found' };
    if (['completed', 'completed_shortfall', 'shadow_metered'].includes(String(usage.status))) {
      return { ok: true as const, code: 'already_reconciled', customerCostCents: numeric(usage.customer_cost_cents), idempotent: true };
    }
    if (String(usage.status) !== 'reserved') return { ok: false as const, code: `usage_${usage.status}` };
    const [wallet] = await tx<AnyRecord[]>`SELECT balance_cents FROM morf_ai_wallets WHERE team_id = ${input.teamId} FOR UPDATE`;
    if (!wallet) return { ok: false as const, code: 'wallet_not_found' };
    const providerCost = Math.max(0, Math.round(numeric(input.providerCostCents)));
    const reserved = numeric(usage.reserved_customer_cost_cents);
    if (!charge) {
      const balanceAfter = numeric(wallet.balance_cents) + reserved;
      await tx`
        UPDATE morf_ai_wallets SET balance_cents = ${balanceAfter}, updated_at = NOW()
        WHERE team_id = ${input.teamId}
      `;
      await tx`
        UPDATE morf_ai_usage_logs
        SET provider_request_id = ${input.providerRequestId || null},
            input_tokens = ${Math.max(0, Math.round(input.inputTokens || 0))},
            output_tokens = ${Math.max(0, Math.round(input.outputTokens || 0))},
            provider_cost_cents = ${providerCost}, customer_cost_cents = 0,
            status = 'shadow_metered', reconciled_at = NOW(),
            metadata = metadata || ${JSON.stringify({ ...(input.metadata || {}), shadow_metered: true, expected_customer_cost_cents: 0, billing_shortfall_cents: 0 })}::jsonb
        WHERE id = ${numeric(usage.id)}
      `;
      await tx`
        INSERT INTO morf_ai_wallet_transactions (
          team_id, usage_log_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
        ) VALUES (
          ${input.teamId}, ${numeric(usage.id)}, ${`reconcile:${requestKey}:${numeric(usage.attempt_count)}`}, 'usage_reconcile', ${reserved}, ${balanceAfter},
          ${JSON.stringify({ shadow_metered: true, provider_cost_cents: providerCost })}::jsonb, NOW()
        ) ON CONFLICT (team_id, transaction_key) DO NOTHING
      `;
      return { ok: true as const, code: 'shadow_metered', customerCostCents: 0, expectedCustomerCostCents: 0, providerCostCents: providerCost, balanceCents: balanceAfter, shortfallCents: 0, idempotent: false };
    }
    const expectedCustomerCost = customerCostFromProviderCost(providerCost, numeric(usage.markup_percent));
    const available = numeric(wallet.balance_cents);
    const extraRequired = Math.max(0, expectedCustomerCost - reserved);
    const extraCharged = Math.min(available, extraRequired);
    const finalCharged = Math.min(expectedCustomerCost, reserved + extraCharged);
    const refund = Math.max(0, reserved - expectedCustomerCost);
    const balanceAfter = available - extraCharged + refund;
    const shortfall = Math.max(0, expectedCustomerCost - finalCharged);
    const status = shortfall > 0 ? 'completed_shortfall' : 'completed';
    await tx`
      UPDATE morf_ai_wallets SET balance_cents = ${balanceAfter}, updated_at = NOW()
      WHERE team_id = ${input.teamId}
    `;
    await tx`
      UPDATE morf_ai_usage_logs
      SET provider_request_id = ${input.providerRequestId || null},
          input_tokens = ${Math.max(0, Math.round(input.inputTokens || 0))},
          output_tokens = ${Math.max(0, Math.round(input.outputTokens || 0))},
          provider_cost_cents = ${providerCost}, customer_cost_cents = ${finalCharged},
          status = ${status}, reconciled_at = NOW(),
          metadata = metadata || ${JSON.stringify({ ...(input.metadata || {}), expected_customer_cost_cents: expectedCustomerCost, billing_shortfall_cents: shortfall })}::jsonb
      WHERE id = ${numeric(usage.id)}
    `;
    const adjustment = refund - extraCharged;
    if (adjustment !== 0) {
      await tx`
        INSERT INTO morf_ai_wallet_transactions (
          team_id, usage_log_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
        ) VALUES (
          ${input.teamId}, ${numeric(usage.id)}, ${`reconcile:${requestKey}:${numeric(usage.attempt_count)}`}, 'usage_reconcile', ${adjustment}, ${balanceAfter},
          ${JSON.stringify({ expected_customer_cost_cents: expectedCustomerCost, shortfall_cents: shortfall })}::jsonb, NOW()
        ) ON CONFLICT (team_id, transaction_key) DO NOTHING
      `;
    }
    return { ok: true as const, code: status, customerCostCents: finalCharged, expectedCustomerCostCents: expectedCustomerCost, providerCostCents: providerCost, balanceCents: balanceAfter, shortfallCents: shortfall, idempotent: false };
  });
}

export async function releaseVendorAiReservation(input: { teamId: number; requestKey: string; errorCode: string }) {
  const requestKey = boundedKey(input.requestKey);
  return client.begin(async (tx) => {
    const [usage] = await tx<AnyRecord[]>`
      SELECT * FROM morf_ai_usage_logs
      WHERE team_id = ${input.teamId} AND request_key = ${requestKey}
      FOR UPDATE
    `;
    if (!usage) return { ok: false as const, code: 'reservation_not_found' };
    if (String(usage.status) !== 'reserved') return { ok: true as const, code: `usage_${usage.status}`, idempotent: true };
    const [wallet] = await tx<AnyRecord[]>`SELECT balance_cents FROM morf_ai_wallets WHERE team_id = ${input.teamId} FOR UPDATE`;
    const refund = numeric(usage.reserved_customer_cost_cents);
    const balanceAfter = numeric(wallet?.balance_cents) + refund;
    await tx`UPDATE morf_ai_wallets SET balance_cents = ${balanceAfter}, updated_at = NOW() WHERE team_id = ${input.teamId}`;
    await tx`
      UPDATE morf_ai_usage_logs SET status = 'failed', error_code = ${boundedKey(input.errorCode).slice(0, 80)}, reconciled_at = NOW()
      WHERE id = ${numeric(usage.id)}
    `;
    await tx`
      INSERT INTO morf_ai_wallet_transactions (
        team_id, usage_log_id, transaction_key, transaction_type, amount_cents, balance_after_cents, metadata, created_at
      ) VALUES (
        ${input.teamId}, ${numeric(usage.id)}, ${`release:${requestKey}:${numeric(usage.attempt_count)}`}, 'usage_release', ${refund}, ${balanceAfter}, '{}'::jsonb, NOW()
      ) ON CONFLICT (team_id, transaction_key) DO NOTHING
    `;
    return { ok: true as const, code: 'reservation_released', refundedCents: refund, balanceCents: balanceAfter, idempotent: false };
  });
}
