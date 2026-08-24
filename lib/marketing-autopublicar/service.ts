import 'server-only';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import OpenAI from 'openai';
import { OpenAIProvider } from '@/lib/plugins/ai-chat/providers/openai';
import { GeminiProvider } from '@/lib/plugins/ai-chat/providers/gemini';
import { morfGenerate } from '@/lib/morf-ai/runtime/generate';
import { client } from '@/lib/db/drizzle';
import { callZernio, zernioApiKey } from '@/lib/zernio/client';

export type AutopublishAccount = {
  id: number;
  teamId: number;
  userId: number | null;
  provider: 'zernio';
  platform: string;
  moduleKey: string;
  zernioProfileId: string;
  zernioAccountId: string;
  username: string | null;
  displayName: string | null;
  picture: string | null;
  status: 'connected';
  isPublishReady: boolean;
  metadata: Record<string, any>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type PlanLimits = {
  planCode: string;
  planName: string;
  moduleCode: 'autopublicar';
  status: string;
  maxConnectedChannels: number;
  maxChannelsPerPost: number;
  maxPostsPerMonth: number;
  maxScheduledPosts: number;
  enabledPlatforms: string[];
  allowMultiChannelPost: boolean;
  allowCalendar: boolean;
  allowAdvancedCalendar: boolean;
  allowPhonePreview: boolean;
  allowAiCaption: boolean;
  allowAiComments: boolean;
  allowShortLinks: boolean;
  allowBulkSchedule: boolean;
  timezoneDefault: string;
  upgradeUrl: string;
  usage: {
    postsThisMonth: number;
    scheduledPosts: number;
    selectedChannelsCurrentPost: number;
  };
};

export type FeatureLock = {
  feature: string;
  locked: boolean;
  reason: string;
  upgradeUrl: string;
};

type SqlClient = typeof client & { unsafe: (query: string, args?: any[]) => Promise<any[]> };
const sql = client as SqlClient;

const ALL_PLATFORMS = [
  'facebook', 'instagram', 'threads', 'linkedin', 'tiktok', 'youtube', 'pinterest', 'reddit',
  'bluesky', 'twitter', 'x', 'googlebusiness', 'telegram', 'snapchat', 'discord', 'whatsapp',
];

const AUTOPUBLICAR_UPGRADE_URL = '/es/pricing';

function asString(value: unknown, fallback = ''): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString();
}

function parseJsonObject(value: unknown): Record<string, any> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseJsonArray(value: unknown): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizePlatform(value: unknown): string {
  const platform = asString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (platform === 'twitter') return 'x';
  return platform || 'facebook';
}

function mapAccount(row: any): AutopublishAccount {
  const metadata = parseJsonObject(row?.metadata);
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    provider: 'zernio',
    platform: normalizePlatform(row.platform),
    moduleKey: asString(row.module_key, `zernio_${normalizePlatform(row.platform)}`),
    zernioProfileId: asString(row.zernio_profile_id),
    zernioAccountId: asString(row.zernio_account_id),
    username: row.account_username ?? null,
    displayName: row.account_display_name ?? row.account_username ?? null,
    picture: row.account_picture ?? null,
    status: 'connected',
    isPublishReady: true,
    metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPost(row: any) {
  const providerResponse = parseJsonObject(row?.provider_response);
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    userId: row.user_id === null || row.user_id === undefined ? null : Number(row.user_id),
    title: row.title ?? null,
    body: asString(row.body),
    mediaUrl: row.media_url ?? null,
    mediaItems: parseJsonArray(providerResponse.mediaItems),
    channels: parseJsonArray(row.channels),
    status: asString(row.status, 'draft'),
    scheduledAt: toIso(row.scheduled_at),
    publishedAt: toIso(row.published_at),
    providerResponse,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapLog(row: any) {
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    postId: row.post_id === null || row.post_id === undefined ? null : Number(row.post_id),
    platform: asString(row.platform, 'zernio'),
    provider: asString(row.provider, 'zernio'),
    eventType: asString(row.event_type),
    status: asString(row.status),
    message: row.message ?? null,
    metadata: parseJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapComment(row: any) {
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    platform: normalizePlatform(row.platform),
    provider: asString(row.provider, 'zernio'),
    accountId: row.account_id ?? null,
    externalCommentId: row.external_comment_id ?? null,
    externalPostId: row.external_post_id ?? null,
    authorUsername: row.author_username ?? null,
    commentText: asString(row.comment_text),
    aiReply: row.ai_reply ?? null,
    action: asString(row.action, 'pending'),
    status: asString(row.status, 'pending'),
    metadata: parseJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function planFromName(name: string | null | undefined): 'basic' | 'pro' | 'agency' {
  const raw = asString(name, 'basic')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // /es/pricing: planes comerciales actuales.
  // “Ventas Full 360” debe tratarse como plan completo, no como basic.
  if (/(agency|agencia|enterprise|empresa|premium|full|360|ultimate|max|completo|complete|todo)/.test(raw)) return 'agency';
  if (/(pro|profesional|business|negocio|ventas|growth|plus)/.test(raw)) return 'pro';
  return 'basic';
}

function baseLimits(planCode: 'basic' | 'pro' | 'agency') {
  if (planCode === 'agency') {
    return {
      maxConnectedChannels: 20,
      maxChannelsPerPost: 10,
      maxPostsPerMonth: 0,
      maxScheduledPosts: 200,
      enabledPlatforms: ALL_PLATFORMS,
      allowMultiChannelPost: true,
      allowCalendar: true,
      allowAdvancedCalendar: true,
      allowPhonePreview: true,
      allowAiCaption: true,
      allowAiComments: true,
      allowShortLinks: true,
      allowBulkSchedule: true,
    };
  }
  if (planCode === 'pro') {
    return {
      maxConnectedChannels: 6,
      maxChannelsPerPost: 3,
      maxPostsPerMonth: 200,
      maxScheduledPosts: 60,
      enabledPlatforms: ['facebook', 'instagram', 'linkedin', 'threads', 'tiktok'],
      allowMultiChannelPost: true,
      allowCalendar: true,
      allowAdvancedCalendar: true,
      allowPhonePreview: true,
      allowAiCaption: true,
      allowAiComments: true,
      allowShortLinks: true,
      allowBulkSchedule: false,
    };
  }
  return {
    maxConnectedChannels: 2,
    maxChannelsPerPost: 1,
    maxPostsPerMonth: 30,
    maxScheduledPosts: 10,
    enabledPlatforms: ['facebook', 'instagram'],
    allowMultiChannelPost: false,
    allowCalendar: true,
    allowAdvancedCalendar: false,
    allowPhonePreview: true,
    allowAiCaption: false,
    allowAiComments: false,
    allowShortLinks: false,
    allowBulkSchedule: false,
  };
}

export async function ensureAutopublishSqlReady() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS marketing_ai_settings (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      auto_comment_enabled BOOLEAN NOT NULL DEFAULT false,
      auto_dm_enabled BOOLEAN NOT NULL DEFAULT false,
      tone VARCHAR(80) NOT NULL DEFAULT 'professional_friendly',
      base_prompt TEXT NOT NULL DEFAULT 'Responde comentarios de forma clara, amable y profesional. No inventes precios ni disponibilidad.',
      human_handoff_keywords TEXT[] NOT NULL DEFAULT ARRAY['queja','reclamo','estafa','demanda','abogado','mal servicio','cancelar'],
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(team_id)
    );

    CREATE TABLE IF NOT EXISTS marketing_ai_posts (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      title VARCHAR(180) NULL,
      body TEXT NOT NULL,
      media_url TEXT NULL,
      channels JSONB NOT NULL DEFAULT '[]'::jsonb,
      status VARCHAR(50) NOT NULL DEFAULT 'draft',
      scheduled_at TIMESTAMP NULL,
      published_at TIMESTAMP NULL,
      provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_ai_post_logs (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      post_id INTEGER NULL,
      platform VARCHAR(80) NOT NULL DEFAULT 'zernio',
      provider VARCHAR(80) NOT NULL DEFAULT 'zernio',
      event_type VARCHAR(120) NOT NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'received',
      message TEXT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_ai_event_logs (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      platform VARCHAR(80) NOT NULL DEFAULT 'zernio',
      provider VARCHAR(80) NOT NULL DEFAULT 'zernio',
      account_id VARCHAR(180) NULL,
      event_type VARCHAR(120) NOT NULL,
      status VARCHAR(60) NOT NULL DEFAULT 'received',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marketing_ai_comment_settings (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT false,
      mode VARCHAR(60) NOT NULL DEFAULT 'manual_review',
      base_instructions TEXT NULL,
      auto_dm BOOLEAN NOT NULL DEFAULT false,
      auto_reply_public BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(team_id)
    );

    CREATE TABLE IF NOT EXISTS marketing_ai_comment_logs (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      platform VARCHAR(80) NOT NULL,
      provider VARCHAR(80) NULL DEFAULT 'zernio',
      account_id VARCHAR(180) NULL,
      external_comment_id VARCHAR(220) NULL,
      external_post_id VARCHAR(220) NULL,
      author_username VARCHAR(180) NULL,
      comment_text TEXT NOT NULL,
      ai_reply TEXT NULL,
      action VARCHAR(80) NOT NULL DEFAULT 'pending',
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS saas_modules (
      code VARCHAR(80) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      description TEXT,
      base_price_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      currency VARCHAR(3) NOT NULL DEFAULT 'USD',
      trial_days INTEGER NOT NULL DEFAULT 0,
      is_available BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_marketing_ai_posts_team_status_time ON marketing_ai_posts(team_id, status, scheduled_at DESC);
    CREATE INDEX IF NOT EXISTS idx_marketing_ai_posts_calendar ON marketing_ai_posts(team_id, (COALESCE(scheduled_at, published_at, created_at)));
    CREATE INDEX IF NOT EXISTS idx_marketing_ai_post_logs_team_post ON marketing_ai_post_logs(team_id, post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_marketing_ai_event_logs_team ON marketing_ai_event_logs(team_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_team_status ON marketing_ai_comment_logs(team_id, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_unique_external ON marketing_ai_comment_logs(team_id, platform, external_comment_id) WHERE external_comment_id IS NOT NULL;
  `);
}

export async function registerAutopublishModule() {
  await ensureAutopublishSqlReady();
  await sql.unsafe(
    `INSERT INTO saas_modules (code, name, description, base_price_amount, currency, trial_days, is_available, created_at, updated_at)
     VALUES ('autopublicar', 'Autopublicar', 'Módulo separado para crear, programar y publicar contenido en redes sociales usando cuentas conectadas por Zernio.', 0.00, 'USD', 3, true, NOW(), NOW())
     ON CONFLICT (code) DO NOTHING`
  );
}

export async function listPublishReadyAccounts(teamId: number, platform?: string | null): Promise<AutopublishAccount[]> {
  await ensureAutopublishSqlReady();
  const params: any[] = [teamId];
  let filter = '';
  const normalized = platform ? normalizePlatform(platform) : '';
  if (normalized) {
    params.push(normalized);
    filter = ` AND lower(platform) = $${params.length}`;
  }
  const rows = await sql.unsafe(
    `SELECT id, team_id, user_id, provider, platform, module_key, zernio_profile_id, zernio_account_id,
            account_username, account_display_name, account_picture, status, metadata, created_at, updated_at
     FROM zernio_connections
     WHERE team_id = $1
       AND (provider IS NULL OR btrim(provider) = '' OR lower(provider) = 'zernio')
       AND lower(status) = 'connected'
       AND zernio_account_id IS NOT NULL
       AND btrim(zernio_account_id) <> ''
       AND platform IS NOT NULL
       AND btrim(platform) <> ''
       ${filter}
     ORDER BY lower(platform) ASC, updated_at DESC, id DESC`,
    params
  );
  return rows.map(mapAccount);
}

export async function getPlanLimits(teamId: number): Promise<{ planLimits: PlanLimits; featureLocks: FeatureLock[] }> {
  await ensureAutopublishSqlReady();
  const [teamRow] = await sql.unsafe(`SELECT id, plan_id, plan_name, subscription_status FROM teams WHERE id = $1 LIMIT 1`, [teamId]);
  let planName = asString(teamRow?.plan_name, 'basic');
  if (teamRow?.plan_id) {
    const [plan] = await sql.unsafe(`SELECT name FROM plans WHERE id = $1 LIMIT 1`, [teamRow.plan_id]);
    planName = asString(plan?.name, planName);
  }
  const planCode = planFromName(planName);
  const base = baseLimits(planCode);
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [usage] = await sql.unsafe(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= $2) AS posts_this_month,
       COUNT(*) FILTER (WHERE status = 'scheduled' AND scheduled_at > NOW()) AS scheduled_posts
     FROM marketing_ai_posts
     WHERE team_id = $1`,
    [teamId, monthStart.toISOString()]
  );
  const status = asString(teamRow?.subscription_status, 'active');
  const planLimits: PlanLimits = {
    planCode,
    planName: planName || planCode,
    moduleCode: 'autopublicar',
    status: status || 'active',
    ...base,
    timezoneDefault: 'America/Santo_Domingo',
    upgradeUrl: AUTOPUBLICAR_UPGRADE_URL,
    usage: {
      postsThisMonth: Number(usage?.posts_this_month || 0),
      scheduledPosts: Number(usage?.scheduled_posts || 0),
      selectedChannelsCurrentPost: 0,
    },
  };
  const locks: FeatureLock[] = [
    { feature: 'multi_channel', locked: !planLimits.allowMultiChannelPost, reason: `Tu plan permite ${planLimits.maxChannelsPerPost} canal por publicación. Actualiza para publicar en varios canales.`, upgradeUrl: planLimits.upgradeUrl },
    { feature: 'advanced_calendar', locked: !planLimits.allowAdvancedCalendar, reason: 'El calendario avanzado por mes/semana/día requiere un plan superior.', upgradeUrl: planLimits.upgradeUrl },
    { feature: 'phone_preview', locked: !planLimits.allowPhonePreview, reason: 'La vista previa celular no está incluida en tu plan.', upgradeUrl: planLimits.upgradeUrl },
    { feature: 'ai_caption', locked: !planLimits.allowAiCaption, reason: 'La generación de textos con IA requiere Upgrade Plan.', upgradeUrl: planLimits.upgradeUrl },
    { feature: 'ai_comments', locked: !planLimits.allowAiComments, reason: 'Comentarios IA requiere Upgrade Plan.', upgradeUrl: planLimits.upgradeUrl },
    { feature: 'short_links', locked: !planLimits.allowShortLinks, reason: 'Links cortos requiere Upgrade Plan.', upgradeUrl: planLimits.upgradeUrl },
  ];
  return { planLimits, featureLocks: locks };
}

export async function getUiConfig(teamId: number) {
  const [{ planLimits, featureLocks }, accounts] = await Promise.all([
    getPlanLimits(teamId),
    listPublishReadyAccounts(teamId),
  ]);
  const limitedAccounts = accounts.slice(0, Math.max(planLimits.maxConnectedChannels, 0));
  return {
    status: true,
    route: '/es/modulo/autopublicar/',
    connectUrl: '/es/settings/connect',
    billingUrl: AUTOPUBLICAR_UPGRADE_URL,
    layout: {
      mobileTabs: ['Componer', 'Calendario', 'Programadas', 'Comentarios', 'Ajustes'],
      desktopSections: ['Header', 'Compositor', 'Canales', 'Calendario', 'Preview celular', 'Logs'],
      mobileFirst: true,
    },
    planLimits,
    featureLocks,
    accounts: limitedAccounts,
    calendar: {
      enabled: planLimits.allowCalendar,
      modes: planLimits.allowAdvancedCalendar ? ['month', 'week', 'day', 'list'] : ['list'],
      defaultMode: planLimits.allowAdvancedCalendar ? 'month' : 'list',
      timezone: planLimits.timezoneDefault,
    },
    preview: {
      enabled: planLimits.allowPhonePreview,
      device: 'phone',
      platformTabs: Array.from(new Set(limitedAccounts.map((a) => a.platform))),
      showAccountAvatar: true,
      showCharacterCounter: true,
    },
  };
}

export function validateChannelsAgainstPlan(channels: any[], accounts: AutopublishAccount[], planLimits: PlanLimits): { ok: boolean; code?: string; message?: string; normalized?: any[] } {
  if (!Array.isArray(channels) || channels.length === 0) return { ok: false, code: 'NO_CHANNELS', message: 'Selecciona al menos 1 cuenta real conectada.' };
  if (channels.length > planLimits.maxChannelsPerPost) return { ok: false, code: 'PLAN_CHANNEL_LIMIT', message: `Tu plan permite máximo ${planLimits.maxChannelsPerPost} canal(es) por publicación.` };
  if (!planLimits.allowMultiChannelPost && channels.length > 1) return { ok: false, code: 'PLAN_MULTI_CHANNEL_LOCKED', message: 'Tu plan no permite publicar en varios canales al mismo tiempo.' };
  const normalized: any[] = [];
  const seen = new Set<string>();
  for (const input of channels) {
    const id = Number(input?.connectionId ?? input?.id);
    const account = accounts.find((a) => a.id === id && a.zernioAccountId === asString(input?.zernioAccountId, a.zernioAccountId));
    if (!account || !account.isPublishReady) return { ok: false, code: 'ACCOUNT_NOT_PUBLISH_READY', message: 'La cuenta no está conectada o no tiene zernio_account_id real.' };
    if (!planLimits.enabledPlatforms.includes(account.platform)) return { ok: false, code: 'PLATFORM_LOCKED_BY_PLAN', message: `Tu plan no permite publicar en ${account.platform}.` };
    const key = `${account.platform}:${account.zernioAccountId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      connectionId: account.id,
      platform: account.platform,
      zernioAccountId: account.zernioAccountId,
      zernioProfileId: account.zernioProfileId,
      displayName: account.displayName || account.username || account.platform,
      username: account.username || account.displayName || account.platform,
      status: 'pending',
    });
  }
  return { ok: true, normalized };
}

export async function listPosts(teamId: number, query: URLSearchParams) {
  await ensureAutopublishSqlReady();
  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 20)));
  const offset = (page - 1) * limit;
  const args: any[] = [teamId];
  const where = [`team_id = $1`];
  const status = asString(query.get('status'));
  if (status) {
    args.push(status);
    where.push(`status = $${args.length}`);
  }
  const search = asString(query.get('search'));
  if (search) {
    args.push(`%${search}%`);
    where.push(`(title ILIKE $${args.length} OR body ILIKE $${args.length})`);
  }
  const dateFrom = asString(query.get('dateFrom'));
  if (dateFrom) {
    args.push(dateFrom);
    where.push(`COALESCE(scheduled_at, published_at, created_at) >= $${args.length}`);
  }
  const dateTo = asString(query.get('dateTo'));
  if (dateTo) {
    args.push(dateTo);
    where.push(`COALESCE(scheduled_at, published_at, created_at) <= $${args.length}`);
  }
  const whereSql = where.join(' AND ');
  const countRows = await sql.unsafe(`SELECT COUNT(*)::int AS total FROM marketing_ai_posts WHERE ${whereSql}`, args);
  args.push(limit, offset);
  const rows = await sql.unsafe(
    `SELECT * FROM marketing_ai_posts WHERE ${whereSql} ORDER BY COALESCE(scheduled_at, published_at, created_at) DESC, id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  const total = Number(countRows?.[0]?.total || 0);
  return { posts: rows.map(mapPost), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

function computeScheduledAt(body: any): string | null {
  const mode = asString(body?.scheduleMode, body?.publishNow ? 'publish_now' : 'draft');
  if (body?.publishNow || mode === 'publish_now') return null;
  const scheduledAt = asString(body?.scheduledAt);
  if (scheduledAt) return scheduledAt;
  const date = asString(body?.scheduledDate);
  const time = asString(body?.scheduledTime);
  if (mode === 'schedule' && date && time) return `${date}T${time}:00`;
  return null;
}

function addMinutesIso(value: string | null, minutes: number): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function shouldCreatePostPerProduct(body: any, productIds: number[]) {
  if (body?.skipBatch === true) return false;
  if (productIds.length <= 1) return false;
  const mode = asString(body?.batchMode || body?.multiProductMode || body?.campaignMode, 'product_per_post');
  return ['product_per_post', 'products_individual', 'one_post_per_product', 'batch_products'].includes(mode);
}

export async function createPost(teamId: number, userId: number | null, body: any, requestId?: string | null) {
  await ensureAutopublishSqlReady();
  const productIdsForBatch = parseIds(body?.productIds || body?.products);
  if (shouldCreatePostPerProduct(body, productIdsForBatch)) {
    const scheduleMode = asString(body?.scheduleMode, body?.publishNow ? 'publish_now' : 'draft');
    const baseScheduledAt = computeScheduledAt(body);
    const spacingMinutes = Math.max(1, Math.min(240, Number(body?.batchSpacingMinutes || body?.spacingMinutes || 10)));
    const items: any[] = [];
    let okCount = 0;
    let failCount = 0;

    for (let index = 0; index < productIdsForBatch.length; index += 1) {
      const productId = productIdsForBatch[index];
      const generated = await generateAutopublishContent(teamId, {
        ...body,
        productIds: [productId],
        productLimit: 1,
        useAi: body?.useAi,
        generateImage: body?.generateImage,
      });
      const content = generated.content || {};
      const itemScheduledAt = scheduleMode === 'schedule'
        ? addMinutesIso(baseScheduledAt, index * spacingMinutes)
        : null;
      const created = await createPost(teamId, userId, {
        ...body,
        skipBatch: true,
        productIds: [productId],
        title: content.title || body?.title,
        body: content.body || body?.body,
        mediaUrl: content.mediaUrl || body?.mediaUrl || null,
        mediaItems: Array.isArray(content.mediaItems) ? content.mediaItems : (body?.mediaItems || []),
        tags: Array.isArray(content.hashtags) ? content.hashtags : body?.tags,
        scheduleMode,
        scheduledAt: itemScheduledAt,
        publishNow: scheduleMode === 'publish_now' || body?.publishNow === true,
        batchParentRequestId: requestId || null,
        batchIndex: index + 1,
        batchTotal: productIdsForBatch.length,
        uiSource: asString(body?.uiSource, 'autopublicar_batch_products'),
      }, `${requestId || crypto.randomUUID()}-${index + 1}`);
      if (created.status) okCount += 1;
      else failCount += 1;
      items.push({ productId, ...created });
    }

    return {
      status: okCount > 0,
      batch: true,
      mode: 'product_per_post',
      createdCount: okCount,
      failedCount: failCount,
      total: productIdsForBatch.length,
      items,
      message: `Se prepararon ${okCount} publicación(es), una por producto.`,
      httpStatus: okCount > 0 ? 201 : 422,
    };
  }

  const title = asString(body?.title).slice(0, 180) || null;
  const text = asString(body?.body);
  if (!text) return { status: false, code: 'BODY_REQUIRED', message: 'El cuerpo del post es obligatorio.', httpStatus: 400 };
  const [{ planLimits }, accounts] = await Promise.all([getPlanLimits(teamId), listPublishReadyAccounts(teamId)]);
  const validation = validateChannelsAgainstPlan(body?.channels, accounts, planLimits);
  if (!validation.ok) return { status: false, code: validation.code, message: validation.message, httpStatus: 422 };
  const scheduledAt = computeScheduledAt(body);
  const scheduleMode = asString(body?.scheduleMode, body?.publishNow ? 'publish_now' : (scheduledAt ? 'schedule' : 'draft'));
  if (scheduleMode === 'schedule') {
    if (!scheduledAt) return { status: false, code: 'SCHEDULE_REQUIRED', message: 'Selecciona fecha y hora para programar.', httpStatus: 400 };
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate.getTime() <= Date.now()) {
      return { status: false, code: 'SCHEDULE_IN_PAST', message: 'La fecha/hora programada debe ser futura.', httpStatus: 400 };
    }
    if (planLimits.usage.scheduledPosts >= planLimits.maxScheduledPosts) return { status: false, code: 'PLAN_SCHEDULE_LIMIT', message: 'Tu plan alcanzó el límite de publicaciones programadas.', httpStatus: 422 };
  }
  if (planLimits.maxPostsPerMonth > 0 && planLimits.usage.postsThisMonth >= planLimits.maxPostsPerMonth) {
    return { status: false, code: 'PLAN_MONTHLY_LIMIT', message: 'Tu plan alcanzó el límite mensual de publicaciones.', httpStatus: 422 };
  }
  const status = scheduleMode === 'schedule' ? 'scheduled' : (scheduleMode === 'publish_now' ? 'draft' : 'draft');
  const providerResponse = {
    requestId: requestId || crypto.randomUUID(),
    timezone: asString(body?.timezone, planLimits.timezoneDefault),
    mediaItems: Array.isArray(body?.mediaItems) ? body.mediaItems : [],
    shortLink: body?.shortLink || null,
    tags: Array.isArray(body?.tags) ? body.tags : [],
    productIds: parseIds(body?.productIds || body?.products),
    batchParentRequestId: body?.batchParentRequestId || null,
    batchIndex: body?.batchIndex || null,
    batchTotal: body?.batchTotal || null,
    uiSource: asString(body?.uiSource, 'composer'),
  };
  const [row] = await sql.unsafe(
    `INSERT INTO marketing_ai_posts (team_id, user_id, title, body, media_url, channels, status, scheduled_at, provider_response, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, NOW(), NOW())
     RETURNING *`,
    [teamId, userId, title, text, body?.mediaUrl || null, JSON.stringify(validation.normalized || []), status, scheduledAt, JSON.stringify(providerResponse)]
  );
  await addPostLog(teamId, Number(row.id), 'local.post_created', 'success', `Post ${status}`, { scheduleMode, requestId: providerResponse.requestId });
  if (scheduleMode === 'publish_now' || body?.publishNow === true) {
    const published = await publishPost(teamId, Number(row.id), requestId || providerResponse.requestId);
    return { status: published.status, post: published.post, result: published.result, httpStatus: published.status ? 201 : 502 };
  }
  return { status: true, post: mapPost(row), httpStatus: 201 };
}

export async function getPost(teamId: number, postId: number) {
  await ensureAutopublishSqlReady();
  const [row] = await sql.unsafe(`SELECT * FROM marketing_ai_posts WHERE team_id = $1 AND id = $2 LIMIT 1`, [teamId, postId]);
  return row ? mapPost(row) : null;
}

export async function updatePost(teamId: number, postId: number, body: any) {
  const current = await getPost(teamId, postId);
  if (!current) return null;
  if (!['draft', 'scheduled', 'failed'].includes(current.status)) throw new Error('Solo puedes editar borradores, programadas o fallidas.');
  const fields: string[] = [];
  const args: any[] = [teamId, postId];
  const add = (sqlExpr: string, value: any) => { args.push(value); fields.push(`${sqlExpr} = $${args.length}`); };
  if ('title' in body) add('title', asString(body.title).slice(0, 180) || null);
  if ('body' in body) add('body', asString(body.body));
  if ('mediaUrl' in body) add('media_url', body.mediaUrl || null);
  if ('mediaItems' in body) {
    const currentProvider = parseJsonObject(current.providerResponse);
    add('provider_response', JSON.stringify({
      ...currentProvider,
      mediaItems: Array.isArray(body.mediaItems) ? body.mediaItems : [],
      updatedFromComposer: true,
    }));
    fields[fields.length - 1] = `provider_response = COALESCE(provider_response, '{}'::jsonb) || $${args.length}::jsonb`;
  }
  if ('scheduledAt' in body) add('scheduled_at', body.scheduledAt || null);
  if ('status' in body) add('status', body.status || current.status);
  if ('channels' in body) {
    const [{ planLimits }, accounts] = await Promise.all([getPlanLimits(teamId), listPublishReadyAccounts(teamId)]);
    const validation = validateChannelsAgainstPlan(body.channels, accounts, planLimits);
    if (!validation.ok) throw new Error(validation.message || validation.code || 'Canales inválidos');
    add('channels', JSON.stringify(validation.normalized || []));
    fields[fields.length - 1] = `channels = $${args.length}::jsonb`;
  }
  if (fields.length === 0) return current;
  fields.push('updated_at = NOW()');
  const [row] = await sql.unsafe(`UPDATE marketing_ai_posts SET ${fields.join(', ')} WHERE team_id = $1 AND id = $2 RETURNING *`, args);
  await addPostLog(teamId, postId, 'local.post_updated', 'success', 'Post actualizado', {});
  return mapPost(row);
}

export async function deleteOrCancelPost(teamId: number, postId: number) {
  const post = await getPost(teamId, postId);
  if (!post) return null;
  const nextStatus = post.status === 'scheduled' ? 'cancelled' : 'archived';
  const [row] = await sql.unsafe(`UPDATE marketing_ai_posts SET status = $3, updated_at = NOW() WHERE team_id = $1 AND id = $2 RETURNING *`, [teamId, postId, nextStatus]);
  await addPostLog(teamId, postId, 'local.post_deleted', nextStatus, `Post marcado como ${nextStatus}`, {});
  return mapPost(row);
}

export async function cancelPost(teamId: number, postId: number) {
  const post = await getPost(teamId, postId);
  if (!post) return null;
  if (post.status !== 'scheduled') throw new Error('Solo se pueden cancelar publicaciones programadas.');
  const [row] = await sql.unsafe(`UPDATE marketing_ai_posts SET status = 'cancelled', updated_at = NOW() WHERE team_id = $1 AND id = $2 RETURNING *`, [teamId, postId]);
  await addPostLog(teamId, postId, 'local.post_cancelled', 'cancelled', 'Programación cancelada', {});
  return mapPost(row);
}

export async function addPostLog(teamId: number, postId: number | null, eventType: string, status: string, message: string | null, metadata: Record<string, any>) {
  await sql.unsafe(
    `INSERT INTO marketing_ai_post_logs (team_id, post_id, platform, provider, event_type, status, message, metadata, created_at, updated_at)
     VALUES ($1, $2, 'zernio', 'zernio', $3, $4, $5, $6::jsonb, NOW(), NOW())`,
    [teamId, postId, eventType, status, message, JSON.stringify(metadata || {})]
  );
}

export async function publishPost(teamId: number, postId: number, requestId?: string | null) {
  const post = await getPost(teamId, postId);
  if (!post) return { status: false, code: 'NOT_FOUND', message: 'Post no encontrado', httpStatus: 404 };
  const accounts = await listPublishReadyAccounts(teamId);
  const { planLimits } = await getPlanLimits(teamId);
  const validation = validateChannelsAgainstPlan(post.channels, accounts, planLimits);
  if (!validation.ok) return { status: false, code: validation.code, message: validation.message, httpStatus: 422, post };
  await sql.unsafe(`UPDATE marketing_ai_posts SET status = 'publishing', updated_at = NOW() WHERE team_id = $1 AND id = $2`, [teamId, postId]);
  const idempotencyKey = requestId || post.providerResponse?.requestId || crypto.randomUUID();
  try {
    if (!zernioApiKey()) throw new Error('ZERNIO_API_KEY no está configurada en el servidor.');
    const mediaItems = Array.isArray(post.mediaItems) && post.mediaItems.length
      ? post.mediaItems
      : (post.mediaUrl ? [{ type: 'image', url: post.mediaUrl }] : []);
    const zernioPayload = {
      title: post.title || undefined,
      content: post.body,
      mediaItems,
      platforms: (validation.normalized || []).map((c: any) => ({
        platform: c.platform,
        accountId: c.zernioAccountId,
      })),
      publishNow: true,
      timezone: asString(post.providerResponse?.timezone, planLimits.timezoneDefault),
      tags: Array.isArray(post.providerResponse?.tags) ? post.providerResponse.tags : [],
      hashtags: Array.isArray(post.providerResponse?.hashtags) ? post.providerResponse.hashtags : [],
      metadata: {
        source: 'allsender_autopublicar',
        localPostId: postId,
        requestId: idempotencyKey,
      },
    };
    const zernioResponse = await callZernio('/v1/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-request-id': idempotencyKey },
      body: JSON.stringify(zernioPayload),
    });
    const nextChannels = (validation.normalized || []).map((c: any) => ({ ...c, status: 'published', publishedAt: new Date().toISOString() }));
    const [row] = await sql.unsafe(
      `UPDATE marketing_ai_posts
       SET status = 'published', channels = $3::jsonb, published_at = NOW(), provider_response = COALESCE(provider_response, '{}'::jsonb) || $4::jsonb, updated_at = NOW()
       WHERE team_id = $1 AND id = $2 RETURNING *`,
      [teamId, postId, JSON.stringify(nextChannels), JSON.stringify({ zernioResponse, requestId: idempotencyKey })]
    );
    await addPostLog(teamId, postId, 'zernio.post_publish', 'success', 'Publicado por Zernio', { requestId: idempotencyKey, zernioResponse });
    const mapped = mapPost(row);
    return { status: true, result: { postId, status: 'published', zernioPostId: asString((zernioResponse as any)?.id || (zernioResponse as any)?.postId), platformResults: nextChannels, error: null }, post: mapped, httpStatus: 200 };
  } catch (error: any) {
    const failedChannels = (validation.normalized || []).map((c: any) => ({ ...c, status: 'failed', errorMessage: error?.message || 'Error publicando en Zernio' }));
    const [row] = await sql.unsafe(
      `UPDATE marketing_ai_posts
       SET status = 'failed', channels = $3::jsonb, provider_response = COALESCE(provider_response, '{}'::jsonb) || $4::jsonb, updated_at = NOW()
       WHERE team_id = $1 AND id = $2 RETURNING *`,
      [teamId, postId, JSON.stringify(failedChannels), JSON.stringify({ error: error?.message || String(error), requestId: idempotencyKey, upstream: error?.data || null })]
    );
    await addPostLog(teamId, postId, 'zernio.post_publish', 'failed', error?.message || 'Error publicando en Zernio', { requestId: idempotencyKey, data: error?.data || null });
    return { status: false, result: { postId, status: 'failed', platformResults: failedChannels, error: error?.message || String(error) }, post: mapPost(row), httpStatus: error?.status === 401 ? 502 : 502 };
  }
}

export async function listPostLogs(teamId: number, postId: number) {
  await ensureAutopublishSqlReady();
  const rows = await sql.unsafe(`SELECT * FROM marketing_ai_post_logs WHERE team_id = $1 AND post_id = $2 ORDER BY created_at DESC LIMIT 100`, [teamId, postId]);
  return rows.map(mapLog);
}

export async function listEventLogs(teamId: number, query: URLSearchParams) {
  await ensureAutopublishSqlReady();
  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 20)));
  const offset = (page - 1) * limit;
  const rows = await sql.unsafe(`SELECT * FROM marketing_ai_event_logs WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [teamId, limit, offset]);
  const totalRows = await sql.unsafe(`SELECT COUNT(*)::int AS total FROM marketing_ai_event_logs WHERE team_id = $1`, [teamId]);
  return { logs: rows.map((r) => ({ ...mapLog({ ...r, post_id: null, message: null }) })), pagination: { page, limit, total: Number(totalRows?.[0]?.total || 0), pages: Math.max(1, Math.ceil(Number(totalRows?.[0]?.total || 0) / limit)) } };
}

export async function getCalendar(teamId: number, query: URLSearchParams) {
  await ensureAutopublishSqlReady();
  const { planLimits } = await getPlanLimits(teamId);
  const timezone = asString(query.get('timezone'), planLimits.timezoneDefault);
  const mode = asString(query.get('mode'), 'month');
  if (!planLimits.allowCalendar) return { status: true, timezone, mode, events: [], planLimits };
  const from = asString(query.get('from'), new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString());
  const to = asString(query.get('to'), new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString());
  const rows = await sql.unsafe(
    `SELECT * FROM marketing_ai_posts
     WHERE team_id = $1
       AND COALESCE(scheduled_at, published_at, created_at) >= $2
       AND COALESCE(scheduled_at, published_at, created_at) <= $3
       AND status IN ('scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled', 'draft')
     ORDER BY COALESCE(scheduled_at, published_at, created_at) ASC`,
    [teamId, from, to]
  );
  const events = rows.map((row: any) => {
    const post = mapPost(row);
    return {
      id: `post-${post.id}`,
      postId: post.id,
      title: post.title || post.body.slice(0, 40) || `Post #${post.id}`,
      bodyPreview: post.body.slice(0, 120),
      start: post.scheduledAt || post.publishedAt || post.createdAt,
      end: null,
      timezone,
      status: post.status,
      channels: post.channels,
      editable: ['draft', 'scheduled', 'failed'].includes(post.status),
      colorKey: post.status,
    };
  });
  return { status: true, timezone, mode, events, planLimits };
}

export async function previewPost(teamId: number, body: any) {
  const accounts = await listPublishReadyAccounts(teamId);
  const { planLimits, featureLocks } = await getPlanLimits(teamId);
  const validation = validateChannelsAgainstPlan(body?.channels, accounts, planLimits);
  if (!validation.ok) return { status: false, code: validation.code, message: validation.message, httpStatus: 422 };
  const text = asString(body?.body);
  const mediaItems = Array.isArray(body?.mediaItems) ? body.mediaItems : (body?.mediaUrl ? [{ type: 'image', url: body.mediaUrl }] : []);
  const previews = (validation.normalized || []).map((c: any) => {
    const account = accounts.find((a) => a.id === c.connectionId)!;
    const warnings: string[] = [];
    if (c.platform === 'twitter' || c.platform === 'x') {
      if (text.length > 280) warnings.push('X/Twitter puede recortar textos mayores de 280 caracteres.');
    }
    if (mediaItems.length > 1 && ['instagram', 'tiktok'].includes(c.platform)) warnings.push('Verifica que el carrusel/video sea compatible con esta plataforma.');
    return {
      platform: c.platform,
      account,
      device: 'phone',
      displayHeader: account.displayName || account.username || c.platform,
      text,
      mediaItems,
      shortLink: body?.shortLink || null,
      characterCount: text.length,
      warnings,
      lockedByPlan: false,
    };
  });
  return { status: true, previews, planLimits, featureLocks };
}

export async function getMarketingSettings(teamId: number) {
  await ensureAutopublishSqlReady();
  const [row] = await sql.unsafe(
    `INSERT INTO marketing_ai_settings (team_id) VALUES ($1)
     ON CONFLICT (team_id) DO UPDATE SET team_id = EXCLUDED.team_id
     RETURNING *`,
    [teamId]
  );
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    isActive: Boolean(row.is_active),
    autoCommentEnabled: Boolean(row.auto_comment_enabled),
    autoDmEnabled: Boolean(row.auto_dm_enabled),
    tone: asString(row.tone, 'professional_friendly'),
    basePrompt: asString(row.base_prompt),
    humanHandoffKeywords: Array.isArray(row.human_handoff_keywords) ? row.human_handoff_keywords : [],
    metadata: parseJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function updateMarketingSettings(teamId: number, body: any) {
  const current = await getMarketingSettings(teamId);
  const [row] = await sql.unsafe(
    `UPDATE marketing_ai_settings
     SET is_active = $2, auto_comment_enabled = $3, auto_dm_enabled = $4, tone = $5, base_prompt = $6,
         human_handoff_keywords = $7, metadata = $8::jsonb, updated_at = NOW()
     WHERE team_id = $1 RETURNING *`,
    [
      teamId,
      typeof body?.isActive === 'boolean' ? body.isActive : current.isActive,
      typeof body?.autoCommentEnabled === 'boolean' ? body.autoCommentEnabled : current.autoCommentEnabled,
      typeof body?.autoDmEnabled === 'boolean' ? body.autoDmEnabled : current.autoDmEnabled,
      asString(body?.tone, current.tone),
      asString(body?.basePrompt, current.basePrompt),
      Array.isArray(body?.humanHandoffKeywords) ? body.humanHandoffKeywords : current.humanHandoffKeywords,
      JSON.stringify(parseJsonObject(body?.metadata) || current.metadata),
    ]
  );
  return getMarketingSettings(Number(row.team_id));
}

export async function getCommentSettings(teamId: number) {
  await ensureAutopublishSqlReady();
  const [row] = await sql.unsafe(
    `INSERT INTO marketing_ai_comment_settings (team_id) VALUES ($1)
     ON CONFLICT (team_id) DO UPDATE SET team_id = EXCLUDED.team_id
     RETURNING *`,
    [teamId]
  );
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    isEnabled: Boolean(row.is_enabled),
    mode: asString(row.mode, 'manual_review'),
    baseInstructions: row.base_instructions ?? null,
    autoDm: Boolean(row.auto_dm),
    autoReplyPublic: Boolean(row.auto_reply_public),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function updateCommentSettings(teamId: number, body: any) {
  const current = await getCommentSettings(teamId);
  const [row] = await sql.unsafe(
    `UPDATE marketing_ai_comment_settings SET is_enabled = $2, mode = $3, base_instructions = $4, auto_dm = $5, auto_reply_public = $6, updated_at = NOW()
     WHERE team_id = $1 RETURNING *`,
    [
      teamId,
      typeof body?.isEnabled === 'boolean' ? body.isEnabled : current.isEnabled,
      asString(body?.mode, current.mode),
      body?.baseInstructions ?? current.baseInstructions,
      typeof body?.autoDm === 'boolean' ? body.autoDm : current.autoDm,
      typeof body?.autoReplyPublic === 'boolean' ? body.autoReplyPublic : current.autoReplyPublic,
    ]
  );
  return getCommentSettings(Number(row.team_id));
}

export async function listComments(teamId: number, query: URLSearchParams) {
  await ensureAutopublishSqlReady();
  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 20)));
  const offset = (page - 1) * limit;
  const rows = await sql.unsafe(`SELECT * FROM marketing_ai_comment_logs WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [teamId, limit, offset]);
  const countRows = await sql.unsafe(`SELECT COUNT(*)::int AS total FROM marketing_ai_comment_logs WHERE team_id = $1`, [teamId]);
  const total = Number(countRows?.[0]?.total || 0);
  return { comments: rows.map(mapComment), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function previewCommentReply(teamId: number, body: any) {
  const { planLimits } = await getPlanLimits(teamId);
  if (!planLimits.allowAiComments) return { status: false, code: 'AI_COMMENTS_LOCKED', message: 'Comentarios IA requiere Upgrade Plan.', httpStatus: 422 };
  const text = asString(body?.commentText);
  if (!text) return { status: false, code: 'COMMENT_REQUIRED', message: 'Falta el comentario.', httpStatus: 400 };
  const lower = text.toLowerCase();
  const needsHuman = /(queja|reclamo|estafa|demanda|abogado|mal servicio|cancelar|molesto)/.test(lower);
  const reply = needsHuman
    ? 'Gracias por escribirnos. Para ayudarte mejor con tu caso, por favor escríbenos por mensaje privado y un agente te asistirá.'
    : `Gracias por escribirnos. Con gusto te ayudamos por mensaje privado con más información.`;
  return { status: true, reply, needsHuman, reason: needsHuman ? 'Comentario sensible detectado.' : 'Respuesta sugerida básica.' };
}

export async function approveComment(teamId: number, commentLogId: number, body: any) {
  const reply = asString(body?.reply);
  if (!reply) throw new Error('La respuesta es obligatoria.');
  const [row] = await sql.unsafe(
    `UPDATE marketing_ai_comment_logs SET ai_reply = $3, action = $4, status = 'approved', updated_at = NOW()
     WHERE team_id = $1 AND id = $2 RETURNING *`,
    [teamId, commentLogId, reply, body?.sendDm ? 'auto_dm' : 'auto_reply']
  );
  if (!row) return null;
  return mapComment(row);
}

export async function rejectComment(teamId: number, commentLogId: number, body: any) {
  const [row] = await sql.unsafe(
    `UPDATE marketing_ai_comment_logs SET action = $3, status = $4, metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb, updated_at = NOW()
     WHERE team_id = $1 AND id = $2 RETURNING *`,
    [teamId, commentLogId, body?.needsHuman ? 'human' : 'ignore', body?.needsHuman ? 'needs_human' : 'ignored', JSON.stringify({ rejectReason: body?.reason || null })]
  );
  if (!row) return null;
  return mapComment(row);
}

export async function publishDuePosts(teamId: number | null, limit: number) {
  await ensureAutopublishSqlReady();
  const args: any[] = [];
  let teamFilter = '';
  if (teamId) {
    args.push(teamId);
    teamFilter = `AND team_id = $${args.length}`;
  }
  args.push(Math.min(50, Math.max(1, limit || 10)));
  const rows = await sql.unsafe(
    `SELECT * FROM marketing_ai_posts
     WHERE status = 'scheduled'
       AND scheduled_at <= NOW()
       ${teamFilter}
     ORDER BY scheduled_at ASC
     LIMIT $${args.length}`,
    args
  );
  const items = [];
  let published = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await publishPost(Number(row.team_id), Number(row.id), crypto.randomUUID());
    items.push(result.result || { postId: Number(row.id), status: result.status ? 'published' : 'failed', error: (result as any).message || null });
    if (result.status) published += 1;
    else failed += 1;
  }
  return { status: true, processed: rows.length, published, failed, items };
}


export type AutopublishProduct = {
  id: number;
  sku: string | null;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  stock: number | null;
  isActive: boolean;
  images: string[];
  metadata: Record<string, any>;
  updatedAt: string | null;
};

function mapProduct(row: any): AutopublishProduct {
  const metadata = parseJsonObject(row?.metadata);
  const images = new Set<string>();
  const addImage = (value: unknown) => {
    const url = asString(value);
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) images.add(url);
  };
  addImage(row?.image_url);
  for (const key of ['images', 'gallery', 'media', 'mediaItems', 'productImages', 'photos']) {
    const value = metadata?.[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') addImage(item);
        else addImage(item?.url || item?.src || item?.imageUrl || item?.image_url);
      }
    }
  }
  return {
    id: Number(row.id),
    sku: row.sku ?? null,
    name: asString(row.name, `Producto #${row.id}`),
    description: row.description ?? null,
    category: row.category ?? null,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    currency: row.currency ?? null,
    imageUrl: row.image_url ?? null,
    stock: row.stock === null || row.stock === undefined ? null : Number(row.stock),
    isActive: Boolean(row.is_active),
    images: Array.from(images).slice(0, 10),
    metadata,
    updatedAt: toIso(row.updated_at),
  };
}

export async function listAutopublishProducts(teamId: number, query?: URLSearchParams | Record<string, any>) {
  await ensureAutopublishSqlReady();
  const get = (key: string) => query instanceof URLSearchParams ? query.get(key) : query?.[key];
  const limit = Math.min(100, Math.max(1, Number(get('limit') || 24)));
  const search = asString(get('search'));
  const category = asString(get('category'));
  const includeInactive = ['1', 'true', 'yes'].includes(asString(get('includeInactive')).toLowerCase());
  const includeOutOfStock = ['1', 'true', 'yes'].includes(asString(get('includeOutOfStock')).toLowerCase());
  const args: any[] = [teamId];
  const where = ['team_id = $1'];
  if (!includeInactive) where.push('is_active = true');
  if (!includeOutOfStock) where.push('(stock IS NULL OR stock > 0)');
  if (search) {
    args.push(`%${search}%`);
    where.push(`(name ILIKE $${args.length} OR COALESCE(description,'') ILIKE $${args.length} OR COALESCE(category,'') ILIKE $${args.length} OR COALESCE(sku,'') ILIKE $${args.length})`);
  }
  if (category) {
    args.push(category);
    where.push(`lower(COALESCE(category,'')) = lower($${args.length})`);
  }
  args.push(limit);
  const rows = await sql.unsafe(
    `SELECT id, team_id, sku, name, description, category, price, currency, image_url, stock, is_active, metadata, updated_at
     FROM ai_sales_products
     WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN stock IS NULL THEN 1 WHEN stock > 0 THEN 0 ELSE 2 END, updated_at DESC, id DESC
     LIMIT $${args.length}`,
    args
  ).catch(() => []);
  const categoriesRows = await sql.unsafe(
    `SELECT DISTINCT category FROM ai_sales_products WHERE team_id = $1 AND category IS NOT NULL AND btrim(category) <> '' ORDER BY category ASC LIMIT 80`,
    [teamId]
  ).catch(() => []);
  return { products: rows.map(mapProduct), categories: categoriesRows.map((r: any) => asString(r.category)).filter(Boolean) };
}

function parseIds(value: unknown): number[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return raw.map((x) => Number(typeof x === 'object' ? (x as any)?.id : x)).filter((n) => Number.isFinite(n) && n > 0).slice(0, 20);
}

async function getProductsByIds(teamId: number, ids: number[]) {
  if (!ids.length) return [];
  const rows = await sql.unsafe(
    `SELECT id, team_id, sku, name, description, category, price, currency, image_url, stock, is_active, metadata, updated_at
     FROM ai_sales_products
     WHERE team_id = $1 AND id = ANY($2::int[]) AND is_active = true
     ORDER BY array_position($2::int[], id)`,
    [teamId, ids]
  ).catch(() => []);
  return rows.map(mapProduct);
}

function hashtagsFrom(input: { keywords?: string[]; products?: AutopublishProduct[]; platform?: string }) {
  const words = new Set<string>();
  for (const k of input.keywords || []) {
    const clean = asString(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '');
    if (clean) words.add(clean.slice(0, 36));
  }
  for (const p of input.products || []) {
    for (const k of [p.category, p.name.split(/\s+/)[0]]) {
      const clean = asString(k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '');
      if (clean) words.add(clean.slice(0, 36));
    }
  }
  words.add('Oferta');
  words.add('Disponible');
  return Array.from(words).slice(0, 8).map((w) => `#${w}`);
}

function buildProductFallback(input: {
  products: AutopublishProduct[];
  keywords: string[];
  colors: string[];
  tone?: string;
  brandName?: string;
}) {
  const products = input.products || [];
  const first = products[0];
  const brand = asString(input.brandName, 'Allsender');
  const names = products.slice(0, 4).map((p) => p.name).filter(Boolean);
  const stockLine = first?.stock !== null && first?.stock !== undefined
    ? (Number(first.stock) <= 3 ? '⚡ Últimas unidades disponibles.' : `Disponible en stock: ${first.stock}.`)
    : 'Disponible por tiempo limitado.';
  const priceLine = first?.price ? `Precio: ${first.currency || 'RD$'} ${Number(first.price).toLocaleString('es-DO')}.` : '';
  const title = first ? `${first.name} disponible ahora` : `Nueva publicación de ${brand}`;
  const hashtags = hashtagsFrom({ keywords: input.keywords, products });
  const body = first
    ? [
        `✨ ${first.name}`,
        first.description ? first.description.slice(0, 180) : `Una opción ideal para quienes buscan calidad y buen servicio.`,
        priceLine,
        stockLine,
        `Escríbenos por DM para más información o para ordenar.`,
        hashtags.join(' '),
      ].filter(Boolean).join('\n\n')
    : [`✨ ${brand}`, `Tenemos novedades disponibles. Escríbenos por DM para más información.`, hashtags.join(' ')].join('\n\n');
  const imagePrompt = [
    `Diseño promocional moderno para redes sociales`,
    names.length ? `productos: ${names.join(', ')}` : '',
    input.colors.length ? `colores de marca: ${input.colors.join(', ')}` : '',
    input.keywords.length ? `palabras clave: ${input.keywords.join(', ')}` : '',
    `estilo limpio, comercial, mobile first, alta conversión`,
  ].filter(Boolean).join('. ');
  const productImages = products.flatMap((p) => p.images).slice(0, 10);
  return { title, body, hashtags, cta: 'Escríbenos por DM', imagePrompt, mediaItems: productImages.map((url) => ({ type: 'image', url })), mediaUrl: productImages[0] || null, aiUsed: false, fallback: true };
}

function safeJsonParseFromText(value: unknown) {
  const text = asString(value);
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

async function getGlobalAiConfig(teamId: number) {
  const [row] = await sql.unsafe(
    `SELECT id, team_id, provider, model, api_key, system_prompt, temperature, max_output_tokens, is_active
     FROM ai_configs
     WHERE team_id = $1 AND is_active = true
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`,
    [teamId]
  ).catch(() => []);
  return row || null;
}

async function tryGenerateImageWithOpenAi(teamId: number, prompt: string, apiKey: string | null | undefined) {
  if (!apiKey || !prompt) return null;
  try {
    const openai = new OpenAI({ apiKey }) as any;
    const res = await openai.images.generate({ model: 'gpt-image-1', prompt, size: '1024x1024' });
    const b64 = res?.data?.[0]?.b64_json;
    if (!b64) return null;
    const dir = path.join(process.cwd(), 'public', 'uploads', 'autopublicar', String(teamId));
    await fs.mkdir(dir, { recursive: true });
    const fileName = `auto-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
    await fs.writeFile(path.join(dir, fileName), Buffer.from(b64, 'base64'));
    return `/uploads/autopublicar/${teamId}/${fileName}`;
  } catch (error: any) {
    await addEventLogSafe(teamId, 'ai.image_generate', 'warning', { message: error?.message || String(error) });
    return null;
  }
}

async function addEventLogSafe(teamId: number, eventType: string, status: string, metadata: Record<string, any>) {
  try {
    await ensureAutopublishSqlReady();
    await sql.unsafe(
      `INSERT INTO marketing_ai_event_logs (team_id, platform, provider, event_type, status, metadata, created_at, updated_at)
       VALUES ($1, 'autopublicar', 'internal', $2, $3, $4::jsonb, NOW(), NOW())`,
      [teamId, eventType, status, JSON.stringify(metadata || {})]
    );
  } catch {}
}

export async function generateAutopublishContent(teamId: number, body: any) {
  await ensureAutopublishSqlReady();
  const keywords = String(body?.keywords || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  const colors = String(body?.colors || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
  const productIds = parseIds(body?.productIds || body?.products);
  let products = await getProductsByIds(teamId, productIds);
  if (!products.length) {
    const result = await listAutopublishProducts(teamId, { search: keywords.join(' '), limit: body?.productLimit || 4 });
    products = result.products.slice(0, Math.max(1, Number(body?.productLimit || 4)));
  }
  const fallback = buildProductFallback({ products, keywords, colors, tone: body?.tone, brandName: body?.brandName });
  const aiConfig = await getGlobalAiConfig(teamId);
  let generated = { ...fallback, aiUsed: false, aiProvider: aiConfig?.provider || null, aiError: null as string | null };
  if (body?.useAi !== false) {
    try {
      const prompt = [
        'Genera contenido comercial para redes sociales en español dominicano neutro.',
        'Devuelve SOLO JSON válido con las claves: title, body, hashtags(array), cta, imagePrompt.',
        `Tono: ${asString(body?.tone, 'profesional, cercano y vendedor')}`,
        keywords.length ? `Palabras clave: ${keywords.join(', ')}` : '',
        colors.length ? `Colores de marca: ${colors.join(', ')}` : '',
        products.length ? `Productos/stock: ${products.map((p) => `${p.name} | ${p.category || ''} | precio ${p.price || ''} ${p.currency || ''} | stock ${p.stock ?? 'N/D'} | ${p.description || ''}`).join('\n')}` : '',
        'No inventes disponibilidad. Si el stock es bajo, usa urgencia sin exagerar. Incluye CTA por DM.',
      ].filter(Boolean).join('\n');
      // Fase 9 (§F9): Morf-first — el runtime global decide el proveedor. Si
      // Morf no está disponible, cae al config legado del team (ai_configs).
      let parsed: any = null;
      try {
        const morfRes = await morfGenerate(
          {
            teamId,
            moduleCode: 'marketing_ai',
            capability: 'structured_output',
            responseFormat: { type: 'json_object' },
            messages: [
              { role: 'system', content: asString(aiConfig?.system_prompt, 'Eres un copywriter experto en ventas para redes sociales.') },
              { role: 'user', content: prompt },
            ],
            metadata: { channel: 'social', feature: 'autopublish_caption' },
          },
          { timeoutMs: 15000 }
        );
        if (morfRes.ok && morfRes.text) {
          parsed = safeJsonParseFromText(morfRes.text);
        } else if (!morfRes.ok) {
          console.warn('[autopublicar:caption:morf] no disponible, usando config legado:', morfRes.reason, morfRes.message);
        }
      } catch (error: any) {
        console.warn('[autopublicar:caption:morf] falló, usando config legado:', error?.message || error);
      }
      if (!parsed && aiConfig?.api_key) {
        const Provider = String(aiConfig.provider).toLowerCase() === 'gemini' ? GeminiProvider : OpenAIProvider;
        const provider = new Provider({
          apiKey: String(aiConfig.api_key),
          model: asString(aiConfig.model, String(aiConfig.provider).toLowerCase() === 'gemini' ? 'gemini-2.5-flash' : 'gpt-4o-mini'),
          systemPrompt: asString(aiConfig.system_prompt, 'Eres un copywriter experto en ventas para redes sociales.'),
          temperature: Number(aiConfig.temperature ?? 0.7),
          maxOutputTokens: Number(aiConfig.max_output_tokens ?? 1000),
        } as any);
        const res: any = await provider.generateResponse([{ role: 'user', content: prompt }] as any[]);
        parsed = safeJsonParseFromText(res?.content);
      }
      if (parsed) {
        generated = {
          ...generated,
          title: asString(parsed.title, fallback.title).slice(0, 180),
          body: asString(parsed.body, fallback.body),
          hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags.map((x: unknown) => asString(x)).filter(Boolean).slice(0, 12) : fallback.hashtags,
          cta: asString(parsed.cta, fallback.cta),
          imagePrompt: asString(parsed.imagePrompt, fallback.imagePrompt),
          aiUsed: true,
          fallback: false,
        };
      }
      if (!generated.aiUsed && aiConfig?.is_active && !aiConfig?.api_key) {
        await addEventLogSafe(teamId, 'ai.caption_fallback', 'warning', { message: 'IA activa sin API key. Se usó plantilla automática.', provider: aiConfig.provider });
      }
    } catch (error: any) {
      generated.aiError = error?.message || String(error);
      await addEventLogSafe(teamId, 'ai.caption_fallback', 'warning', { message: generated.aiError, provider: aiConfig.provider });
    }
  }
  const wantImage = Boolean(body?.generateImage || body?.imageMode === 'ai');
  if (wantImage && String(aiConfig?.provider || '').toLowerCase() === 'openai' && aiConfig?.api_key) {
    const imageUrl = await tryGenerateImageWithOpenAi(teamId, generated.imagePrompt, aiConfig.api_key);
    if (imageUrl) {
      generated.mediaUrl = imageUrl;
      generated.mediaItems = [{ type: 'image', url: imageUrl }, ...generated.mediaItems].slice(0, 10);
    }
  }
  return {
    status: true,
    content: generated,
    products,
    source: generated.aiUsed ? 'global_ai' : 'fallback_products',
    message: generated.aiError ? 'La IA global falló; se generó contenido con plantilla y productos reales.' : 'Contenido generado.',
  };
}

export async function getAutopublishAutomationSettings(teamId: number) {
  const settings = await getMarketingSettings(teamId);
  const meta = parseJsonObject(settings.metadata);
  const autopublish = parseJsonObject(meta.autopublish);
  return {
    ...settings,
    autopublish: {
      autoEnabled: Boolean(autopublish.autoEnabled),
      autoPublish: Boolean(autopublish.autoPublish),
      frequencyHours: Number(autopublish.frequencyHours || 24),
      postsPerRun: Number(autopublish.postsPerRun || 1),
      keywords: asString(autopublish.keywords),
      colors: asString(autopublish.colors),
      tone: asString(autopublish.tone, settings.tone || 'profesional y vendedor'),
      productLimit: Number(autopublish.productLimit || 4),
      generateImage: Boolean(autopublish.generateImage),
      scheduleDelayMinutes: Number(autopublish.scheduleDelayMinutes || 5),
      lastRunAt: autopublish.lastRunAt || null,
    },
  };
}

export async function updateAutopublishAutomationSettings(teamId: number, body: any) {
  const current = await getMarketingSettings(teamId);
  const meta = parseJsonObject(current.metadata);
  const currentAuto = parseJsonObject(meta.autopublish);
  const nextAuto = {
    ...currentAuto,
    autoEnabled: typeof body?.autoEnabled === 'boolean' ? body.autoEnabled : Boolean(currentAuto.autoEnabled),
    autoPublish: typeof body?.autoPublish === 'boolean' ? body.autoPublish : Boolean(currentAuto.autoPublish),
    frequencyHours: Number(body?.frequencyHours || currentAuto.frequencyHours || 24),
    postsPerRun: Number(body?.postsPerRun || currentAuto.postsPerRun || 1),
    keywords: asString(body?.keywords, asString(currentAuto.keywords)),
    colors: asString(body?.colors, asString(currentAuto.colors)),
    tone: asString(body?.tone, asString(currentAuto.tone, current.tone)),
    productLimit: Number(body?.productLimit || currentAuto.productLimit || 4),
    generateImage: typeof body?.generateImage === 'boolean' ? body.generateImage : Boolean(currentAuto.generateImage),
    scheduleDelayMinutes: Number(body?.scheduleDelayMinutes || currentAuto.scheduleDelayMinutes || 5),
  };
  return updateMarketingSettings(teamId, { metadata: { ...meta, autopublish: nextAuto } });
}

export async function verifyAutopublishCronKey(key: string | null | undefined) {
  const clean = asString(key);
  if (!clean) return false;
  const envValues = [process.env.AUTOPUBLICAR_CRON_TOKEN, process.env.CRON_SECRET, process.env.ZERNIO_SYNC_SECRET].map((v) => asString(v)).filter(Boolean);
  if (envValues.includes(clean)) return true;
  const hash = crypto.createHash('sha256').update(clean).digest('hex');
  const [row] = await sql.unsafe(
    `SELECT id FROM autopublicar_cron_tokens WHERE is_active = true AND token_hash = $1 AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`,
    [hash]
  ).catch(() => []);
  return Boolean(row);
}

export async function generateAutomaticPosts(teamId: number | null, limit: number) {
  await ensureAutopublishSqlReady();
  const args: any[] = [];
  const where = [`ms.is_active = true`, `(ms.metadata->'autopublish'->>'autoEnabled')::boolean IS TRUE`];
  if (teamId) { args.push(teamId); where.push(`ms.team_id = $${args.length}`); }
  args.push(Math.min(50, Math.max(1, Number(limit || 10))));
  const rows = await sql.unsafe(
    `SELECT ms.team_id, ms.metadata
     FROM marketing_ai_settings ms
     WHERE ${where.join(' AND ')}
     ORDER BY ms.updated_at ASC
     LIMIT $${args.length}`,
    args
  ).catch(() => []);
  const items: any[] = [];
  for (const row of rows) {
    const tId = Number(row.team_id);
    const settings = await getAutopublishAutomationSettings(tId);
    const auto = settings.autopublish;
    const accounts = await listPublishReadyAccounts(tId);
    if (!accounts.length) { items.push({ teamId: tId, status: 'skipped', reason: 'no_accounts' }); continue; }
    const channels = accounts.slice(0, Math.max(1, Math.min(accounts.length, 10))).map((a) => ({ connectionId: a.id, zernioAccountId: a.zernioAccountId, platform: a.platform }));
    for (let i = 0; i < Math.max(1, Math.min(5, auto.postsPerRun)); i++) {
      const generated = await generateAutopublishContent(tId, { keywords: auto.keywords, colors: auto.colors, tone: auto.tone, productLimit: auto.productLimit, generateImage: auto.generateImage });
      const scheduledAt = auto.autoPublish ? new Date(Date.now() + Math.max(1, auto.scheduleDelayMinutes) * 60_000).toISOString() : null;
      const created = await createPost(tId, null, {
        title: generated.content.title,
        body: generated.content.body,
        mediaUrl: generated.content.mediaUrl,
        mediaItems: generated.content.mediaItems,
        channels,
        scheduleMode: auto.autoPublish ? 'schedule' : 'draft',
        scheduledAt,
        timezone: 'America/Santo_Domingo',
        tags: generated.content.hashtags || [],
        uiSource: 'cron_auto_generate',
      }, crypto.randomUUID());
      items.push({ teamId: tId, created });
    }
    const meta = parseJsonObject(settings.metadata);
    await updateMarketingSettings(tId, { metadata: { ...meta, autopublish: { ...auto, lastRunAt: new Date().toISOString() } } });
  }
  return { status: true, processedTeams: rows.length, items };
}

export async function retryFailedAutopublishPosts(teamId: number | null, limit: number) {
  await ensureAutopublishSqlReady();
  const args: any[] = [];
  let teamFilter = '';
  if (teamId) { args.push(teamId); teamFilter = `AND team_id = $${args.length}`; }
  args.push(Math.min(50, Math.max(1, Number(limit || 10))));
  const rows = await sql.unsafe(
    `SELECT id, team_id, provider_response FROM marketing_ai_posts
     WHERE status = 'failed' ${teamFilter}
       AND COALESCE((provider_response->>'retryCount')::int, 0) < 3
     ORDER BY updated_at ASC LIMIT $${args.length}`,
    args
  ).catch(() => []);
  const items: any[] = [];
  for (const row of rows) {
    const retryCount = Number(parseJsonObject(row.provider_response).retryCount || 0) + 1;
    await sql.unsafe(`UPDATE marketing_ai_posts SET provider_response = COALESCE(provider_response, '{}'::jsonb) || $3::jsonb, updated_at = NOW() WHERE team_id = $1 AND id = $2`, [Number(row.team_id), Number(row.id), JSON.stringify({ retryCount })]);
    items.push(await publishPost(Number(row.team_id), Number(row.id), crypto.randomUUID()));
  }
  return { status: true, processed: rows.length, items };
}

export async function cleanupAutopublish(teamId: number | null) {
  await ensureAutopublishSqlReady();
  const args: any[] = [];
  let teamFilter = '';
  if (teamId) { args.push(teamId); teamFilter = `AND team_id = $${args.length}`; }
  const stuck = await sql.unsafe(`UPDATE marketing_ai_posts SET status = 'failed', provider_response = COALESCE(provider_response, '{}'::jsonb) || '{"cleanup":"stuck_publishing"}'::jsonb, updated_at = NOW() WHERE status = 'publishing' AND updated_at < NOW() - INTERVAL '30 minutes' ${teamFilter} RETURNING id`, args).catch(() => []);
  const archived = await sql.unsafe(`UPDATE marketing_ai_posts SET status = 'archived', updated_at = NOW() WHERE status IN ('failed','cancelled') AND updated_at < NOW() - INTERVAL '90 days' ${teamFilter} RETURNING id`, args).catch(() => []);
  return { status: true, stuckFixed: stuck.length, oldArchived: archived.length };
}
