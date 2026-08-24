import { db, client } from '@/lib/db/drizzle';
import { users, teams, activityLogs, plans } from '@/lib/db/schema';
import { ensureCoreSaasModules } from '@/lib/modules/plan-entitlements';
import { count, eq, desc, sql } from 'drizzle-orm';

// --- Dashboard Queries ---

export async function getAdminStats() {
  const [userCount] = await db.select({ count: count() }).from(users);
  const [teamCount] = await db.select({ count: count() }).from(teams);
  const [activeSubs] = await db
    .select({ count: count() })
    .from(teams)
    .where(eq(teams.subscriptionStatus, 'active'));

  return {
    users: userCount.count,
    teams: teamCount.count,
    activeSubscriptions: activeSubs.count,
  };
}

export async function getAllUsers() {
  return await db.select().from(users).orderBy(desc(users.createdAt)).limit(100);
}

export async function getAllTeams() {
  return await db
    .select({
      id: teams.id,
      name: teams.name,
      planName: teams.planName,
      subscriptionStatus: teams.subscriptionStatus,
      createdAt: teams.createdAt,
      memberCount: count(users.id),
    })
    .from(teams)
    .leftJoin(users, sql`${teams.id} = (SELECT team_id FROM team_members WHERE user_id = ${users.id} LIMIT 1)`)
    .groupBy(teams.id)
    .orderBy(desc(teams.createdAt))
    .limit(100);
}

export async function getRecentActivity() {
  return await db
    .select({
      id: activityLogs.id,
      action: activityLogs.action,
      timestamp: activityLogs.timestamp,
      user: users.email,
    })
    .from(activityLogs)
    .leftJoin(users, eq(activityLogs.userId, users.id))
    .orderBy(desc(activityLogs.timestamp))
    .limit(20);
}

// --- Plans Queries (Novas) ---

export async function getAllPlans() {
  return await db.select().from(plans).orderBy(desc(plans.createdAt));
}

export async function getPlanById(id: number) {
  const result = await db.select().from(plans).where(eq(plans.id, id));
  return result[0] || null;
}
export type PlanModuleOption = {
  code: string;
  name: string;
  description: string | null;
  isAvailable: boolean;
};

export async function getAvailableSaasModules(): Promise<PlanModuleOption[]> {
  await ensureCoreSaasModules();

  const rows = await client<{
    code: string;
    name: string;
    description: string | null;
    is_available: boolean;
  }[]>`
    SELECT code, name, description, is_available
    FROM saas_modules
    ORDER BY name ASC
  `;

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    description: row.description,
    isAvailable: row.is_available,
  }));
}

export async function getPlanModuleEntitlements(planId: number): Promise<string[]> {
  const rows = await client<{ module_code: string }[]>`
    SELECT module_code
    FROM plan_module_entitlements
    WHERE plan_id = ${planId} AND is_allowed = true
  `;

  return rows.map((row) => row.module_code);
}

export type PlanChannelOption = {
  moduleKey: string;
  name: string;
  description: string | null;
  provider: string;
  channelType: string;
  isEnabled: boolean;
};

export async function getAvailableChannelModules(): Promise<PlanChannelOption[]> {
  const { ensureOmnichannelCatalog, ensurePlanChannelEntitlementsTable } = await import('@/lib/modules/plan-entitlements');
  await ensureOmnichannelCatalog();
  await ensurePlanChannelEntitlementsTable();

  const rows = await client<{
    module_key: string;
    name: string;
    description: string | null;
    provider: string;
    channel_type: string;
    is_enabled: boolean;
  }[]>`
    SELECT module_key, name, description, provider, channel_type, is_enabled
    FROM allsender_channel_modules
    ORDER BY sort_order ASC, name ASC
  `;

  return rows.map((row) => ({
    moduleKey: row.module_key,
    name: row.name,
    description: row.description,
    provider: row.provider,
    channelType: row.channel_type,
    isEnabled: row.is_enabled,
  }));
}

export async function getPlanChannelEntitlements(planId: number): Promise<string[]> {
  const { ensurePlanChannelEntitlementsTable } = await import('@/lib/modules/plan-entitlements');
  await ensurePlanChannelEntitlementsTable();

  const rows = await client<{ module_key: string }[]>`
    SELECT module_key
    FROM plan_channel_entitlements
    WHERE plan_id = ${planId} AND is_allowed = true
  `;

  return rows.map((row) => row.module_key);
}
