import { desc, and, eq, isNull, count } from 'drizzle-orm';
import { db, client } from './drizzle';
import {
  activityLogs,
  teamMembers,
  teams,
  users,
  plans,
  contacts,
  evolutionInstances,
} from './schema';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth/session';
import { ensureCoreSaasModules, ensureOmnichannelCatalog } from '@/lib/modules/plan-entitlements';

export async function getUser() {
  const sessionCookie = (await cookies()).get('session');
  if (!sessionCookie || !sessionCookie.value) {
    return null;
  }

  const sessionData = await verifyToken(sessionCookie.value);
  if (
    !sessionData ||
    !sessionData.user ||
    typeof sessionData.user.id !== 'number'
  ) {
    return null;
  }

  if (new Date(sessionData.expires) < new Date()) {
    return null;
  }

  const user = await db
    .select()
    .from(users)
    .where(and(eq(users.id, sessionData.user.id), isNull(users.deletedAt)))
    .limit(1);

  if (user.length === 0) {
    return null;
  }

  return user[0];
}

export async function getPublishedPlans() {
  try {
    const [columns] = await client<{
      has_is_active: boolean;
      has_deleted_at: boolean;
      has_is_published: boolean;
      has_billing_provider: boolean;
      has_polar_product_id: boolean;
      has_polar_price_id: boolean;
      has_polar_plan_key: boolean;
      has_polar_sync_status: boolean;
    }[]>`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'is_active'
        ) AS has_is_active,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'deleted_at'
        ) AS has_deleted_at,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'is_published'
        ) AS has_is_published,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'billing_provider'
        ) AS has_billing_provider,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'polar_product_id'
        ) AS has_polar_product_id,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'polar_price_id'
        ) AS has_polar_price_id,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'polar_plan_key'
        ) AS has_polar_plan_key,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'plans' AND column_name = 'polar_sync_status'
        ) AS has_polar_sync_status
    `;

    if (columns?.has_is_active && columns?.has_deleted_at) {
      const rows = await client<any[]>`
        SELECT
          id,
          name,
          description,
          amount,
          currency,
          interval,
          trial_days,
          max_users,
          max_contacts,
          max_instances,
          is_ai_enabled,
          is_ai_sales_enabled,
          is_flow_builder_enabled,
          is_campaigns_enabled,
          is_templates_enabled,
          is_logihub_quote_enabled,
          is_logihub_create_enabled,
          ${columns.has_billing_provider ? client`billing_provider` : client`'polar'::text`} AS billing_provider,
          ${columns.has_is_published ? client`is_published` : client`true`} AS is_published,
          ${columns.has_polar_product_id ? client`polar_product_id` : client`NULL::text`} AS polar_product_id,
          ${columns.has_polar_price_id ? client`polar_price_id` : client`NULL::text`} AS polar_price_id,
          ${columns.has_polar_plan_key ? client`polar_plan_key` : client`NULL::text`} AS polar_plan_key,
          ${columns.has_polar_sync_status ? client`polar_sync_status` : client`NULL::text`} AS polar_sync_status,
          created_at,
          updated_at
        FROM plans
        WHERE COALESCE(is_active, true) = true
          AND ${columns.has_is_published ? client`COALESCE(is_published, false) = true` : client`true`}
          AND deleted_at IS NULL
          AND (
            amount <= 0
            OR (
              LOWER(COALESCE(${columns.has_billing_provider ? client`billing_provider` : client`'polar'::text`}, 'polar')) = 'polar'
              AND NULLIF(COALESCE(${columns.has_polar_product_id ? client`polar_product_id` : client`NULL::text`}, ''), '') IS NOT NULL
              AND NULLIF(COALESCE(${columns.has_polar_price_id ? client`polar_price_id` : client`NULL::text`}, ''), '') IS NOT NULL
            )
          )
        ORDER BY amount ASC, id ASC
      `;

      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        amount: row.amount,
        currency: row.currency,
        interval: row.interval,
        trialDays: row.trial_days,
        maxUsers: row.max_users,
        maxContacts: row.max_contacts,
        maxInstances: row.max_instances,
        isAiEnabled: row.is_ai_enabled,
        isAiSalesEnabled: row.is_ai_sales_enabled,
        isFlowBuilderEnabled: row.is_flow_builder_enabled,
        isCampaignsEnabled: row.is_campaigns_enabled,
        isTemplatesEnabled: row.is_templates_enabled,
        isLogihubQuoteEnabled: row.is_logihub_quote_enabled,
        isLogihubCreateEnabled: row.is_logihub_create_enabled,
        billingProvider: row.billing_provider,
        isPublished: row.is_published,
        polarProductId: row.polar_product_id,
        polarPriceId: row.polar_price_id,
        polarPlanKey: row.polar_plan_key,
        polarSyncStatus: row.polar_sync_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    }
  } catch (error) {
    console.warn('[pricing] active plan filter unavailable', error);
  }

  return [];
}


export type PricingChannelModule = {
  moduleKey: string;
  name: string;
  description: string | null;
  channelType: string;
  provider: string;
  priceCents: number;
  currency: string;
  trialDays: number;
  sortOrder: number;
};

export type PricingSaasModule = {
  code: string;
  name: string;
  description: string | null;
  basePriceAmount: string;
  currency: string;
  trialDays: number;
};

export type PricingCatalogData = {
  channelModules: PricingChannelModule[];
  saasModules: PricingSaasModule[];
  planEntitlements: Record<number, string[]>;
  paypalEnabled: boolean;
  paypalMode: string | null;
};

type PricingChannelModuleRow = {
  module_key: string;
  name: string;
  description: string | null;
  channel_type: string;
  provider: string;
  price_cents: number;
  currency: string;
  trial_days: number;
  sort_order: number;
};

type PricingSaasModuleRow = {
  code: string;
  name: string;
  description: string | null;
  base_price_amount: string;
  currency: string;
  trial_days: number;
};

type PricingPlanEntitlementRow = {
  plan_id: number;
  module_code: string;
};

type PricingPaypalGatewayRow = {
  is_enabled: boolean;
  environment: string | null;
  client_id: string | null;
  client_secret: string | null;
};

async function safePricingRows<T>(label: string, query: () => PromiseLike<unknown>): Promise<T[]> {
  try {
    const rows = await query();
    return Array.from(rows as Iterable<T>);
  } catch (error) {
    console.warn(`[pricing] ${label} unavailable`, error);
    return [];
  }
}

export async function getPricingCatalogData(): Promise<PricingCatalogData> {
  await ensureCoreSaasModules();
  await ensureOmnichannelCatalog();

  const [channelRows, moduleRows, entitlementRows, paypalRows] = await Promise.all([
    safePricingRows<PricingChannelModuleRow>(
      'channel modules',
      () => client<PricingChannelModuleRow[]>`
        SELECT module_key, name, description, channel_type, provider, price_cents, currency, trial_days, sort_order
        FROM allsender_channel_modules
        WHERE is_enabled = true
        ORDER BY sort_order ASC, name ASC
      `
    ),
    safePricingRows<PricingSaasModuleRow>(
      'saas modules',
      () => client<PricingSaasModuleRow[]>`
        SELECT code, name, description, base_price_amount::text, currency, trial_days
        FROM saas_modules
        WHERE is_available = true
        ORDER BY name ASC
      `
    ),
    safePricingRows<PricingPlanEntitlementRow>(
      'plan entitlements',
      () => client<PricingPlanEntitlementRow[]>`
        SELECT plan_id, module_code
        FROM plan_module_entitlements
        WHERE is_allowed = true
      `
    ),
    safePricingRows<PricingPaypalGatewayRow>(
      'paypal gateway',
      () => client<PricingPaypalGatewayRow[]>`
        SELECT is_enabled, environment, client_id, client_secret
        FROM payment_gateway_settings
        WHERE provider = 'paypal'
        ORDER BY updated_at DESC
        LIMIT 1
      `
    ),
  ]);

  const planEntitlements: Record<number, string[]> = {};
  for (const row of entitlementRows) {
    if (['paypal', 'stripe'].includes(String(row.module_code || '').toLowerCase())) continue;
    if (!planEntitlements[row.plan_id]) planEntitlements[row.plan_id] = [];
    planEntitlements[row.plan_id].push(row.module_code);
  }

  const paypal = paypalRows[0];

  return {
    channelModules: channelRows.map((row) => ({
      moduleKey: row.module_key,
      name: row.name,
      description: row.description,
      channelType: row.channel_type,
      provider: row.provider,
      priceCents: Number(row.price_cents || 0),
      currency: row.currency || 'usd',
      trialDays: Number(row.trial_days || 0),
      sortOrder: Number(row.sort_order || 0),
    })),
    saasModules: moduleRows.map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      basePriceAmount: row.base_price_amount || '0',
      currency: row.currency || 'USD',
      trialDays: Number(row.trial_days || 0),
    })).filter((row) => !['paypal', 'stripe'].includes(String(row.code || '').toLowerCase())),
    planEntitlements,
    paypalEnabled: Boolean(paypal?.is_enabled && paypal.client_id && paypal.client_secret),
    paypalMode: paypal?.environment || null,
  };
}

export async function getTeamByStripeCustomerId(customerId: string) {
  const result = await db
    .select()
    .from(teams)
    .where(eq(teams.stripeCustomerId, customerId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

export async function updateTeamSubscription(
  teamId: number,
  subscriptionData: {
    stripeSubscriptionId: string | null;
    stripeProductId: string | null;
    planName: string | null;
    subscriptionStatus: string;
  }
) {
  await db
    .update(teams)
    .set({
      ...subscriptionData,
      updatedAt: new Date(),
    })
    .where(eq(teams.id, teamId));
}

export async function getUserWithTeam(userId: number) {
  const result = await db
    .select({
      user: users,
      teamId: teamMembers.teamId,
    })
    .from(users)
    .leftJoin(teamMembers, eq(users.id, teamMembers.userId))
    .where(eq(users.id, userId))
    .limit(1);

  return result[0];
}

export async function getTeamMemberCount(teamId: number) {
  const [result] = await db
    .select({ count: count() })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId));
  return result.count;
}

export async function getContactCount(teamId: number) {
  const [result] = await db
    .select({ count: count() })
    .from(contacts)
    .where(eq(contacts.teamId, teamId));
  return result.count;
}

export async function getInstanceCount(teamId: number) {
  const [result] = await db
    .select({ count: count() })
    .from(evolutionInstances)
    .where(eq(evolutionInstances.teamId, teamId));
  return result.count;
}

export async function getActivityLogs() {
  const user = await getUser();
  if (!user) {
    throw new Error('User not authenticated');
  }

  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      ipAddress: activityLogs.ipAddress,
      userName: users.name,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .where(eq(activityLogs.userId, user.id))
    .orderBy(desc(activityLogs.timestamp))
    .limit(10);
}

export async function getFreePlan() {
  const result = await db
    .select()
    .from(plans)
    .where(eq(plans.amount, 0))
    .limit(1);

  return result[0] || null;
}

/**
 * Devuelve el team del usuario actual.
 * - Owner / admin: ve todos los teamMembers.
 * - Miembro normal: solo ve su propio registro en teamMembers.
 */
export async function getTeamForUser() {
  const user = await getUser();
  if (!user) {
    return null;
  }

  const result = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.userId, user.id),
    with: {
      team: {
        with: {
          teamMembers: {
            with: {
              user: {
                columns: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          evolutionInstances: true,
        },
      },
    },
  });

  if (!result?.team) {
    return null;
  }

  const team = result.team;

  // role en team_members (owner/member/…)
  const memberRole = (result as any).role as string | undefined;
  // role global en users (admin / user)
  const userRole = (user as any).role as string | undefined;

  const isOwnerOrAdmin = memberRole === 'owner' || memberRole === 'admin' || memberRole === 'administrator' || userRole === 'admin';

  if (!isOwnerOrAdmin) {
    // Filtramos los teamMembers para que el agente normal solo se vea a sí mismo
    const filteredTeam = {
      ...team,
      teamMembers: team.teamMembers.filter((tm) => tm.userId === user.id),
    };
    return filteredTeam;
  }

  // Owner/admin: ve todos
  return team;
}
