import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { client, db } from '@/lib/db/drizzle';
import { chats, evolutionInstances, messages, zernioConnections, zernioWebhookLogs } from '@/lib/db/schema';
import { pusherServer } from '@/lib/pusher-server';
import { sendAllSenderNewMessagePush } from '@/lib/mobile-push';
import { processAIMessage } from '@/lib/plugins/ai-chat/service';
import { resolveLinkedAutonomousAgent } from '@/lib/agents/autonomous-agent-resolver';
import { processUniversalBranchRouting } from '@/lib/modules/branches/universal-routing';
import { processZernioDepartmentRouting } from '@/lib/modules/departments/zernio-routing';
import { processAutomation } from '@/lib/automation/engine';
import { isZernioPlatform, zernioGet, zernioModuleKey, zernioPatch, zernioPost, zernioPut, type ZernioPlatform } from './client';
import { normalizeDisplayPhone, resolveZernioDisplayName } from './display';
import { normalizeInboundMessage, normalizedMessageTypeForDb } from '@/lib/channels/whatsapp/normalize-inbound-message';

export const ZERNIO_DOMAIN = 'zernio.allsender';

const PLATFORM_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  twitter: 'Twitter/X',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  threads: 'Threads',
  reddit: 'Reddit',
  pinterest: 'Pinterest',
  bluesky: 'Bluesky',
  googlebusiness: 'Google Business',
  telegram: 'Telegram',
  snapchat: 'Snapchat',
  discord: 'Discord',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
};


/**
 * Canales que Zernio puede tratar como inbox/DM.
 * Google Business, YouTube y Pinterest pueden tener comentarios/reviews/publicaciones,
 * pero no deben pasar por sync de mensajes directos porque rompe la escala.
 * El webhook sigue activo para comment.received/review.new.
 */
const ZERNIO_DIRECT_MESSAGE_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'whatsapp',
  'telegram',
  'reddit',
  'bluesky',
  'twitter',
  'x',
  'slack',
]);

const ZERNIO_COMMENT_REVIEW_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'youtube',
  'linkedin',
  'reddit',
  'bluesky',
  'threads',
  'twitter',
  'x',
  'googlebusiness',
]);

const ZERNIO_AUTOPUBLISH_PLATFORMS = new Set([
  'facebook',
  'instagram',
  'youtube',
  'linkedin',
  'tiktok',
  'pinterest',
  'threads',
  'googlebusiness',
]);


export const ZERNIO_WEBHOOK_EVENTS = [
  // Posts / autopublicación
  'post.scheduled',
  'post.published',
  'post.failed',
  'post.partial',
  'post.cancelled',
  'post.recycled',
  'post.platform.published',
  'post.platform.failed',

  // Accounts / conexiones
  'account.connected',
  'account.disconnected',
  'account.ads.initial_sync_completed',

  // Messages / chat real
  'message.received',
  'message.sent',
  'message.edited',
  'message.deleted',
  'message.delivered',
  'message.read',
  'message.failed',
  'reaction.received',

  // Conversations / llamadas
  'conversation.started',
  'call.received',
  'call.ended',
  'call.failed',
  'call.permission_request',

  // Comments / reviews
  'comment.received',
  'review.new',
  'review.updated',

  // Ads / leads / WhatsApp templates
  'ad.status_changed',
  'lead.received',
  'whatsapp.template.status_updated',
] as const;

// Eventos aceptados por /v1/webhooks/settings según OpenAPI Zernio.
// Zernio puede ENVIAR más eventos en el futuro, pero el registro del webhook
// rechaza algunos eventos si se mandan en settings. Por eso separamos:
// - ZERNIO_WEBHOOK_EVENTS: eventos que el handler entiende.
// - ZERNIO_WEBHOOK_SETTINGS_EVENTS: eventos seguros para registrar.
const ZERNIO_WEBHOOK_SETTINGS_EVENTS = [
  'post.scheduled',
  'post.published',
  'post.failed',
  'post.partial',
  'post.cancelled',
  'post.recycled',
  'post.platform.published',
  'post.platform.failed',
  'account.connected',
  'account.disconnected',
  'account.ads.initial_sync_completed',
  'message.received',
  'message.sent',
  'message.edited',
  'message.deleted',
  'message.delivered',
  'message.read',
  'message.failed',
  'reaction.received',
  'comment.received',
  'review.new',
  'review.updated',
  'ad.status_changed',
  'whatsapp.template.status_updated',
  'whatsapp.number.activated',
  'whatsapp.number.declined',
  'whatsapp.number.verification_required',
] as const;

const ZERNIO_WEBHOOK_MINIMUM_EVENTS = [
  'account.connected',
  'account.disconnected',
  'message.received',
  'message.sent',
  'message.delivered',
  'message.read',
  'message.failed',
  'comment.received',
  'review.new',
  'review.updated',
  'post.published',
  'post.failed',
  'ad.status_changed',
  'whatsapp.template.status_updated',
] as const;

export function zernioSupportsDirectMessages(platform?: string | null): boolean {
  return ZERNIO_DIRECT_MESSAGE_PLATFORMS.has(String(platform || '').toLowerCase().trim());
}

export function zernioSupportsCommentsOrReviews(platform?: string | null): boolean {
  return ZERNIO_COMMENT_REVIEW_PLATFORMS.has(String(platform || '').toLowerCase().trim());
}

export function zernioSupportsAutoPublishing(platform?: string | null): boolean {
  return ZERNIO_AUTOPUBLISH_PLATFORMS.has(String(platform || '').toLowerCase().trim());
}

function cleanId(value: unknown, fallback = 'id'): string {
  return String(value || fallback).trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 180) || fallback;
}

function base64url(value: string): string {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

function unbase64url(value: string): string {
  try { return Buffer.from(String(value || ''), 'base64url').toString('utf8'); } catch { return value; }
}

export function zernioRemoteJid(platform: string, conversationId: string): string {
  const safePlatform = cleanId(platform, 'zernio').toLowerCase();
  return `${safePlatform}_${base64url(String(conversationId || 'conversation'))}@${ZERNIO_DOMAIN}`;
}

export function zernioConversationFromRemoteJid(remoteJid: string): { platform: string; conversationId: string } | null {
  const jid = String(remoteJid || '').trim();
  if (!jid.endsWith(`@${ZERNIO_DOMAIN}`)) return null;
  const local = jid.replace(`@${ZERNIO_DOMAIN}`, '');
  const idx = local.indexOf('_');
  if (idx < 0) return { platform: 'zernio', conversationId: unbase64url(local) };
  return { platform: local.slice(0, idx), conversationId: unbase64url(local.slice(idx + 1)) };
}


let chatDeleteGuardsReady = false;

async function ensureChatDeleteGuardsTable() {
  if (chatDeleteGuardsReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS public.chat_delete_guards (
      id bigserial PRIMARY KEY,
      team_id integer NOT NULL,
      instance_id integer NOT NULL DEFAULT 0,
      remote_jid text NOT NULL,
      last_message_timestamp timestamptz,
      deleted_at timestamptz NOT NULL DEFAULT now(),
      block_until timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
      reason text NOT NULL DEFAULT 'manual_delete',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS chat_delete_guards_team_instance_jid_uidx
    ON public.chat_delete_guards (team_id, instance_id, remote_jid)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS chat_delete_guards_lookup_idx
    ON public.chat_delete_guards (team_id, remote_jid, deleted_at DESC)
  `);
  chatDeleteGuardsReady = true;
}

async function isDeletedChatReplayBlocked(input: { teamId: number; instanceId: number; remoteJid: string; timestamp: Date | string | null }) {
  try {
    await ensureChatDeleteGuardsTable();
    const timestampIso = toIsoDateString(input.timestamp);
    const sqlClient = client as any;
    const rows: any = await sqlClient.unsafe(
      `SELECT deleted_at, block_until, last_message_timestamp
         FROM public.chat_delete_guards
        WHERE team_id = $1
          AND remote_jid = $2
          AND instance_id = $3
          AND (
            $4::timestamptz <= COALESCE(last_message_timestamp, deleted_at, now())
            OR $4::timestamptz <= deleted_at
          )
        ORDER BY deleted_at DESC
        LIMIT 1`,
      [input.teamId, input.remoteJid, input.instanceId || 0, timestampIso]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (error: any) {
    console.warn('[chat-delete:guard-check]', error?.message || error);
    return false;
  }
}

export function isZernioInstance(instance: any, platform?: string): boolean {
  const integration = String(instance?.integration || '').toUpperCase();
  if (!integration.startsWith('ZERNIO-')) return false;
  return platform ? integration === `ZERNIO-${platform.toUpperCase()}` : true;
}

function cleanPublicUrl(value?: string | null): string {
  const raw = String(value || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(raw)) return '';
  return raw;
}

export function zernioPublicBaseUrl(origin?: string | null): string {
  const candidates = [
    process.env.ZERNIO_PUBLIC_APP_URL,
    process.env.ZERNIO_CALLBACK_BASE_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.AUTH_BASE_URL,
    process.env.BASE_URL,
    origin,
  ];

  for (const candidate of candidates) {
    const clean = cleanPublicUrl(candidate);
    if (clean) return clean;
  }

  return 'https://auth.allsender.tech';
}

export function zernioWebhookUrl(origin?: string): string {
  const explicit = cleanPublicUrl(process.env.NEXT_PUBLIC_ZERNIO_WEBHOOK_URL || process.env.ZERNIO_WEBHOOK_URL);
  if (explicit) return explicit;
  return `${zernioPublicBaseUrl(origin)}/webhook/zernio`;
}

function safeTimingCompare(a: string, b: string, encoding: BufferEncoding = 'utf8') {
  try {
    const left = Buffer.from(a, encoding);
    const right = Buffer.from(b, encoding);
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function verifyZernioWebhook(rawBody: string, headers: Headers): boolean {
  const secret = String(process.env.ZERNIO_WEBHOOK_SECRET || '').trim();
  if (!secret) return true;

  const signatureHeader = headers.get('x-zernio-signature')
    || headers.get('x-signature')
    || headers.get('x-hub-signature-256')
    || '';

  if (!signatureHeader) {
    // Zernio test deliveries can arrive without the signature while configuring the webhook.
    // Default is permissive so the integration does not silently drop messages; set
    // ZERNIO_WEBHOOK_SIGNATURE_MODE=strict after confirming signatures in logs.
    const strict = String(process.env.ZERNIO_WEBHOOK_SIGNATURE_MODE || '').toLowerCase() === 'strict';
    console.warn('[zernio:webhook:signature] missing signature header');
    return !strict;
  }

  const clean = signatureHeader.replace(/^sha256=/i, '').trim();
  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBase64 = createHmac('sha256', secret).update(rawBody).digest('base64');

  const ok = safeTimingCompare(clean, expectedHex)
    || safeTimingCompare(clean, expectedBase64)
    || safeTimingCompare(clean, expectedHex, 'hex');

  if (!ok) {
    const strict = String(process.env.ZERNIO_WEBHOOK_SIGNATURE_MODE || '').toLowerCase() === 'strict';
    console.warn('[zernio:webhook:signature] invalid signature; accepting in non-strict mode');
    return !strict;
  }

  return true;
}

function publicCallbackUrl(_platform: string): string {
  // IMPORTANTE: Zernio documenta que en modo standard agrega
  // ?connected={platform}&profileId=X&accountId=Y&username=Z al redirect_url.
  // Si nosotros enviamos redirect_url con query (?platform=...), algunos providers
  // terminan creando una URL rota tipo /callback?platform=instagram?connected=...
  // Por eso el callback debe ir LIMPIO, sin query params.
  const explicitCallback = cleanPublicUrl(process.env.ZERNIO_CALLBACK_URL);
  const url = explicitCallback
    ? new URL(explicitCallback)
    : new URL('/api/zernio/callback', zernioPublicBaseUrl());

  url.search = '';
  url.hash = '';
  return url.toString();
}

function firstValue(...values: any[]): string {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function toIsoDateString(value: unknown, fallback = new Date()): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return fallback.toISOString();
}

function zernioArrayResponse(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.accounts)) return response.accounts;
  if (Array.isArray(response?.data?.accounts)) return response.data.accounts;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function zernioProfileArrayResponse(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.profiles)) return response.profiles;
  if (Array.isArray(response?.data?.profiles)) return response.data.profiles;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function profileIdValue(profile: any): string {
  return firstValue(profile?._id, profile?.id, profile?.profileId, profile?.profile_id);
}

function profileNameValue(profile: any): string {
  return firstValue(profile?.name, profile?.profileName, profile?.displayName, profile?.title);
}

function zernioConnectionSelectSql(): string {
  return `
    id,
    team_id AS "teamId",
    user_id AS "userId",
    local_instance_id AS "localInstanceId",
    provider,
    platform,
    module_key AS "moduleKey",
    zernio_profile_id AS "zernioProfileId",
    zernio_account_id AS "zernioAccountId",
    account_username AS "accountUsername",
    account_display_name AS "accountDisplayName",
    account_picture AS "accountPicture",
    status,
    last_error AS "lastError",
    metadata,
    created_at AS "createdAt",
    updated_at AS "updatedAt"
  `;
}

async function findZernioConnectionByTeamPlatformAccount(input: { teamId: number; platform: string; accountId: string; excludeId?: number | null }) {
  const teamId = Number(input.teamId || 0);
  const platform = String(input.platform || '').toLowerCase().trim();
  const accountId = String(input.accountId || '').trim();
  if (!teamId || !platform || !accountId) return null;

  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `SELECT ${zernioConnectionSelectSql()}
       FROM public.zernio_connections
      WHERE team_id = $1
        AND LOWER(platform) = $2
        AND zernio_account_id = $3
        AND ($4::int IS NULL OR id <> $4::int)
      ORDER BY CASE WHEN LOWER(status) = 'connected' THEN 0 ELSE 1 END,
               updated_at DESC NULLS LAST,
               id DESC
      LIMIT 1`,
    [teamId, platform, accountId, input.excludeId ? Number(input.excludeId) : null]
  ).catch((error: any) => {
    console.warn('[zernio:connection:find-account-conflict]', error?.message || error);
    return [];
  });
  return rows?.[0] || null;
}

async function findZernioConnectionByTeamLocalInstance(input: { teamId: number; localInstanceId: number; excludeId?: number | null }) {
  const teamId = Number(input.teamId || 0);
  const localInstanceId = Number(input.localInstanceId || 0);
  if (!teamId || !localInstanceId) return null;

  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `SELECT ${zernioConnectionSelectSql()}
       FROM public.zernio_connections
      WHERE team_id = $1
        AND local_instance_id = $2
        AND ($3::int IS NULL OR id <> $3::int)
      ORDER BY CASE WHEN LOWER(status) = 'connected' THEN 0 ELSE 1 END,
               updated_at DESC NULLS LAST,
               id DESC
      LIMIT 1`,
    [teamId, localInstanceId, input.excludeId ? Number(input.excludeId) : null]
  ).catch((error: any) => {
    console.warn('[zernio:connection:find-local-conflict]', error?.message || error);
    return [];
  });
  return rows?.[0] || null;
}

async function neutralizeDuplicateZernioConnection(duplicate: any, canonical: any, reason: string) {
  const duplicateId = Number(duplicate?.id || 0);
  const canonicalId = Number(canonical?.id || 0);
  if (!duplicateId || !canonicalId || duplicateId === canonicalId) return null;

  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `UPDATE public.zernio_connections
        SET status = 'duplicate',
            zernio_account_id = NULL,
            local_instance_id = NULL,
            last_error = $3,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
              'duplicateOfConnectionId', $2::int,
              'duplicateReason', $3::text,
              'duplicatedAt', NOW()
            ),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${zernioConnectionSelectSql()}`,
    [duplicateId, canonicalId, reason]
  ).catch((error: any) => {
    console.warn('[zernio:connection:neutralize-duplicate]', error?.message || error);
    return [];
  });
  return rows?.[0] || null;
}

async function promoteZernioConnection(canonical: any, input: { profileId?: string | null; accountId?: string | null; username?: string | null; displayName?: string | null; picture?: string | null; userId?: number | null; source: string }) {
  const canonicalId = Number(canonical?.id || 0);
  if (!canonicalId) return canonical;

  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `UPDATE public.zernio_connections
        SET user_id = COALESCE($2::int, user_id),
            zernio_profile_id = COALESCE(NULLIF($3::text, ''), zernio_profile_id),
            zernio_account_id = COALESCE(NULLIF($4::text, ''), zernio_account_id),
            account_username = COALESCE(NULLIF($5::text, ''), account_username),
            account_display_name = COALESCE(NULLIF($6::text, ''), account_display_name, NULLIF($5::text, '')),
            account_picture = COALESCE(NULLIF($7::text, ''), account_picture),
            status = CASE WHEN NULLIF($4::text, '') IS NOT NULL THEN 'connected' ELSE status END,
            last_error = NULL,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('lastPromotedSource', $8::text, 'lastPromotedAt', NOW()),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${zernioConnectionSelectSql()}`,
    [
      canonicalId,
      input.userId ? Number(input.userId) : null,
      input.profileId || null,
      input.accountId || null,
      input.username || null,
      input.displayName || null,
      input.picture || null,
      input.source,
    ]
  ).catch((error: any) => {
    console.warn('[zernio:connection:promote]', error?.message || error);
    return [];
  });
  return rows?.[0] || canonical;
}

async function resolveZernioAccountConflict(connection: any, input: { accountId?: string | null; profileId?: string | null; username?: string | null; displayName?: string | null; picture?: string | null; source: string }) {
  const teamId = Number(connection?.teamId || connection?.team_id || 0);
  const platform = String(connection?.platform || '').toLowerCase().trim();
  const accountId = String(input.accountId || connection?.zernioAccountId || '').trim();
  const currentId = Number(connection?.id || 0);
  if (!teamId || !platform || !accountId || !currentId) return null;

  const conflict = await findZernioConnectionByTeamPlatformAccount({ teamId, platform, accountId, excludeId: currentId });
  if (!conflict) return null;

  const canonical = await promoteZernioConnection(conflict, {
    profileId: input.profileId || connection?.zernioProfileId,
    accountId,
    username: input.username || connection?.accountUsername,
    displayName: input.displayName || connection?.accountDisplayName,
    picture: input.picture || connection?.accountPicture,
    userId: connection?.userId,
    source: input.source,
  });
  await neutralizeDuplicateZernioConnection(connection, canonical, `${input.source}: duplicate account ${platform}/${accountId}`);
  return canonical;
}

function accountProfileId(account: any): string {
  const profileId = account?.profileId;
  if (profileId && typeof profileId === 'object') {
    return firstValue(profileId?._id, profileId?.id, profileId?.profileId);
  }
  return firstValue(
    profileId,
    account?.profile_id,
    account?.profile?._id,
    account?.profile?.id,
    account?.profile?.profileId
  );
}

function accountIdValue(account: any): string {
  return firstValue(account?.accountId, account?.account_id, account?._id, account?.id);
}

function accountUsernameValue(account: any): string {
  return firstValue(account?.username, account?.handle, account?.accountUsername, account?.name);
}

function accountDisplayNameValue(account: any): string {
  return firstValue(account?.displayName, account?.display_name, account?.name, account?.username);
}

function accountPictureValue(account: any): string {
  return firstValue(account?.profilePicture, account?.profile_picture, account?.picture, account?.avatar, account?.avatarUrl);
}

async function getLatestZernioAccount(profileId: string, platform?: string | null) {
  const cleanProfile = String(profileId || '').trim();
  const cleanPlatform = String(platform || '').toLowerCase().trim();
  if (!cleanProfile) return null;

  const params = new URLSearchParams({
    profileId: cleanProfile,
    includeOverLimit: 'true',
    page: '1',
    limit: '20',
  });
  if (cleanPlatform) params.set('platform', cleanPlatform);

  try {
    const response: any = await zernioGet(`/v1/accounts?${params.toString()}`);
    const accounts = zernioArrayResponse(response).filter((account) => {
      const profileFromAccount = accountProfileId(account);
      // Algunos responses no incluyen profileId en cada account. Si viene vacío, no descartamos.
      const sameProfile = !cleanProfile || !profileFromAccount || profileFromAccount === cleanProfile;
      const samePlatform = !cleanPlatform || String(account?.platform || '').toLowerCase() === cleanPlatform;
      return sameProfile && samePlatform;
    });

    return accounts[0] || null;
  } catch (error: any) {
    console.warn('[zernio:accounts:sync]', error?.message || error);
    return null;
  }
}


async function ensureZernioLocalInstanceForConnection(connection: any, input?: { accountId?: string | null; senderName?: string | null; profileId?: string | null }) {
  const teamId = Number(connection?.teamId || 0);
  const platform = String(connection?.platform || '').toLowerCase().trim();
  if (!teamId || !platform) return connection;

  const accountId = firstValue(input?.accountId, connection?.zernioAccountId);
  const profileId = firstValue(input?.profileId, connection?.zernioProfileId);

  // V3/V4 NO-FANTASMAS:
  // No se crea evolution_instances para conexiones Zernio pendientes.
  // evolution_instances es solo puente interno para inbox cuando Zernio ya devolvio accountId real.
  if (!accountId) {
    return {
      ...connection,
      zernioProfileId: profileId || connection?.zernioProfileId || null,
      status: connection?.status || 'pending',
    };
  }

  const sqlClient = client as any;
  const integration = `ZERNIO-${platform.toUpperCase()}`;
  const externalId = `zernio_${platform}_${accountId}`.replace(/[^a-zA-Z0-9_.:-]/g, '_');
  const instanceName = String(connection?.localInstance?.instanceName || `${PLATFORM_LABELS[platform] || platform} Zernio`).slice(0, 120);
  const instanceNumber = firstValue(input?.senderName, connection?.accountUsername, connection?.accountDisplayName, accountId, `${platform}@zernio`);

  const accountConflict = await resolveZernioAccountConflict(connection, {
    accountId,
    profileId,
    username: input?.senderName || connection?.accountUsername,
    displayName: input?.senderName || connection?.accountDisplayName,
    picture: connection?.accountPicture,
    source: 'local_instance_ensure',
  });
  if (accountConflict) {
    connection = accountConflict;
  }

  // V4.2: si la conexión ya tiene localInstanceId, cargar la instancia aunque la relación no venga hidratada.
  // Antes el código veía localInstanceId sin localInstance y terminaba con instanceId=0 en inbound.
  if (connection?.localInstanceId) {
    try {
      const existingById = await sqlClient.unsafe(
        `SELECT * FROM evolution_instances WHERE id = $1 AND team_id = $2 LIMIT 1`,
        [Number(connection.localInstanceId), teamId]
      );
      const localInstance = Array.isArray(existingById) ? existingById[0] : existingById?.[0];
      if (localInstance?.id) {
        return { ...connection, localInstanceId: Number(localInstance.id), localInstance };
      }
    } catch (error: any) {
      console.warn('[zernio:local-instance:load-existing]', error?.message || error);
    }
  }

  let localInstance: any = null;

  try {
    // V4.2: reutilizar puente existente antes de insertar.
    // Esto evita duplicate key en team_instance_name_idx cuando ya existe "Instagram Zernio" para ese team.
    const existingRows = await sqlClient.unsafe(
      `SELECT *
         FROM evolution_instances
        WHERE team_id = $1
          AND (
            evolution_instance_id = $2
            OR (integration = $3 AND meta_phone_number_id = $4)
            OR (integration = $3 AND instance_name = $5)
            OR instance_name = $5
          )
        ORDER BY
          CASE
            WHEN evolution_instance_id = $2 THEN 0
            WHEN integration = $3 AND meta_phone_number_id = $4 THEN 1
            WHEN integration = $3 AND instance_name = $5 THEN 2
            ELSE 3
          END,
          updated_at DESC,
          id DESC
        LIMIT 1`,
      [teamId, externalId, integration, accountId, instanceName]
    );
    localInstance = Array.isArray(existingRows) ? existingRows[0] : existingRows?.[0];

    if (localInstance?.id) {
      try {
        const updatedRows = await sqlClient.unsafe(
          `UPDATE evolution_instances
              SET instance_name = $2,
                  instance_number = $3,
                  evolution_instance_id = $4,
                  integration = $5,
                  meta_business_id = $6,
                  meta_phone_number_id = $7,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [Number(localInstance.id), instanceName, instanceNumber, externalId, integration, profileId || null, accountId || null]
        );
        localInstance = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows?.[0];
      } catch (error: any) {
        // Si otro registro ya tiene evolution_instance_id, no fallamos el inbox: dejamos el id anterior y actualizamos el resto.
        console.warn('[zernio:local-instance:reuse-update]', error?.message || error);
        const updatedRows = await sqlClient.unsafe(
          `UPDATE evolution_instances
              SET instance_name = $2,
                  instance_number = $3,
                  integration = $4,
                  meta_business_id = $5,
                  meta_phone_number_id = $6,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING *`,
          [Number(localInstance.id), instanceName, instanceNumber, integration, profileId || null, accountId || null]
        );
        localInstance = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows?.[0];
      }
    }

    if (!localInstance?.id) {
      try {
        const rows = await sqlClient.unsafe(
          `INSERT INTO evolution_instances
            (team_id, instance_name, instance_number, evolution_instance_id, integration, meta_business_id, meta_phone_number_id, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
           ON CONFLICT (evolution_instance_id) DO UPDATE SET
             team_id = EXCLUDED.team_id,
             instance_name = EXCLUDED.instance_name,
             instance_number = EXCLUDED.instance_number,
             integration = EXCLUDED.integration,
             meta_business_id = EXCLUDED.meta_business_id,
             meta_phone_number_id = EXCLUDED.meta_phone_number_id,
             updated_at = NOW()
           RETURNING *`,
          [teamId, instanceName, instanceNumber, externalId, integration, profileId || null, accountId || null]
        );
        localInstance = Array.isArray(rows) ? rows[0] : rows?.[0];
      } catch (error: any) {
        // V4.2: si el insert choca por team_instance_name_idx, recuperamos el puente existente y seguimos.
        console.warn('[zernio:local-instance:insert-reuse-by-name]', error?.message || error);
        const fallbackRows = await sqlClient.unsafe(
          `SELECT *
             FROM evolution_instances
            WHERE team_id = $1
              AND instance_name = $2
            ORDER BY updated_at DESC, id DESC
            LIMIT 1`,
          [teamId, instanceName]
        );
        localInstance = Array.isArray(fallbackRows) ? fallbackRows[0] : fallbackRows?.[0];
        if (localInstance?.id) {
          const updatedRows = await sqlClient.unsafe(
            `UPDATE evolution_instances
                SET instance_number = $2,
                    integration = $3,
                    meta_business_id = $4,
                    meta_phone_number_id = $5,
                    updated_at = NOW()
              WHERE id = $1
              RETURNING *`,
            [Number(localInstance.id), instanceNumber, integration, profileId || null, accountId || null]
          );
          localInstance = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows?.[0];
        }
      }
    }

    if (!localInstance?.id) return connection;

    const localConflict = await findZernioConnectionByTeamLocalInstance({
      teamId,
      localInstanceId: Number(localInstance.id),
      excludeId: Number(connection.id || 0),
    });
    if (localConflict) {
      const canonical = await promoteZernioConnection(localConflict, {
        profileId: profileId || connection.zernioProfileId,
        accountId: accountId || connection.zernioAccountId,
        username: input?.senderName || connection.accountUsername,
        displayName: input?.senderName || connection.accountDisplayName,
        picture: connection.accountPicture,
        userId: connection.userId,
        source: 'local_instance_conflict',
      });
      await neutralizeDuplicateZernioConnection(connection, canonical, `local_instance_conflict: instance ${localInstance.id}`);
      return { ...canonical, localInstanceId: Number(localInstance.id), localInstance };
    }

    const [updated] = await db.update(zernioConnections).set({
      localInstanceId: Number(localInstance.id),
      zernioAccountId: accountId || connection.zernioAccountId || null,
      zernioProfileId: profileId || connection.zernioProfileId || null,
      status: 'connected',
      updatedAt: new Date(),
    }).where(eq(zernioConnections.id, connection.id)).returning().catch(async (error) => {
      console.warn('[zernio:local-instance:update-connection]', error?.message || error);
      const conflict = await resolveZernioAccountConflict(connection, {
        accountId,
        profileId,
        username: input?.senderName || connection?.accountUsername,
        displayName: input?.senderName || connection?.accountDisplayName,
        picture: connection?.accountPicture,
        source: 'local_instance_update_conflict',
      });
      return conflict ? [conflict] : [];
    });

    return {
      ...(updated || connection),
      localInstanceId: Number(localInstance.id),
      localInstance,
      zernioAccountId: accountId || connection.zernioAccountId || null,
      zernioProfileId: profileId || connection.zernioProfileId || null,
      status: 'connected',
    };
  } catch (error: any) {
    console.warn('[zernio:local-instance:ensure]', error?.message || error);
    return connection;
  }
}

function isZernioCommentOrReviewEvent(event?: string | null): boolean {
  return /^(comment\.|review\.)/i.test(String(event || ''));
}

function commentIdFromPayload(normalized: any): string {
  const raw = normalized.raw || {};
  const root = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  const comment = root?.comment && typeof root.comment === 'object' ? root.comment : {};
  const review = root?.review && typeof root.review === 'object' ? root.review : {};
  return cleanId(firstValue(
    comment?._id,
    comment?.id,
    comment?.commentId,
    review?._id,
    review?.id,
    review?.reviewId,
    root?.commentId,
    root?.reviewId,
    root?._id,
    root?.id,
    `${normalized.platform || 'zernio'}_${Date.now()}`
  ));
}

function commentTextFromPayload(normalized: any): string {
  const raw = normalized.raw || {};
  const root = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  const comment = root?.comment && typeof root.comment === 'object' ? root.comment : {};
  const review = root?.review && typeof root.review === 'object' ? root.review : {};
  return firstValue(
    comment?.text,
    comment?.message,
    comment?.body,
    review?.text,
    review?.comment,
    review?.review,
    root?.commentText,
    root?.reviewText,
    root?.text,
    root?.message,
    normalized.text
  );
}

function commentAuthorFromPayload(normalized: any): string {
  const raw = normalized.raw || {};
  const root = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  const author = root?.author || root?.user || root?.from || root?.comment?.author || root?.review?.author || {};
  return firstValue(author?.username, author?.name, author?.displayName, normalized.senderName, normalized.senderId);
}

function commentAuthorIdFromPayload(normalized: any): string {
  const raw = normalized.raw || {};
  const root = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  const author = root?.author || root?.user || root?.from || root?.comment?.author || root?.review?.author || {};
  return firstValue(author?.id, author?.userId, author?.externalId, author?.profileId);
}

function commentIsReplyFromPayload(normalized: any): boolean {
  const raw = normalized.raw || {};
  const root = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  return root?.comment?.isReply === true || root?.isReply === true || root?.reply === true;
}

function postIdFromPayload(normalized: any): string {
  const raw = normalized.raw || {};
  const root = raw?.data && typeof raw.data === 'object' ? { ...raw, ...raw.data } : raw;
  const post = root?.post || root?.media || root?.parent || {};
  const comment = root?.comment && typeof root.comment === 'object' ? root.comment : {};
  return firstValue(
    post?._id,
    post?.id,
    post?.postId,
    post?.platformPostId,
    comment?.postId,
    comment?.platformPostId,
    root?.postId,
    root?.platformPostId,
    root?.mediaId,
    root?.parentId
  );
}

function pageIdFromPlatformPostId(value: unknown): string {
  const text = String(value || '').trim();
  return text.includes('_') ? String(text.split('_')[0] || '').trim() : '';
}

const tableExistsCache = new Map<string, Promise<boolean>>();

async function tableExists(tableName: string): Promise<boolean> {
  const safeTableName = String(tableName || '').trim();
  if (!safeTableName) return false;
  if (tableExistsCache.has(safeTableName)) {
    return tableExistsCache.get(safeTableName)!;
  }

  const promise = (async () => {
    try {
      const sqlClient = client as any;
      const rows = await sqlClient`SELECT to_regclass(${safeTableName}) AS regclass`;
      return Boolean(rows?.[0]?.regclass);
    } catch {
      return false;
    }
  })();

  tableExistsCache.set(safeTableName, promise);
  return promise;
}

export function invalidateTableExistsCache(tableName?: string) {
  if (tableName) {
    tableExistsCache.delete(String(tableName).trim());
  } else {
    tableExistsCache.clear();
  }
}

async function saveZernioCommentOrReviewEvent(connection: any, normalized: any) {
  const teamId = Number(connection?.teamId || 0);
  const platform = String(normalized.platform || connection?.platform || '').toLowerCase().trim();
  if (!teamId) return { ok: false, reason: 'missing_team' };
  if (!(await tableExists('marketing_ai_comment_logs'))) {
    return { ok: true, ignored: true, reason: 'marketing_ai_comment_logs_missing' };
  }

  const externalCommentId = commentIdFromPayload(normalized);
  const commentText = commentTextFromPayload(normalized) || '[sin texto]';
  const externalPostId = postIdFromPayload(normalized) || null;
  const authorUsername = commentAuthorFromPayload(normalized) || null;
  const authorId = commentAuthorIdFromPayload(normalized);
  const pageId = pageIdFromPlatformPostId(externalPostId);
  const sqlClient = client as any;

  if (externalCommentId) {
    const duplicate = await sqlClient.unsafe(
      `SELECT id
         FROM marketing_ai_comment_logs
        WHERE team_id = $1
          AND platform = $2
          AND account_id IS NOT DISTINCT FROM $3
          AND external_comment_id = $4
        LIMIT 1`,
      [teamId, platform, normalized.accountId || connection?.zernioAccountId || null, externalCommentId]
    ).catch(() => []);
    if (duplicate.length) return { ok: true, ignored: true, reason: 'duplicate_comment', platform, teamId, externalCommentId };
  }

  if (pageId && authorId && pageId === authorId) {
    return { ok: true, ignored: true, reason: 'self_reply_loop_guard', platform, teamId, externalCommentId };
  }

  if (commentIsReplyFromPayload(normalized) && pageId && authorId && pageId === authorId) {
    return { ok: true, ignored: true, reason: 'self_reply_loop_guard', platform, teamId, externalCommentId };
  }

  await sqlClient.unsafe(
    `INSERT INTO marketing_ai_comment_logs
      (team_id, platform, provider, account_id, external_comment_id, external_post_id, author_username, comment_text, action, status, metadata, created_at, updated_at)
     VALUES ($1, $2, 'zernio', $3, $4, $5, $6, $7, 'pending', 'pending', $8::jsonb, NOW(), NOW())
     ON CONFLICT DO NOTHING`,
    [
      teamId,
      platform,
      normalized.accountId || connection?.zernioAccountId || null,
      externalCommentId,
      externalPostId,
      authorUsername,
      commentText,
      JSON.stringify({ event: normalized.event, profileId: normalized.profileId, payload: normalized.raw }),
    ]
  );

  return { ok: true, comment: true, platform, teamId, externalCommentId };
}


function isZernioPostOrMarketingEvent(event?: string | null): boolean {
  return /^(post\.|ad\.|lead\.|whatsapp\.template\.|call\.|conversation\.|reaction\.)/i.test(String(event || ''))
    || /^account\.ads\./i.test(String(event || ''));
}

function eventStatusFromType(event?: string | null): string {
  const e = String(event || '').toLowerCase();
  if (e.includes('failed')) return 'failed';
  if (e.includes('cancelled')) return 'cancelled';
  if (e.includes('published')) return 'published';
  if (e.includes('scheduled')) return 'scheduled';
  if (e.includes('partial')) return 'partial';
  if (e.includes('deleted')) return 'deleted';
  if (e.includes('read')) return 'read';
  if (e.includes('delivered')) return 'delivered';
  if (e.includes('sent')) return 'sent';
  return 'received';
}

async function saveZernioMarketingEvent(connection: any, normalized: any) {
  const teamId = Number(connection?.teamId || 0);
  const platform = String(normalized.platform || connection?.platform || 'zernio').toLowerCase().trim();
  if (!teamId) return { ok: false, reason: 'missing_team' };

  const payloadJson = JSON.stringify({
    event: normalized.event,
    accountId: normalized.accountId || connection?.zernioAccountId || null,
    profileId: normalized.profileId || connection?.zernioProfileId || null,
    platform,
    payload: normalized.raw,
  });

  const sqlClient = client as any;
  let saved = false;

  if (await tableExists('marketing_ai_event_logs')) {
    await sqlClient.unsafe(
      `INSERT INTO marketing_ai_event_logs
        (team_id, platform, provider, account_id, event_type, status, metadata, created_at, updated_at)
       VALUES ($1, $2, 'zernio', $3, $4, $5, $6::jsonb, NOW(), NOW())`,
      [teamId, platform, normalized.accountId || connection?.zernioAccountId || null, normalized.event || 'zernio.event', eventStatusFromType(normalized.event), payloadJson]
    );
    saved = true;
  }

  if (String(normalized.event || '').startsWith('post.') && await tableExists('marketing_ai_post_logs')) {
    await sqlClient.unsafe(
      `INSERT INTO marketing_ai_post_logs
        (team_id, post_id, platform, provider, event_type, status, message, metadata, created_at, updated_at)
       VALUES ($1, NULL, $2, 'zernio', $3, $4, NULL, $5::jsonb, NOW(), NOW())`,
      [teamId, platform, normalized.event || 'post.event', eventStatusFromType(normalized.event), payloadJson]
    );
    saved = true;
  }

  return { ok: true, marketingEvent: true, saved, event: normalized.event, platform, teamId };
}

function zernioLocalMessagePatterns(platform: string, messageId: string, conversationId?: string | null) {
  const cleanPlatform = cleanId(platform || 'zernio');
  const cleanMessageId = cleanId(messageId || 'message');
  const conversationPart = conversationId ? base64url(conversationId).slice(0, 24) : '';
  return {
    incomingExact: conversationPart ? `zrn_in_${cleanPlatform}_${cleanMessageId}_${conversationPart}` : '',
    incomingLike: `zrn_in_${cleanPlatform}_${cleanMessageId}_%`,
    outgoingLike: `zrn_out_${cleanPlatform}_${cleanMessageId}_%`,
    aiLike: `zrn_ai_${cleanPlatform}_${cleanMessageId}_%`,
  };
}

async function refreshChatAfterMessageDelete(chatId: number, teamId: number) {
  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `SELECT id, text, timestamp, from_me, status
       FROM messages
      WHERE chat_id = $1
      ORDER BY timestamp DESC
      LIMIT 1`,
    [chatId]
  );
  const latest = Array.isArray(rows) ? rows[0] : null;
  if (!latest) {
    const deleted = await sqlClient.unsafe(
      `DELETE FROM chats WHERE id = $1 AND team_id = $2 RETURNING remote_jid`,
      [chatId, teamId]
    );
    const remoteJid = Array.isArray(deleted) ? deleted[0]?.remote_jid : null;
    if (remoteJid) {
      try { await pusherServer.trigger(`team-${teamId}`, 'chat-deleted', { chatIds: [chatId], remoteJids: [remoteJid] }); } catch {}
    }
    return;
  }

  await sqlClient.unsafe(
    `UPDATE chats
        SET last_message_text = $1,
            last_message_timestamp = $2,
            last_message_from_me = $3,
            last_message_status = $4
      WHERE id = $5 AND team_id = $6`,
    [latest.text || '[Mensaje]', latest.timestamp, latest.from_me, latest.status || null, chatId, teamId]
  );
}

async function deleteZernioMessageEvent(connection: any, normalized: any) {
  const teamId = Number(connection?.teamId || 0);
  const instanceId = Number(connection?.localInstanceId || connection?.localInstance?.id || 0);
  const platform = String(normalized.platform || connection?.platform || '').toLowerCase().trim();
  if (!teamId || !platform || !normalized.messageId) return { ok: true, ignored: true, reason: 'missing_delete_identifiers' };

  const remoteJid = normalized.conversationId ? zernioRemoteJid(platform, normalized.conversationId) : null;
  const patterns = zernioLocalMessagePatterns(platform, normalized.messageId, normalized.conversationId);
  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `WITH target AS (
       SELECT m.id, m.chat_id
         FROM messages m
         JOIN chats c ON c.id = m.chat_id
        WHERE c.team_id = $1
          AND ($2::integer = 0 OR c.instance_id = $2::integer)
          AND ($3::text IS NULL OR c.remote_jid = $3::text)
          AND (
            ($4::text <> '' AND m.id = $4::text)
            OR m.id LIKE $5::text
            OR m.id LIKE $6::text
            OR m.id LIKE $7::text
          )
     ), deleted AS (
       DELETE FROM messages
        WHERE id IN (SELECT id FROM target)
        RETURNING chat_id
     )
     SELECT DISTINCT chat_id FROM deleted`,
    [teamId, instanceId, remoteJid, patterns.incomingExact, patterns.incomingLike, patterns.outgoingLike, patterns.aiLike]
  );
  const chatIds = (Array.isArray(rows) ? rows : []).map((r: any) => Number(r.chat_id)).filter(Boolean);

  for (const chatId of chatIds) await refreshChatAfterMessageDelete(chatId, teamId);

  if (chatIds.length) {
    try { await pusherServer.trigger(`team-${teamId}`, 'message-deleted', { chatIds, providerMessageId: normalized.messageId, conversationId: normalized.conversationId || null }); } catch {}
  }

  return { ok: true, deleted: chatIds.length > 0, chatIds };
}

async function updateZernioMessageLifecycle(connection: any, normalized: any) {
  const teamId = Number(connection?.teamId || 0);
  const instanceId = Number(connection?.localInstanceId || connection?.localInstance?.id || 0);
  const platform = String(normalized.platform || connection?.platform || '').toLowerCase().trim();
  if (!teamId || !platform || !normalized.messageId) return { ok: true, ignored: true, reason: 'missing_lifecycle_identifiers' };

  const status = eventStatusFromType(normalized.event);
  const remoteJid = normalized.conversationId ? zernioRemoteJid(platform, normalized.conversationId) : null;
  const patterns = zernioLocalMessagePatterns(platform, normalized.messageId, normalized.conversationId);
  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `UPDATE messages m
        SET status = $1
       FROM chats c
      WHERE c.id = m.chat_id
        AND c.team_id = $2
        AND ($3::integer = 0 OR c.instance_id = $3::integer)
        AND ($4::text IS NULL OR c.remote_jid = $4::text)
        AND (
          ($5::text <> '' AND m.id = $5::text)
          OR m.id LIKE $6::text
          OR m.id LIKE $7::text
          OR m.id LIKE $8::text
        )
      RETURNING m.id, m.chat_id`,
    [status, teamId, instanceId, remoteJid, patterns.incomingExact, patterns.incomingLike, patterns.outgoingLike, patterns.aiLike]
  );

  return { ok: true, lifecycle: true, status, updated: Array.isArray(rows) ? rows.length : 0 };
}


async function hardDeleteZernioConnectionRows(input: { accountId?: string | null; profileId?: string | null; platform?: string | null; teamId?: number | null }) {
  const accountId = String(input.accountId || '').trim();
  const profileId = String(input.profileId || '').trim();
  const platform = String(input.platform || '').toLowerCase().trim();
  const teamId = Number(input.teamId || 0);
  if (!accountId && !profileId) return { deleted: 0, localInstanceIds: [] as number[] };

  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `WITH target AS (
       SELECT id, local_instance_id
       FROM zernio_connections
       WHERE ($1::integer = 0 OR team_id = $1::integer)
         AND ($2::text = '' OR LOWER(platform) = $2::text)
         AND (
           ($3::text <> '' AND zernio_account_id = $3::text)
           OR ($4::text <> '' AND zernio_profile_id = $4::text AND ($2::text = '' OR LOWER(platform) = $2::text))
         )
     ), deleted AS (
       DELETE FROM zernio_connections
       WHERE id IN (SELECT id FROM target)
       RETURNING id, local_instance_id
     )
     SELECT id, local_instance_id FROM deleted`,
    [teamId || 0, platform, accountId, profileId]
  );

  const deleted = Array.isArray(rows) ? rows : [];
  const localInstanceIds = deleted.map((row: any) => Number(row.local_instance_id || 0)).filter(Boolean);
  if (localInstanceIds.length) {
    await sqlClient.unsafe(
      `DELETE FROM evolution_instances ei
       WHERE ei.id = ANY($1::int[])
         AND ei.integration ILIKE 'ZERNIO-%'
         AND NOT EXISTS (SELECT 1 FROM zernio_connections z WHERE z.local_instance_id = ei.id)
         AND NOT EXISTS (SELECT 1 FROM chats c WHERE c.instance_id = ei.id)`,
      [localInstanceIds]
    ).catch((error: any) => console.warn('[zernio:connection:delete-instance]', error?.message || error));
  }

  return { deleted: deleted.length, localInstanceIds };
}

async function deleteDuplicateZernioConnectionRows(connection: any) {
  const teamId = Number(connection?.teamId || connection?.team_id || 0);
  const platform = String(connection?.platform || '').toLowerCase().trim();
  const accountId = String(connection?.zernioAccountId || connection?.zernio_account_id || '').trim();
  const keepId = Number(connection?.id || 0);
  if (!teamId || !platform || !accountId || !keepId) return { deleted: 0 };

  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `WITH ranked AS (
       SELECT id,
              ROW_NUMBER() OVER (PARTITION BY team_id, LOWER(platform), zernio_account_id ORDER BY updated_at DESC NULLS LAST, id DESC) AS rn
       FROM zernio_connections
       WHERE team_id = $1
         AND LOWER(platform) = $2
         AND zernio_account_id = $3
         AND id <> $4
     ), deleted AS (
       DELETE FROM zernio_connections
       WHERE id IN (SELECT id FROM ranked)
       RETURNING id
     )
     SELECT COUNT(*)::int AS deleted FROM deleted`,
    [teamId, platform, accountId, keepId]
  ).catch((error: any) => {
    console.warn('[zernio:connection:dedupe]', error?.message || error);
    return [];
  });
  return { deleted: Number(Array.isArray(rows) ? rows[0]?.deleted || 0 : 0) };
}


export async function syncZernioConnectionFromProvider(connection: any) {
  const profileId = String(connection?.zernioProfileId || '').trim();
  const platform = String(connection?.platform || '').toLowerCase().trim();
  if (!profileId || !platform) return connection;
  if (connection?.status === 'connected' && connection?.zernioAccountId && connection?.localInstanceId) return connection;
  if (connection?.status === 'connected' && connection?.zernioAccountId && !connection?.localInstanceId) {
    return ensureZernioLocalInstanceForConnection(connection, { accountId: connection.zernioAccountId, profileId });
  }

  const account = await getLatestZernioAccount(profileId, platform);
  if (!account) return connection;

  const accountId = accountIdValue(account);
  if (!accountId) return connection;

  const username = accountUsernameValue(account);
  const displayName = accountDisplayNameValue(account);
  const picture = accountPictureValue(account);
  const now = new Date();

  const conflict = await resolveZernioAccountConflict(connection, {
    accountId,
    profileId,
    username,
    displayName,
    picture,
    source: 'auto_sync_provider_account',
  });
  if (conflict) {
    return ensureZernioLocalInstanceForConnection(conflict, {
      accountId,
      senderName: username || displayName || accountId,
      profileId,
    });
  }

  const [updated] = await db.update(zernioConnections).set({
    zernioAccountId: accountId,
    accountUsername: username || connection.accountUsername || null,
    accountDisplayName: displayName || username || connection.accountDisplayName || null,
    accountPicture: picture || connection.accountPicture || null,
    status: 'connected',
    lastError: null,
    metadata: {
      ...(connection.metadata || {}),
      autoSyncedAt: now.toISOString(),
      autoSyncSource: 'api_instance_details',
      lastZernioAccount: account,
    },
    updatedAt: now,
  }).where(eq(zernioConnections.id, connection.id)).returning().catch(async (error) => {
    console.warn('[zernio:auto-sync:update-connection]', error?.message || error);
    const resolved = await resolveZernioAccountConflict(connection, {
      accountId,
      profileId,
      username,
      displayName,
      picture,
      source: 'auto_sync_update_conflict',
    });
    return resolved ? [resolved] : [] as any[];
  });

  const effectiveConnection = updated || connection;
  const ensured = await ensureZernioLocalInstanceForConnection(effectiveConnection, {
    accountId,
    senderName: username || displayName || accountId,
    profileId,
  });

  return ensured || updated || {
    ...connection,
    zernioAccountId: accountId,
    accountUsername: username || connection.accountUsername || null,
    accountDisplayName: displayName || username || connection.accountDisplayName || null,
    accountPicture: picture || connection.accountPicture || null,
    status: 'connected',
    lastError: null,
  };
}



let zernioTeamProfilesReady = false;

async function ensureZernioTeamProfilesTable() {
  if (zernioTeamProfilesReady) return;
  const sqlClient = client as any;
  await sqlClient.unsafe(`
    CREATE TABLE IF NOT EXISTS public.zernio_team_profiles (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
      zernio_profile_id VARCHAR(150) NOT NULL,
      profile_name VARCHAR(200) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'active',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await sqlClient.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS zernio_team_profiles_team_uidx ON public.zernio_team_profiles(team_id)`);
  await sqlClient.unsafe(`CREATE UNIQUE INDEX IF NOT EXISTS zernio_team_profiles_profile_uidx ON public.zernio_team_profiles(zernio_profile_id)`);
  await sqlClient.unsafe(`CREATE INDEX IF NOT EXISTS idx_zernio_team_profiles_status ON public.zernio_team_profiles(status)`);
  zernioTeamProfilesReady = true;
}

async function saveZernioTeamProfile(input: { teamId: number; profileId: string; profileName: string; source: string; raw?: any }) {
  await ensureZernioTeamProfilesTable();
  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `INSERT INTO public.zernio_team_profiles
       (team_id, zernio_profile_id, profile_name, status, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', $4::jsonb, NOW(), NOW())
     ON CONFLICT (team_id) DO UPDATE SET
       zernio_profile_id = EXCLUDED.zernio_profile_id,
       profile_name = EXCLUDED.profile_name,
       status = 'active',
       metadata = COALESCE(public.zernio_team_profiles.metadata, '{}'::jsonb) || EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING zernio_profile_id`,
    [input.teamId, input.profileId, input.profileName, JSON.stringify({ source: input.source, syncedAt: new Date().toISOString(), raw: input.raw || null })]
  );
  return firstValue(rows?.[0]?.zernio_profile_id, input.profileId);
}

async function getStoredZernioTeamProfile(teamId: number) {
  await ensureZernioTeamProfilesTable();
  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `SELECT zernio_profile_id, profile_name
       FROM public.zernio_team_profiles
      WHERE team_id = $1 AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [teamId]
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function seedZernioTeamProfileFromLegacy(teamId: number, profileName: string) {
  await ensureZernioTeamProfilesTable();
  const sqlClient = client as any;
  const rows = await sqlClient.unsafe(
    `WITH candidates AS (
       SELECT zernio_profile_id, updated_at, 1 AS priority
         FROM public.zernio_connections
        WHERE team_id = $1
          AND zernio_profile_id IS NOT NULL
          AND btrim(zernio_profile_id) <> ''
       UNION ALL
       SELECT zernio_profile_id, deleted_at AS updated_at, 2 AS priority
         FROM public.zernio_connections_cleanup_backup
        WHERE team_id = $1
          AND zernio_profile_id IS NOT NULL
          AND btrim(zernio_profile_id) <> ''
     ), ranked AS (
       SELECT zernio_profile_id,
              ROW_NUMBER() OVER (ORDER BY priority ASC, updated_at DESC NULLS LAST, zernio_profile_id DESC) AS rn
         FROM candidates
     )
     SELECT zernio_profile_id FROM ranked WHERE rn = 1 LIMIT 1`,
    [teamId]
  ).catch((error: any) => {
    console.warn('[zernio:profile:legacy-seed]', error?.message || error);
    return [];
  });

  const profileId = firstValue(rows?.[0]?.zernio_profile_id);
  if (!profileId) return null;
  await saveZernioTeamProfile({ teamId, profileId, profileName, source: 'legacy_or_cleanup_backup' });
  return profileId;
}

async function findZernioProfileByName(profileName: string) {
  const wanted = String(profileName || '').trim().toLowerCase();
  if (!wanted) return null;
  const params = new URLSearchParams({ includeOverLimit: 'true', page: '1', limit: '100' });
  const response: any = await zernioGet(`/v1/profiles?${params.toString()}`);
  const profiles = zernioProfileArrayResponse(response);
  return profiles.find((profile) => profileNameValue(profile).trim().toLowerCase() === wanted) || null;
}

export async function ensureZernioProfileForTeam(teamId: number, teamName?: string | null) {
  const cleanTeamId = Number(teamId || 0);
  if (!cleanTeamId) throw new Error('teamId inválido para profile Zernio');

  const profileName = String(teamName || `Allsender Team ${cleanTeamId}`).trim().slice(0, 180) || `Allsender Team ${cleanTeamId}`;

  const stored = await getStoredZernioTeamProfile(cleanTeamId).catch((error: any) => {
    console.warn('[zernio:profile:stored]', error?.message || error);
    return null;
  });
  if (stored?.zernio_profile_id) return String(stored.zernio_profile_id);

  const legacyProfileId = await seedZernioTeamProfileFromLegacy(cleanTeamId, profileName);
  if (legacyProfileId) return legacyProfileId;

  const existingRemoteProfile = await findZernioProfileByName(profileName).catch((error: any) => {
    console.warn('[zernio:profile:list]', error?.message || error?.data || error);
    return null;
  });

  const existingRemoteProfileId = existingRemoteProfile ? profileIdValue(existingRemoteProfile) : '';
  if (existingRemoteProfileId) {
    return saveZernioTeamProfile({
      teamId: cleanTeamId,
      profileId: existingRemoteProfileId,
      profileName: profileNameValue(existingRemoteProfile) || profileName,
      source: 'zernio_list_profiles',
      raw: existingRemoteProfile,
    });
  }

  try {
    const response: any = await zernioPost('/v1/profiles', {
      name: profileName,
      description: `Allsender SaaS team ${cleanTeamId}`,
    });

    const profileId = firstValue(response?._id, response?.id, response?.profile?._id, response?.profile?.id, response?.data?._id, response?.data?.id);
    if (!profileId) throw new Error('Zernio no devolvió profileId al crear profile');
    return saveZernioTeamProfile({ teamId: cleanTeamId, profileId, profileName, source: 'zernio_create_profile', raw: response });
  } catch (error: any) {
    const message = String(error?.message || error?.data?.message || '').toLowerCase();
    if (!message.includes('already exists') && !message.includes('already_exist') && !message.includes('duplicate')) throw error;

    const duplicatedRemoteProfile = await findZernioProfileByName(profileName).catch(() => null);
    const duplicatedRemoteProfileId = duplicatedRemoteProfile ? profileIdValue(duplicatedRemoteProfile) : '';
    if (!duplicatedRemoteProfileId) throw error;

    return saveZernioTeamProfile({
      teamId: cleanTeamId,
      profileId: duplicatedRemoteProfileId,
      profileName: profileNameValue(duplicatedRemoteProfile) || profileName,
      source: 'zernio_duplicate_recovered',
      raw: duplicatedRemoteProfile,
    });
  }
}


function zernioWebhookList(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.webhooks)) return response.webhooks;
  if (Array.isArray(response?.data?.webhooks)) return response.data.webhooks;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function findZernioWebhookForUrl(webhooks: any[], url: string) {
  const cleanUrl = String(url || '').replace(/\/+$/, '');
  return webhooks.find((item: any) => String(item?.url || '').replace(/\/+$/, '') === cleanUrl) || null;
}

function isInvalidZernioWebhookInput(error: any): boolean {
  const msg = String(error?.message || error?.data?.message || error?.data?.error || error || '').toLowerCase();
  return msg.includes('invalid input') || msg.includes('validation') || msg.includes('invalid') || msg.includes('events');
}

export async function getZernioWebhookStatus() {
  const url = zernioWebhookUrl();
  const response: any = await zernioGet('/v1/webhooks/settings');
  const webhooks = zernioWebhookList(response);
  const webhook = findZernioWebhookForUrl(webhooks, url);
  return {
    ok: true,
    url,
    configured: Boolean(webhook),
    webhook: webhook || null,
    webhookId: firstValue(webhook?._id, webhook?.id) || null,
    active: webhook ? Boolean(webhook?.isActive ?? webhook?.active ?? true) : false,
    eventsExpected: [...ZERNIO_WEBHOOK_SETTINGS_EVENTS],
    totalWebhooks: webhooks.length,
  };
}

export async function testZernioWebhook(webhookId?: string) {
  let effectiveWebhookId = String(webhookId || '').trim();
  if (!effectiveWebhookId) {
    const status = await getZernioWebhookStatus();
    effectiveWebhookId = String(status.webhookId || '').trim();
  }
  if (!effectiveWebhookId) throw new Error('No hay webhook Zernio configurado para probar. Primero registra el webhook.');
  return zernioPost('/v1/webhooks/test', { webhookId: effectiveWebhookId });
}

export async function ensureZernioWebhook() {
  const url = zernioWebhookUrl();
  const basePayload = {
    name: 'Allsender Main Webhook',
    url,
    secret: process.env.ZERNIO_WEBHOOK_SECRET || undefined,
    isActive: true,
  };

  try {
    const existing: any = await zernioGet('/v1/webhooks/settings').catch(() => null);
    const webhooks = zernioWebhookList(existing);
    const match = findZernioWebhookForUrl(webhooks, url);

    const save = async (events: readonly string[]) => {
      const payload = { ...basePayload, events: [...events] };
      if (match?._id || match?.id) {
        return zernioPut('/v1/webhooks/settings', { _id: match._id || match.id, ...payload });
      }
      return zernioPost('/v1/webhooks/settings', payload);
    };

    try {
      return await save(ZERNIO_WEBHOOK_SETTINGS_EVENTS);
    } catch (error: any) {
      if (!isInvalidZernioWebhookInput(error)) throw error;
      console.warn('[zernio:webhook:register:fallback-minimum-events]', error?.message || error?.data || error);
      return await save(ZERNIO_WEBHOOK_MINIMUM_EVENTS);
    }
  } catch (error: any) {
    console.warn('[zernio:webhook:register]', error?.message || error?.data || error);
    return null;
  }
}


export async function initiateZernioConnection(input: {
  teamId: number;
  teamName?: string | null;
  userId?: number | null;
  platform: string;
  instanceName?: string | null;
}) {
  const platform = String(input.platform || '').toLowerCase();
  if (!isZernioPlatform(platform)) throw new Error('Canal Zernio no soportado');
  const profileId = await ensureZernioProfileForTeam(input.teamId, input.teamName);
  await ensureZernioWebhook();

  const instanceName = String(input.instanceName || `${PLATFORM_LABELS[platform] || platform} Zernio`).trim().slice(0, 80);
  const now = new Date();
  const moduleKey = zernioModuleKey(platform);

  // V3 NO-FANTASMAS:
  // Al iniciar OAuth NO se crea evolution_instances. Esa tabla queda reservada para
  // WhatsApp/Evolution y para el puente interno de inbox cuando ya exista accountId.
  // Guardamos/actualizamos solo una fila pendiente en zernio_connections por team+platform+profile.
  const pendingConnection = await db.query.zernioConnections.findFirst({
    where: and(
      eq(zernioConnections.teamId, input.teamId),
      eq(zernioConnections.platform, platform),
      eq(zernioConnections.zernioProfileId, profileId)
    ),
    orderBy: (table: any, { desc }: any) => [desc(table.updatedAt), desc(table.id)],
  } as any).catch(() => null);

  if (pendingConnection) {
    await db.update(zernioConnections).set({
      userId: input.userId || pendingConnection.userId || null,
      moduleKey,
      status: pendingConnection.zernioAccountId ? 'connected' : 'pending',
      lastError: null,
      metadata: {
        ...(pendingConnection.metadata || {}),
        source: 'connect_flow',
        lastConnectAttemptAt: now.toISOString(),
        requestedInstanceName: instanceName,
        noLocalInstanceUntilAccountConnected: true,
      },
      updatedAt: now,
    }).where(eq(zernioConnections.id, pendingConnection.id)).catch((error: any) => {
      console.warn('[zernio:connect:update-pending]', error?.message || error);
    });
  } else {
    await db.insert(zernioConnections).values({
      teamId: input.teamId,
      userId: input.userId || null,
      localInstanceId: null,
      platform,
      moduleKey,
      zernioProfileId: profileId,
      status: 'pending',
      metadata: {
        source: 'connect_flow',
        requestedInstanceName: instanceName,
        noLocalInstanceUntilAccountConnected: true,
      },
      updatedAt: now,
    }).catch((error: any) => {
      console.warn('[zernio:connect:create-pending]', error?.message || error);
    });
  }

  if (platform === 'telegram') {
    const telegram: any = await zernioGet(`/v1/connect/telegram?profileId=${encodeURIComponent(profileId)}`);
    const telegramPayload = telegram?.data && typeof telegram.data === 'object' ? { ...telegram, ...telegram.data } : telegram;
    const code = firstValue(telegramPayload?.code);
    const botUsername = firstValue(telegramPayload?.botUsername, telegramPayload?.bot_username) || 'ZernioScheduleBot';
    const expiresAt = firstValue(telegramPayload?.expiresAt, telegramPayload?.expires_at);
    const expiresIn = Number(telegramPayload?.expiresIn || telegramPayload?.expires_in || 0);
    const instructions = Array.isArray(telegramPayload?.instructions) ? telegramPayload.instructions : [];

    const latestTelegramConnection = await db.query.zernioConnections.findFirst({
      where: and(
        eq(zernioConnections.teamId, input.teamId),
        eq(zernioConnections.platform, platform),
        eq(zernioConnections.zernioProfileId, profileId)
      ),
      orderBy: (table: any, { desc }: any) => [desc(table.updatedAt), desc(table.id)],
    } as any).catch(() => null);

    if (latestTelegramConnection) {
      await db.update(zernioConnections).set({
        status: latestTelegramConnection.zernioAccountId ? 'connected' : 'pending',
        lastError: null,
        metadata: {
          ...(latestTelegramConnection.metadata || {}),
          source: 'telegram_access_code_flow',
          noLocalInstanceUntilAccountConnected: true,
          telegramConnect: {
            code,
            botUsername,
            expiresAt: expiresAt || null,
            expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
            instructions,
            generatedAt: now.toISOString(),
          },
        },
        updatedAt: now,
      }).where(eq(zernioConnections.id, latestTelegramConnection.id)).catch((error: any) => {
        console.warn('[zernio:telegram:save-code]', error?.message || error);
      });
    }

    return {
      platform,
      profileId,
      localInstance: null,
      status: 'pending',
      code,
      botUsername,
      expiresAt: expiresAt || null,
      expiresIn: Number.isFinite(expiresIn) ? expiresIn : null,
      instructions,
      telegram: telegramPayload,
      connectUrl: null,
    };
  }

  const redirectUrl = publicCallbackUrl(platform);
  const connectParams = new URLSearchParams({
    profileId,
    redirect_url: redirectUrl,
  });

  // Google Business necesita selección de ubicación. Usamos headless solo para este canal
  // para que AllSender muestre las ubicaciones y no marque conectado antes de tener accountId real.
  if (platform === 'googlebusiness') connectParams.set('headless', 'true');

  const response: any = await zernioGet(`/v1/connect/${platform}?${connectParams.toString()}`);
  const connectUrl = firstValue(response?.url, response?.connectUrl, response?.authUrl, response?.oauthUrl, response?.data?.url, response?.data?.connectUrl, response?.data?.authUrl);
  if (!connectUrl) throw new Error('No pudimos iniciar la conexión. Intenta nuevamente.');

  return {
    platform,
    profileId,
    localInstance: null,
    connectUrl,
    status: 'pending',
    requiresLocationSelection: platform === 'googlebusiness',
    raw: response,
  };
}


export async function completeTelegramConnectionForTeam(input: { teamId: number; userId?: number | null; code: string }) {
  const teamId = Number(input.teamId || 0);
  const code = firstValue(input.code).trim();
  if (!teamId) throw new Error('Equipo no disponible');
  if (!code) throw new Error('Código no disponible');

  const response: any = await zernioPatch(`/v1/connect/telegram?code=${encodeURIComponent(code)}`);
  const payload = response?.data && typeof response.data === 'object' ? { ...response, ...response.data } : response;
  const status = String(payload?.status || '').toLowerCase();
  const account = payload?.account && typeof payload.account === 'object' ? payload.account : {};
  const accountId = accountIdValue(account);
  const username = accountUsernameValue(account);
  const displayName = accountDisplayNameValue(account) || firstValue(payload?.chatTitle, payload?.chat_title, username);
  const accountPicture = accountPictureValue(account);
  const profileId = accountProfileId(account);
  const chatId = firstValue(payload?.chatId, payload?.chat_id);
  const chatTitle = firstValue(payload?.chatTitle, payload?.chat_title, displayName);
  const chatType = firstValue(payload?.chatType, payload?.chat_type, account?.chatType);
  const now = new Date();

  const telegramConnections = await db.query.zernioConnections.findMany({
    where: and(eq(zernioConnections.teamId, teamId), eq(zernioConnections.platform, 'telegram')),
    orderBy: (table: any, { desc }: any) => [desc(table.updatedAt), desc(table.id)],
    with: { localInstance: true } as any,
  } as any).catch(() => [] as any[]);

  const connection = telegramConnections.find((item: any) => {
    const meta = item?.metadata || {};
    return String(meta?.telegramConnect?.code || meta?.telegramCode || '').trim() === code;
  }) || telegramConnections[0] || null;

  if (!connection) {
    return { ok: false, status: 'pending', message: 'Conexión pendiente. Genera un nuevo código para continuar.' };
  }

  if (status === 'expired') {
    await db.update(zernioConnections).set({
      status: 'pending',
      lastError: null,
      metadata: {
        ...(connection.metadata || {}),
        telegramConnect: {
          ...((connection.metadata || {}) as any).telegramConnect,
          code,
          status: 'expired',
          checkedAt: now.toISOString(),
        },
      },
      updatedAt: now,
    }).where(eq(zernioConnections.id, connection.id)).catch((error: any) => {
      console.warn('[zernio:telegram:expired]', error?.message || error);
    });

    return { ok: true, status: 'expired', message: 'Código vencido. Genera uno nuevo para continuar.' };
  }

  if (status === 'connected' && accountId) {
    let activeConnection: any = connection;
    const conflict = await resolveZernioAccountConflict(activeConnection, {
      accountId,
      profileId: profileId || activeConnection.zernioProfileId,
      username,
      displayName,
      picture: accountPicture,
      source: 'telegram_access_code_complete',
    });
    if (conflict) activeConnection = conflict;

    const [updatedConnection] = await db.update(zernioConnections).set({
      userId: input.userId || activeConnection.userId || null,
      zernioProfileId: profileId || activeConnection.zernioProfileId,
      zernioAccountId: accountId,
      accountUsername: username || activeConnection.accountUsername || null,
      accountDisplayName: displayName || chatTitle || activeConnection.accountDisplayName || null,
      accountPicture: accountPicture || activeConnection.accountPicture || null,
      status: 'connected',
      lastError: null,
      metadata: {
        ...(activeConnection.metadata || {}),
        source: 'telegram_access_code_complete',
        telegramConnect: {
          ...((activeConnection.metadata || {}) as any).telegramConnect,
          code,
          status: 'connected',
          chatId: chatId || null,
          chatTitle: chatTitle || null,
          chatType: chatType || null,
          connectedAt: now.toISOString(),
        },
      },
      updatedAt: now,
    }).where(eq(zernioConnections.id, activeConnection.id)).returning().catch(async (error: any) => {
      console.warn('[zernio:telegram:complete-update]', error?.message || error);
      const resolved = await resolveZernioAccountConflict(activeConnection, {
        accountId,
        profileId: profileId || activeConnection.zernioProfileId,
        username,
        displayName,
        picture: accountPicture,
        source: 'telegram_access_code_complete_conflict',
      });
      return resolved ? [resolved] : [] as any[];
    });

    activeConnection = updatedConnection || activeConnection;
    await ensureZernioLocalInstanceForConnection(activeConnection, {
      accountId,
      senderName: displayName || username || accountId,
      profileId: profileId || activeConnection.zernioProfileId,
    });
    await deleteDuplicateZernioConnectionRows({ ...activeConnection, zernioAccountId: accountId });

    return {
      ok: true,
      status: 'connected',
      accountId,
      accountName: displayName || username || chatTitle || 'Telegram',
      chatTitle: chatTitle || null,
      chatType: chatType || null,
      message: 'Telegram conectado correctamente.',
    };
  }

  await db.update(zernioConnections).set({
    status: 'pending',
    lastError: null,
    metadata: {
      ...(connection.metadata || {}),
      telegramConnect: {
        ...((connection.metadata || {}) as any).telegramConnect,
        code,
        status: 'pending',
        expiresAt: firstValue(payload?.expiresAt, payload?.expires_at) || ((connection.metadata || {}) as any).telegramConnect?.expiresAt || null,
        expiresIn: Number(payload?.expiresIn || payload?.expires_in || 0) || ((connection.metadata || {}) as any).telegramConnect?.expiresIn || null,
        checkedAt: now.toISOString(),
      },
    },
    updatedAt: now,
  }).where(eq(zernioConnections.id, connection.id)).catch((error: any) => {
    console.warn('[zernio:telegram:pending]', error?.message || error);
  });

  return {
    ok: true,
    status: 'pending',
    expiresAt: firstValue(payload?.expiresAt, payload?.expires_at) || null,
    expiresIn: Number(payload?.expiresIn || payload?.expires_in || 0) || null,
    message: 'Esperando autorización. Completa los pasos en Telegram y vuelve a verificar.',
  };
}

function normalizeGoogleBusinessLocations(response: any): any[] {
  const payload = response?.data && typeof response.data === 'object' ? { ...response, ...response.data } : response;
  if (Array.isArray(payload?.locations)) return payload.locations;
  if (Array.isArray(payload?.data?.locations)) return payload.data.locations;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return [];
}

function googleBusinessHasMore(response: any): boolean {
  const payload = response?.data && typeof response.data === 'object' ? { ...response, ...response.data } : response;
  return Boolean(payload?.hasMore || payload?.data?.hasMore);
}

async function findGoogleBusinessPendingConnection(teamId: number, profileId?: string | null) {
  const cleanProfile = firstValue(profileId);
  const whereClause = cleanProfile
    ? and(eq(zernioConnections.teamId, teamId), eq(zernioConnections.platform, 'googlebusiness'), eq(zernioConnections.zernioProfileId, cleanProfile))
    : and(eq(zernioConnections.teamId, teamId), eq(zernioConnections.platform, 'googlebusiness'));

  return db.query.zernioConnections.findFirst({
    where: whereClause,
    orderBy: (table: any, { desc }: any) => [
      sql`CASE WHEN LOWER(${table.status}) = 'pending' THEN 0 WHEN LOWER(${table.status}) = 'connected' THEN 1 ELSE 2 END`,
      desc(table.updatedAt),
      desc(table.id),
    ],
    with: { localInstance: true } as any,
  } as any).catch(() => null);
}

export async function listGoogleBusinessLocationsForTeam(input: { teamId: number; userId?: number | null; profileId?: string | null; pendingDataToken?: string | null; search?: string | null }) {
  const teamId = Number(input.teamId || 0);
  const profileId = firstValue(input.profileId);
  const pendingDataToken = firstValue(input.pendingDataToken);
  const search = firstValue(input.search);
  if (!teamId) throw new Error('Equipo no disponible');
  if (!profileId) throw new Error('Conexión no disponible');
  if (!pendingDataToken) throw new Error('Autorización pendiente no disponible');

  const params = new URLSearchParams({ profileId, pendingDataToken });
  if (search) params.set('search', search);

  const response: any = await zernioGet(`/v1/connect/googlebusiness/locations?${params.toString()}`);
  const locations = normalizeGoogleBusinessLocations(response).map((location: any) => ({
    id: firstValue(location?.id, location?.locationId, location?.name),
    name: firstValue(location?.name, location?.title, location?.displayName, 'Ubicación Google Business'),
    accountId: firstValue(location?.accountId, location?.account_id, location?.accountName),
    accountName: firstValue(location?.accountName, location?.account_name),
    address: firstValue(location?.address, location?.storefrontAddress, location?.formattedAddress),
    category: firstValue(location?.category, location?.primaryCategory),
    storeCode: firstValue(location?.storeCode, location?.store_code),
    raw: location,
  })).filter((location: any) => location.id);

  const connection = await findGoogleBusinessPendingConnection(teamId, profileId);
  if (connection) {
    await db.update(zernioConnections).set({
      status: connection.zernioAccountId ? 'connected' : 'pending',
      lastError: null,
      metadata: {
        ...(connection.metadata || {}),
        source: 'googlebusiness_location_selection',
        googleBusinessConnect: {
          ...((connection.metadata || {}) as any).googleBusinessConnect,
          step: 'select_location',
          profileId,
          pendingDataToken,
          locationsCount: locations.length,
          hasMore: googleBusinessHasMore(response),
          lastLocationsFetchAt: new Date().toISOString(),
        },
      },
      updatedAt: new Date(),
    }).where(eq(zernioConnections.id, connection.id)).catch((error: any) => {
      console.warn('[zernio:googlebusiness:locations:save]', error?.message || error);
    });
  }

  return {
    ok: true,
    status: 'select_location',
    profileId,
    pendingDataToken,
    locations,
    hasMore: googleBusinessHasMore(response),
    message: locations.length ? 'Selecciona la ubicación que deseas conectar.' : 'No encontramos ubicaciones disponibles.',
  };
}

export async function selectGoogleBusinessLocationForTeam(input: { teamId: number; userId?: number | null; profileId?: string | null; pendingDataToken?: string | null; locationId?: string | null; accountId?: string | null }) {
  const teamId = Number(input.teamId || 0);
  const profileId = firstValue(input.profileId);
  const pendingDataToken = firstValue(input.pendingDataToken);
  const locationId = firstValue(input.locationId);
  const gmbOwnerAccountId = firstValue(input.accountId);
  if (!teamId) throw new Error('Equipo no disponible');
  if (!profileId || !pendingDataToken || !locationId) throw new Error('Selecciona una ubicación para continuar');

  const response: any = await zernioPost('/v1/connect/googlebusiness/select-location', {
    profileId,
    locationId,
    accountId: gmbOwnerAccountId || undefined,
    pendingDataToken,
    redirect_url: publicCallbackUrl('googlebusiness'),
  });
  const payload = response?.data && typeof response.data === 'object' ? { ...response, ...response.data } : response;
  const account = payload?.account && typeof payload.account === 'object' ? payload.account : payload;
  const zernioAccountId = accountIdValue(account);
  const username = accountUsernameValue(account);
  const displayName = accountDisplayNameValue(account) || firstValue(account?.selectedLocationName, account?.locationName, username, 'Google Business');
  const picture = accountPictureValue(account);
  const selectedLocationId = firstValue(account?.selectedLocationId, account?.locationId, locationId);
  const selectedLocationName = firstValue(account?.selectedLocationName, account?.locationName, displayName);
  const now = new Date();

  const connection = await findGoogleBusinessPendingConnection(teamId, profileId);
  if (!connection) {
    return { ok: false, status: 'pending', message: 'Conexión pendiente. Inicia Google Business nuevamente.' };
  }

  if (!zernioAccountId) {
    await db.update(zernioConnections).set({
      status: 'pending',
      metadata: {
        ...(connection.metadata || {}),
        source: 'googlebusiness_location_selection_pending',
        googleBusinessConnect: {
          ...((connection.metadata || {}) as any).googleBusinessConnect,
          step: 'select_location',
          profileId,
          pendingDataToken,
          selectedLocationId,
          selectedLocationName,
          lastAttemptAt: now.toISOString(),
          raw: payload,
        },
      },
      updatedAt: now,
    }).where(eq(zernioConnections.id, connection.id)).catch(() => null);

    return { ok: false, status: 'pending', message: 'La ubicación todavía no quedó activa. Intenta nuevamente.' };
  }

  let activeConnection: any = connection;
  const conflict = await resolveZernioAccountConflict(activeConnection, {
    accountId: zernioAccountId,
    profileId,
    username,
    displayName,
    picture,
    source: 'googlebusiness_select_location_conflict',
  });
  if (conflict) activeConnection = conflict;

  const [updatedConnection] = await db.update(zernioConnections).set({
    zernioAccountId,
    accountUsername: username || displayName || zernioAccountId,
    accountDisplayName: displayName || username || 'Google Business',
    accountPicture: picture || activeConnection.accountPicture || null,
    status: 'connected',
    lastError: null,
    metadata: {
      ...(activeConnection.metadata || {}),
      source: 'googlebusiness_select_location_complete',
      googleBusinessConnect: {
        ...((activeConnection.metadata || {}) as any).googleBusinessConnect,
        step: 'connected',
        profileId,
        selectedLocationId,
        selectedLocationName,
        ownerAccountId: gmbOwnerAccountId || firstValue(account?.ownerAccountId, account?.accountName),
        connectedAt: now.toISOString(),
        raw: payload,
      },
    },
    updatedAt: now,
  }).where(eq(zernioConnections.id, activeConnection.id)).returning().catch(async (error: any) => {
    console.warn('[zernio:googlebusiness:select-location:update]', error?.message || error);
    const resolved = await resolveZernioAccountConflict(activeConnection, {
      accountId: zernioAccountId,
      profileId,
      username,
      displayName,
      picture,
      source: 'googlebusiness_select_location_update_conflict',
    });
    return resolved ? [resolved] : [] as any[];
  });

  activeConnection = updatedConnection || activeConnection;
  const ensuredConnection = await ensureZernioLocalInstanceForConnection(activeConnection, {
    accountId: zernioAccountId,
    senderName: displayName || username || zernioAccountId,
    profileId,
  });
  await deleteDuplicateZernioConnectionRows({ ...activeConnection, ...ensuredConnection, zernioAccountId }).catch(() => null);

  return {
    ok: true,
    status: 'connected',
    accountId: zernioAccountId,
    accountName: displayName || username || selectedLocationName || 'Google Business',
    selectedLocationId,
    selectedLocationName,
    message: 'Google Business conectado correctamente.',
  };
}

export async function finalizeZernioCallback(query: URLSearchParams) {
  const platform = firstValue(query.get('platform'), query.get('provider'), query.get('connected')).toLowerCase();
  const profileId = firstValue(query.get('profileId'), query.get('profile_id'));
  let accountId = firstValue(query.get('accountId'), query.get('account_id'), query.get('id'));
  let username = firstValue(query.get('username'), query.get('account_username'));
  let displayName = firstValue(query.get('name'), query.get('display_name'));
  let accountPicture = firstValue(query.get('picture'), query.get('avatar'), query.get('profile_picture'));
  const errorMessage = firstValue(query.get('error'), query.get('error_description'), query.get('reason'));
  const pendingDataToken = firstValue(query.get('pendingDataToken'), query.get('pending_data_token'), query.get('tempToken'), query.get('temp_token'));
  const step = firstValue(query.get('step'), query.get('selection'), query.get('select'));
  let status = firstValue(query.get('status')) || (accountId ? 'connected' : pendingDataToken ? 'select_location' : 'pending');

  let effectiveProfileId = profileId;

  if (platform === 'googlebusiness' && pendingDataToken && !accountId && !errorMessage) {
    const connection = await db.query.zernioConnections.findFirst({
      where: effectiveProfileId
        ? and(eq(zernioConnections.zernioProfileId, effectiveProfileId), eq(zernioConnections.platform, platform))
        : and(eq(zernioConnections.platform, platform), eq(zernioConnections.status, 'pending')),
      orderBy: (table: any, { desc }: any) => [desc(table.updatedAt), desc(table.id)],
    } as any).catch(() => null);

    if (connection) {
      await db.update(zernioConnections).set({
        status: connection.zernioAccountId ? 'connected' : 'pending',
        lastError: null,
        metadata: {
          ...(connection.metadata || {}),
          source: 'googlebusiness_oauth_callback',
          googleBusinessConnect: {
            ...((connection.metadata || {}) as any).googleBusinessConnect,
            step: step || 'select_location',
            profileId: effectiveProfileId || connection.zernioProfileId,
            pendingDataToken,
            callbackAt: new Date().toISOString(),
          },
        },
        updatedAt: new Date(),
      }).where(eq(zernioConnections.id, connection.id)).catch((error: any) => {
        console.warn('[zernio:googlebusiness:callback-pending]', error?.message || error);
      });
      return {
        ok: true,
        status: 'select_location',
        reason: 'select_location',
        platform,
        profileId: effectiveProfileId || connection.zernioProfileId,
        pendingDataToken,
      };
    }

    return { ok: false, status: 'select_location', reason: 'connection_not_found', platform, profileId: effectiveProfileId, pendingDataToken };
  }

  // Fallback: si el proveedor devolvió solo ?connected=instagram pero no profileId,
  // usamos la última conexión pendiente de esa plataforma para terminar de sincronizar.
  // Esto evita que la tarjeta quede pegada en "Conectando" cuando Zernio no devuelve todos los params.
  if (!effectiveProfileId && platform) {
    const pending = await db.query.zernioConnections.findFirst({
      where: and(eq(zernioConnections.platform, platform), eq(zernioConnections.status, 'pending')),
      orderBy: (table: any, { desc }: any) => [desc(table.updatedAt)],
    } as any).catch(() => null);
    if (pending?.zernioProfileId) effectiveProfileId = pending.zernioProfileId;
  }

  if (effectiveProfileId && platform && !accountId && !errorMessage) {
    const account = await getLatestZernioAccount(effectiveProfileId, platform);
    if (account) {
      accountId = accountIdValue(account);
      username = username || accountUsernameValue(account);
      displayName = displayName || accountDisplayNameValue(account);
      accountPicture = accountPicture || accountPictureValue(account);
      status = accountId ? 'connected' : status;
    }
  }

  if (!effectiveProfileId && !accountId) return { ok: false, status: 'pending', reason: 'missing_profile_or_account' };

  const profilePlatformWhere = effectiveProfileId && platform
    ? and(eq(zernioConnections.zernioProfileId, effectiveProfileId), eq(zernioConnections.platform, platform))
    : effectiveProfileId
      ? eq(zernioConnections.zernioProfileId, effectiveProfileId)
      : undefined;

  const connection = await db.query.zernioConnections.findFirst({
    where: accountId && profilePlatformWhere
      ? or(eq(zernioConnections.zernioAccountId, accountId), profilePlatformWhere)
      : accountId
        ? eq(zernioConnections.zernioAccountId, accountId)
        : profilePlatformWhere,
  } as any);

  if (!connection) return { ok: false, status: 'pending', reason: 'connection_not_found' };

  const connected = Boolean(accountId) && status !== 'error' && !errorMessage;
  let targetConnection = connection;
  if (connected && accountId) {
    const conflict = await resolveZernioAccountConflict(connection, {
      accountId,
      profileId: effectiveProfileId || connection.zernioProfileId,
      username,
      displayName,
      picture: accountPicture,
      source: 'callback_account_conflict',
    });
    if (conflict) targetConnection = conflict;
  }

  const [updatedConnection] = await db.update(zernioConnections).set({
    zernioAccountId: accountId || targetConnection.zernioAccountId || null,
    accountUsername: username || targetConnection.accountUsername || null,
    accountDisplayName: displayName || targetConnection.accountDisplayName || null,
    accountPicture: accountPicture || targetConnection.accountPicture || null,
    status: errorMessage ? 'error' : connected ? 'connected' : 'pending',
    lastError: errorMessage || null,
    updatedAt: new Date(),
  }).where(eq(zernioConnections.id, targetConnection.id)).returning().catch(async (error) => {
    console.warn('[zernio:callback:update-connection]', error?.message || error);
    const resolved = connected && accountId
      ? await resolveZernioAccountConflict(targetConnection, {
          accountId,
          profileId: effectiveProfileId || targetConnection.zernioProfileId,
          username,
          displayName,
          picture: accountPicture,
          source: 'callback_update_conflict',
        })
      : null;
    return resolved ? [resolved] : [] as any[];
  });

  targetConnection = updatedConnection || targetConnection;

  if (connected) {
    await ensureZernioLocalInstanceForConnection(targetConnection, {
      accountId,
      senderName: username || displayName || accountId,
      profileId: effectiveProfileId || targetConnection.zernioProfileId,
    });
  }

  return { ok: true, status: connected ? 'connected' : errorMessage ? 'error' : 'pending', connectionId: targetConnection.id };
}

export async function findZernioConnectionByAccount(input: { accountId?: string | null; profileId?: string | null; platform?: string | null }) {
  const accountId = String(input.accountId || '').trim();
  const profileId = String(input.profileId || '').trim();
  const platform = String(input.platform || '').toLowerCase().trim();
  if (!accountId && !profileId) return null;

  // En SaaS siempre preferimos la conexión REAL conectada y más reciente.
  // Antes se buscaba por profileId con OR y podía devolver una conexión vieja/eliminada,
  // provocando duplicados o canales borrados en Autopublicar/Comentarios.
  const clauses: any[] = [];
  if (accountId) clauses.push(eq(zernioConnections.zernioAccountId, accountId));
  if (!accountId && profileId) clauses.push(eq(zernioConnections.zernioProfileId, profileId));

  const whereClause = platform && isZernioPlatform(platform)
    ? and(or(...clauses), eq(zernioConnections.platform, platform), eq(zernioConnections.status, 'connected'))
    : and(or(...clauses), eq(zernioConnections.status, 'connected'));

  let connection = await db.query.zernioConnections.findFirst({
    where: whereClause,
    orderBy: (table: any, { desc }: any) => [desc(table.updatedAt), desc(table.id)],
    with: { localInstance: true } as any,
  } as any).catch(() => null);

  // Fallback solo para completar callbacks pending/error, nunca para mostrar como canal activo.
  if (!connection && profileId) {
    connection = await db.query.zernioConnections.findFirst({
      where: platform && isZernioPlatform(platform)
        ? and(eq(zernioConnections.zernioProfileId, profileId), eq(zernioConnections.platform, platform))
        : eq(zernioConnections.zernioProfileId, profileId),
      orderBy: (table: any, { desc }: any) => [desc(table.updatedAt), desc(table.id)],
      with: { localInstance: true } as any,
    } as any).catch(() => null);
  }

  return connection;
}

function normalizePayload(payload: any) {
  // Zernio official message webhook shape:
  // { event:'message.received', message:{...}, conversation:{...}, account:{...}, timestamp:'...' }
  // Some dashboard/API test payloads can wrap the object in data.
  const root = payload?.data && typeof payload.data === 'object' ? { ...payload, ...payload.data } : payload;
  const event = root?.event || root?.type || root?.eventType || root?.name || payload?.event || payload?.type || null;
  const message = root?.message && typeof root.message === 'object' ? root.message : {};
  const conversation = root?.conversation && typeof root.conversation === 'object' ? root.conversation : {};
  const account = root?.account && typeof root.account === 'object' ? root.account : {};
  const profile = root?.profile && typeof root.profile === 'object' ? root.profile : {};
  const sender = message?.sender || root?.sender || root?.from || {};
  const normalizedInbound = normalizeInboundMessage(root, 'zernio');

  const platform = String(
    message?.platform
      || root?.platform
      || account?.platform
      || conversation?.platform
      || ''
  ).toLowerCase();

  const accountId = firstValue(
    message?.accountId,
    root?.accountId,
    root?.account_id,
    account?.accountId,
    account?.account_id,
    account?._id,
    account?.id
  );

  const profileId = firstValue(
    root?.profileId,
    root?.profile_id,
    account?.profileId,
    account?.profile_id,
    profile?._id,
    profile?.id,
    profile?.profileId
  );

  const conversationId = firstValue(
    message?.conversationId,
    root?.conversationId,
    root?.conversation_id,
    conversation?._id,
    conversation?.id,
    conversation?.platformConversationId
  );

  const messageId = cleanId(firstValue(
    message?.id,
    message?.messageId,
    message?.message_id,
    message?.platformMessageId,
    root?.messageId,
    root?.message_id,
    root?._id,
    root?.id,
    `${accountId || 'acct'}_${Date.now()}`
  ));

  const text = firstValue(
    normalizedInbound.text,
    message?.text,
    message?.message,
    root?.text,
    root?.messageText,
    root?.caption,
    root?.metadata?.postbackTitle,
    root?.metadata?.quickReplyPayload,
    root?.metadata?.postbackPayload
  );

  const direction = String(message?.direction || root?.direction || '').toLowerCase();
  const timestampValue = firstValue(message?.sentAt, message?.createdAt, message?.created_at, root?.timestamp, root?.createdAt, root?.created_at);
  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
    : Array.isArray(root?.attachments)
      ? root.attachments
      : Array.isArray(root?.media)
        ? root.media
        : [];
  const firstAttachment = attachments[0] || null;
  const mediaUrl = firstValue(normalizedInbound.mediaUrl, firstAttachment?.url, firstAttachment?.fileUrl, firstAttachment?.mediaUrl, firstAttachment?.previewUrl, root?.mediaUrl);
  const mediaMimetype = firstValue(normalizedInbound.mimeType, firstAttachment?.mimeType, firstAttachment?.mimetype, firstAttachment?.contentType, firstAttachment?.type, root?.mediaMimetype);

  const senderId = firstValue(
    sender?._id,
    sender?.id,
    sender?.contactId,
    sender?.phoneNumber,
    sender?.businessScopedUserId,
    message?.senderId,
    root?.senderId,
    root?.fromId,
    root?.userId,
    conversation?.participantId
  );

  const senderName = firstValue(
    sender?.name,
    sender?.username,
    sender?.whatsappUsername,
    message?.senderName,
    root?.senderName,
    root?.fromName,
    conversation?.participantName,
    conversation?.participantUsername,
    account?.displayName,
    account?.username
  );

  const senderPhone = firstValue(
    sender?.phoneNumber,
    sender?.phone,
    sender?.phone_number,
    sender?.whatsappUsername,
    sender?.username,
    message?.senderPhone,
    message?.sender_phone,
    root?.senderPhone,
    root?.sender_phone,
    root?.from,
    conversation?.participantUsername,
    conversation?.participantId,
    conversation?.platformConversationId
  );

  const senderPicture = firstValue(
    sender?.picture,
    sender?.avatar,
    sender?.profilePicture,
    conversation?.participantPicture,
    account?.picture,
    account?.avatar,
    account?.profilePicture
  );

  const eventId = cleanId(firstValue(root?.eventId, root?.event_id, root?._id, root?.id, payload?.eventId, payload?.event_id, payload?._id, payload?.id, messageId));

  return {
    event,
    eventId,
    platform,
    accountId,
    profileId,
    conversationId,
    messageId,
    text,
    direction,
    timestampValue,
    mediaUrl,
    mediaMimetype,
    messageType: normalizedMessageTypeForDb(normalizedInbound, platform || 'zernio'),
    senderId,
    senderName,
    senderPhone,
    senderPicture,
    raw: payload,
  };
}



function shouldSendMobilePushForInbound(input: { timestamp: Date; skipPush?: boolean }) {
  if (input.skipPush) return false;
  const maxAgeMinutes = Math.max(Number(process.env.MOBILE_PUSH_MAX_AGE_MINUTES || 10), 1);
  const ageMs = Date.now() - input.timestamp.getTime();
  if (Number.isNaN(ageMs)) return false;
  // Evita notificaciones por historial viejo de sync, pero permite tolerancia de reloj.
  return ageMs >= -60_000 && ageMs <= maxAgeMinutes * 60_000;
}

export async function saveZernioInbound(input: {
  connection: any;
  platform: string;
  conversationId: string;
  messageId: string;
  text?: string | null;
  timestamp: Date;
  senderName?: string | null;
  senderPhone?: string | null;
  senderPicture?: string | null;
  mediaUrl?: string | null;
  mediaMimetype?: string | null;
  messageType?: string | null;
  skipAi?: boolean;
  skipPush?: boolean;
}) {
  input.connection = await ensureZernioLocalInstanceForConnection(input.connection, {
    accountId: input.connection?.zernioAccountId,
    senderName: input.senderName,
    profileId: input.connection?.zernioProfileId,
  });

  const instance = input.connection.localInstance;
  const teamId = Number(input.connection.teamId || 0);
  const instanceId = Number(input.connection.localInstanceId || instance?.id || 0);
  if (!teamId || !instanceId) {
    console.warn('[zernio:inbound:missing_instance_team]', { teamId, instanceId, connectionId: input.connection?.id, platform: input.platform });
    return { ok: false, reason: 'missing_instance_team' };
  }

  const remoteJid = zernioRemoteJid(input.platform, input.conversationId);
  const messageId = `zrn_in_${cleanId(input.platform)}_${cleanId(input.messageId)}_${base64url(input.conversationId).slice(0, 24)}`;
  const existing = await db.query.messages.findFirst({ where: eq(messages.id, messageId), columns: { id: true } });
  if (existing) return { ok: true, ignored: true, chatId: null, remoteJid };

  if (await isDeletedChatReplayBlocked({ teamId, instanceId, remoteJid, timestamp: input.timestamp })) {
    console.log('[zernio:inbound:deleted_chat_guard]', { teamId, instanceId, remoteJid, timestamp: input.timestamp.toISOString() });
    return { ok: true, ignored: true, reason: 'deleted_chat_replay_blocked', chatId: null, remoteJid };
  }

  const displayPhone = normalizeDisplayPhone(input.senderPhone);
  const displayName = resolveZernioDisplayName({
    name: input.senderName,
    phone: displayPhone,
    platform: input.platform,
    remoteJid,
  });
  const externalConversationId = displayPhone || input.conversationId;
  const dbMessageType = input.messageType || (input.mediaMimetype?.startsWith('audio/') ? 'audioMessage' : input.mediaMimetype?.startsWith('image/') ? 'imageMessage' : input.platform);
  const preview = input.text || (input.mediaUrl ? '[Adjunto]' : 'Nuevo mensaje');
  let chatId = 0;
  let newMessageData: any = null;
  let chatUpdateData: any = null;

  await db.transaction(async (tx) => {
    const [chat] = await tx.insert(chats).values({
      teamId,
      instanceId,
      remoteJid,
      name: displayName,
      pushName: displayName,
      profilePicUrl: input.senderPicture || null,
      lastMessageText: preview,
      lastMessageTimestamp: input.timestamp,
      lastCustomerInteraction: input.timestamp,
      unreadCount: 1,
      lastMessageFromMe: false,
      lastMessageStatus: 'received',
      archivedAt: null,
      archivedReason: null,
      archivedBy: null,
      provider: 'zernio',
      platform: input.platform,
      channelLabel: PLATFORM_LABELS[input.platform] || input.platform,
      externalConversationId,
      sourceChannel: 'zernio',
    }).onConflictDoUpdate({
      target: [chats.teamId, chats.remoteJid, chats.instanceId],
      set: {
        lastMessageText: preview,
        lastMessageTimestamp: input.timestamp,
        lastCustomerInteraction: input.timestamp,
        unreadCount: sql`${chats.unreadCount} + 1`,
        lastMessageFromMe: false,
        name: displayName,
        pushName: displayName,
        profilePicUrl: input.senderPicture || undefined,
        lastMessageStatus: 'received',
        archivedAt: null,
        archivedReason: null,
        archivedBy: null,
        provider: 'zernio',
        platform: input.platform,
        channelLabel: PLATFORM_LABELS[input.platform] || input.platform,
        externalConversationId,
        sourceChannel: 'zernio',
      } as any,
    }).returning({ id: chats.id, name: chats.name, profilePicUrl: chats.profilePicUrl, externalConversationId: chats.externalConversationId, archivedAt: chats.archivedAt, archivedReason: chats.archivedReason });

    chatId = chat.id;
    const dbMessage = {
      id: messageId,
      chatId,
      fromMe: false,
      messageType: dbMessageType,
      text: input.text || null,
      timestamp: input.timestamp,
      status: 'received' as const,
      mediaUrl: input.mediaUrl || null,
      mediaMimetype: input.mediaMimetype || null,
      mediaCaption: input.mediaUrl ? input.text || null : null,
      isInternal: false,
      isAi: false,
      isAutomation: false,
    };
    await tx.insert(messages).values(dbMessage).onConflictDoNothing();
    newMessageData = { ...dbMessage, remoteJid, instance: instance?.instanceName || input.connection.platform, instanceId };
    chatUpdateData = {
      id: chat.id,
      remoteJid,
      instanceId,
      name: chat.name,
      profilePicUrl: chat.profilePicUrl,
      displayPhone: chat.externalConversationId,
      lastMessageText: preview,
      lastMessageTimestamp: input.timestamp.toISOString(),
      lastMessageFromMe: false,
      lastMessageStatus: 'received',
      unreadCount: 1,
      archivedAt: chat.archivedAt ? chat.archivedAt.toISOString() : null,
      archivedReason: chat.archivedReason,
    };
  });

  try {
    await pusherServer.trigger(`team-${teamId}`, 'new-message', newMessageData);
    await pusherServer.trigger(`team-${teamId}`, 'chat-list-update', chatUpdateData);
  } catch (error) {
    console.warn('[zernio:pusher]', error);
  }

  if (shouldSendMobilePushForInbound({ timestamp: input.timestamp, skipPush: input.skipPush })) {
    sendAllSenderNewMessagePush({
      teamId,
      chatId,
      remoteJid,
      instanceId,
      messageId,
      platform: input.platform,
      title: displayName || 'AllSender Chat',
      body: preview || 'Nuevo mensaje recibido',
    }).catch((error: any) => {
      console.warn('[mobile-push:zernio-inbound]', error?.message || error);
    });
  }

  if (!input.skipAi && (input.text?.trim() || input.mediaUrl)) {
    const linkedAgent = await resolveLinkedAutonomousAgent({ teamId, channel: 'zernio', instanceId });
    const aiFirst = Boolean(linkedAgent);
    let aiHandled = false;
    if (linkedAgent) console.info('[agent-resolver] autonomous agent selected', { teamId, channel: 'zernio', instanceId, module: linkedAgent.runtimeModule, agentPublicId: linkedAgent.agentPublicId });

    // Sucursales v2: enrutamiento de especialista PRIMERO (exclusividad por conversacion).
    // Si el modulo no esta activo o el mensaje no es de sucursales, devuelve false
    // y el pipeline continua con agente vinculado / automatizaciones / departamentos / IA.
    let branchHandled = false;
    if (input.text?.trim()) {
      try {
        branchHandled = await processUniversalBranchRouting({
          teamId,
          chatId,
          instanceId,
          remoteJid,
          incomingText: input.text,
          messageId,
          channel: 'zernio',
          sendText: async (text: string) => {
            await sendAiZernioTextMessage({
              connection: input.connection,
              conversationId: input.conversationId,
              remoteJid,
              text,
              teamId,
              chatId,
            });
            return true;
          },
        });
      } catch (error: any) {
        console.error('[zernio:branches-v2]', error?.message || error);
        branchHandled = false;
      }
    }

    if (aiFirst && !branchHandled) {
      try {
        const aiAudioUrl = dbMessageType === 'audioMessage' ? (input.mediaUrl || null) : null;
        const aiImageUrl = ['imageMessage', 'stickerMessage', 'documentMessage'].includes(dbMessageType) ? (input.mediaUrl || null) : null;
        const aiResponse = await processAIMessage(teamId, chatId, input.text || '', aiAudioUrl, aiImageUrl, input.mediaMimetype || null, messageId);
        if (aiResponse) {
          aiHandled = true;
          await sendAiZernioTextMessage({
            connection: input.connection,
            conversationId: input.conversationId,
            remoteJid,
            text: String(aiResponse),
            teamId,
            chatId,
          });
        }
      } catch (error: any) {
        console.error('[zernio:agent-first]', error?.message || error);
      }
    }

    if (!aiHandled && !branchHandled) {
      // Auto-chat del cliente (processAutomation) tras sucursales, antes de
      // departamentos/IA. Si responde, es exclusivo (misma regla que Evolution/Meta).
      if (input.text?.trim()) {
        try {
          const automationHandled = await processAutomation(
            teamId,
            chatId,
            remoteJid,
            input.text,
            { instanceName: input.connection?.localInstance?.instanceName || 'zernio', accessToken: 'zernio-direct' },
            instanceId,
            messageId,
            {
              channel: 'zernio',
              send: async (jid, endpoint, contentPayload, tId, cId) => {
                if (endpoint === 'sendText' && contentPayload?.text) {
                  await sendAiZernioTextMessage({
                    connection: input.connection,
                    conversationId: input.conversationId,
                    remoteJid: jid,
                    text: String(contentPayload.text),
                    teamId: tId,
                    chatId: cId,
                    isAutomation: true,
                  });
                } else {
                  console.info('[zernio:automation] media no soportado en Zernio', { endpoint });
                }
              },
            }
          );
          if (automationHandled) return { ok: true, chatId, remoteJid, automationProcessed: true };
        } catch (error: any) {
          console.error('[zernio:automation]', error?.message || error);
        }
      }

      try {
        if (input.text?.trim()) {
          const departmentHandled = await processZernioDepartmentRouting({
            teamId,
            chatId,
            instanceId,
            remoteJid,
            incomingText: input.text,
            sendText: async (text: string) => {
              await sendAiZernioTextMessage({
                connection: input.connection,
                conversationId: input.conversationId,
                remoteJid,
                text,
                teamId,
                chatId,
              });
              return true;
            },
          });
          if (departmentHandled) return { ok: true, chatId, remoteJid, departmentHandled: true };
        }
      } catch (error: any) {
        console.error('[zernio:routing]', error?.message || error);
      }

      if (!aiFirst) {
        try {
          const aiAudioUrl = dbMessageType === 'audioMessage' ? (input.mediaUrl || null) : null;
          const aiImageUrl = ['imageMessage', 'stickerMessage', 'documentMessage'].includes(dbMessageType) ? (input.mediaUrl || null) : null;
          const aiResponse = await processAIMessage(teamId, chatId, input.text || '', aiAudioUrl, aiImageUrl, input.mediaMimetype || null, messageId);
          if (aiResponse) {
            await sendAiZernioTextMessage({
              connection: input.connection,
              conversationId: input.conversationId,
              remoteJid,
              text: String(aiResponse),
              teamId,
              chatId,
            });
          }
        } catch (error: any) {
          console.error('[zernio:ai]', error?.message || error);
        }
      }
    }
  }

  return { ok: true, chatId, remoteJid };
}

export async function sendZernioTextMessage(input: { accountId: string; conversationId: string; text: string }) {
  const path = `/v1/inbox/conversations/${encodeURIComponent(input.conversationId)}/messages`;
  return zernioPost(path, { accountId: input.accountId, message: input.text });
}

export async function sendAiZernioTextMessage(input: { connection: any; conversationId: string; remoteJid: string; text: string; teamId: number; chatId: number; isAutomation?: boolean }) {
  const accountId = String(input.connection.zernioAccountId || '').trim();
  if (!accountId || !input.text.trim()) return;
  const sent: any = await sendZernioTextMessage({ accountId, conversationId: input.conversationId, text: input.text.trim() });
  const now = new Date();
  const providerId = cleanId(firstValue(sent?.messageId, sent?.id, sent?.data?.id, Date.now()));
  const isAutomation = Boolean(input.isAutomation);
  const dbMessage = {
    id: `zrn_ai_${cleanId(input.connection.platform)}_${providerId}_${randomUUID()}`,
    chatId: input.chatId,
    fromMe: true,
    messageType: input.connection.platform,
    text: input.text.trim(),
    timestamp: now,
    status: 'sent' as const,
    isInternal: false,
    isAi: isAutomation ? false : true,
    isAutomation,
    mediaUrl: null,
    mediaMimetype: null,
    mediaCaption: null,
  };
  await db.insert(messages).values(dbMessage).onConflictDoNothing();
  await db.update(chats).set({
    lastMessageText: input.text.trim(),
    lastMessageTimestamp: now,
    lastMessageFromMe: true,
    lastMessageStatus: 'sent',
    unreadCount: 0,
  }).where(eq(chats.id, input.chatId));

  try {
    await pusherServer.trigger(`team-${input.teamId}`, 'new-message', { ...dbMessage, timestamp: now.toISOString(), remoteJid: input.remoteJid, instanceId: input.connection.localInstanceId });
    await pusherServer.trigger(`team-${input.teamId}`, 'chat-list-update', { id: input.chatId, remoteJid: input.remoteJid, instanceId: input.connection.localInstanceId, lastMessageText: input.text.trim(), lastMessageTimestamp: now.toISOString(), lastMessageFromMe: true, lastMessageStatus: 'sent', unreadCount: 0 });
  } catch (error) {
    console.warn('[zernio:ai:pusher]', error);
  }
}


function zernioMessagesResponse(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.messages)) return response.messages;
  if (Array.isArray(response?.data?.messages)) return response.data.messages;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function zernioConversationListResponse(response: any): any[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.conversations)) return response.conversations;
  if (Array.isArray(response?.data?.conversations)) return response.data.conversations;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function zernioConversationIdValue(conversation: any): string {
  return firstValue(conversation?.id, conversation?._id, conversation?.conversationId, conversation?.platformConversationId);
}

function zernioMessageTimestamp(message: any): Date {
  const raw = firstValue(message?.createdAt, message?.created_at, message?.sentAt, message?.sent_at, message?.timestamp);
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function zernioAttachmentInfo(message: any) {
  const normalizedInbound = normalizeInboundMessage({ message }, 'zernio');
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  const firstAttachment = attachments[0] || null;
  return {
    mediaUrl: firstValue(normalizedInbound.mediaUrl, firstAttachment?.url, firstAttachment?.previewUrl, firstAttachment?.fileUrl, firstAttachment?.mediaUrl),
    mediaMimetype: firstValue(normalizedInbound.mimeType, firstAttachment?.mimeType, firstAttachment?.mimetype, firstAttachment?.contentType, firstAttachment?.type),
    messageType: normalizedMessageTypeForDb(normalizedInbound, message?.platform || 'zernio'),
    text: normalizedInbound.text,
  };
}

export async function syncZernioInboxForConnection(connection: any, options?: { limitConversations?: number; limitMessages?: number; aiRecentMinutes?: number }) {
  const accountId = String(connection?.zernioAccountId || '').trim();
  const profileId = String(connection?.zernioProfileId || '').trim();
  const platform = String(connection?.platform || '').toLowerCase().trim();
  if (!accountId || !profileId || !platform) return { ok: false, reason: 'missing_connection_identifiers' };
  if (!zernioSupportsDirectMessages(platform)) {
    return {
      ok: true,
      skipped: true,
      platform,
      accountId,
      reason: 'platform_without_direct_messages',
      conversations: 0,
      saved: 0,
      ignored: 0,
      failed: 0,
    };
  }

  const limitConversations = Math.min(Math.max(Number(options?.limitConversations || 20), 1), 50);
  const limitMessages = Math.min(Math.max(Number(options?.limitMessages || 20), 1), 50);
  const aiRecentMinutes = Math.max(Number(options?.aiRecentMinutes ?? 15), 0);

  const params = new URLSearchParams({
    profileId,
    accountId,
    platform,
    status: 'active',
    sortOrder: 'desc',
    limit: String(limitConversations),
  });

  const conversationResponse: any = await zernioGet(`/v1/inbox/conversations?${params.toString()}`);
  const conversations = zernioConversationListResponse(conversationResponse);
  let saved = 0;
  let ignored = 0;
  let failed = 0;

  for (const conversation of conversations) {
    const conversationId = zernioConversationIdValue(conversation);
    if (!conversationId) continue;

    try {
      const msgParams = new URLSearchParams({
        accountId,
        limit: String(limitMessages),
        sortOrder: 'asc',
      });
      const messagesResponse: any = await zernioGet(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${msgParams.toString()}`);
      const providerMessages = zernioMessagesResponse(messagesResponse)
        .map((item) => ({ item, ts: zernioMessageTimestamp(item) }))
        .sort((a, b) => a.ts.getTime() - b.ts.getTime());

      const incoming = providerMessages
        .map((wrapped, index) => ({ ...wrapped, index }))
        .filter(({ item }) => String(item?.direction || '').toLowerCase() !== 'outgoing');
      const latestIncomingIndex = incoming.length ? incoming[incoming.length - 1].index : -1;

      for (const wrapped of providerMessages) {
        const message = wrapped.item;
        const direction = String(message?.direction || '').toLowerCase();
        if (direction === 'outgoing') continue;

        const ageMinutes = (Date.now() - wrapped.ts.getTime()) / 60000;
        const shouldRunAi = wrapped === providerMessages[latestIncomingIndex] || providerMessages.indexOf(wrapped) === latestIncomingIndex;
        const aiAllowed = shouldRunAi && (aiRecentMinutes <= 0 || ageMinutes <= aiRecentMinutes);
        const attachmentInfo = zernioAttachmentInfo(message);
        const text = firstValue(attachmentInfo.text, message?.message, message?.text, message?.body);
        const messageId = cleanId(firstValue(message?.id, message?.messageId, message?.platformMessageId, `${conversationId}_${wrapped.ts.getTime()}`));
        const senderName = firstValue(message?.senderName, message?.sender?.name, message?.sender?.username, conversation?.participantName, conversation?.participantUsername);
        const senderPhone = firstValue(message?.sender?.phoneNumber, message?.sender?.phone, message?.sender?.username, conversation?.participantUsername, conversation?.participantId, conversation?.platformConversationId);
        const senderPicture = firstValue(message?.sender?.picture, conversation?.participantPicture);

        const result = await saveZernioInbound({
          connection,
          platform: String(message?.platform || conversation?.platform || platform).toLowerCase(),
          conversationId,
          messageId,
          text,
          timestamp: wrapped.ts,
          senderName: senderName || null,
          senderPhone: senderPhone || null,
          senderPicture: senderPicture || null,
          mediaUrl: attachmentInfo.mediaUrl || null,
          mediaMimetype: attachmentInfo.mediaMimetype || null,
          messageType: attachmentInfo.messageType || null,
          skipAi: !aiAllowed,
          skipPush: ageMinutes > Math.max(Number(process.env.MOBILE_PUSH_MAX_AGE_MINUTES || 10), 1),
        });

        if (result?.ignored) ignored++;
        else if (result?.ok) saved++;
      }
    } catch (error: any) {
      failed++;
      console.warn('[zernio:sync-inbox:conversation]', conversationId, error?.message || error);
    }
  }

  return { ok: true, platform, accountId, conversations: conversations.length, saved, ignored, failed };
}

export async function syncZernioInboxForTeam(teamId?: number | null, options?: { limitConversations?: number; limitMessages?: number; aiRecentMinutes?: number }) {
  const allConnections = await db.query.zernioConnections.findMany({
    where: teamId ? eq(zernioConnections.teamId, teamId) : undefined,
    with: { localInstance: true } as any,
  } as any);

  const connections = allConnections.filter((connection: any) => String(connection.status || '').toLowerCase() === 'connected' && connection.zernioAccountId);
  const skippedNoDm = connections
    .filter((connection: any) => !zernioSupportsDirectMessages(connection.platform))
    .map((connection: any) => ({
      connectionId: connection.id,
      ok: true,
      skipped: true,
      platform: connection.platform,
      reason: 'platform_without_direct_messages',
      conversations: 0,
      saved: 0,
      ignored: 0,
      failed: 0,
    }));
  const dmConnections = connections.filter((connection: any) => zernioSupportsDirectMessages(connection.platform));
  const results: any[] = [...skippedNoDm];

  for (const connection of dmConnections) {
    try {
      const result = await syncZernioInboxForConnection(connection, options);
      results.push({ connectionId: connection.id, ...result });
    } catch (error: any) {
      results.push({ connectionId: connection.id, ok: false, error: error?.message || 'sync_failed' });
      console.warn('[zernio:sync-inbox:connection]', connection.id, error?.message || error);
    }
  }

  return {
    ok: true,
    connections: connections.length,
    directMessageConnections: dmConnections.length,
    skippedNoDirectMessages: skippedNoDm.length,
    results,
    saved: results.reduce((sum, item) => sum + Number(item.saved || 0), 0),
    ignored: results.reduce((sum, item) => sum + Number(item.ignored || 0), 0),
    failed: results.reduce((sum, item) => sum + Number(item.failed || (item.ok ? 0 : 1)), 0),
  };
}

export async function handleZernioWebhookPayload(payload: any) {
  const normalized = normalizePayload(payload);
  let webhookLogId: number | null = null;

  const initialConnectionForLog = await findZernioConnectionByAccount({
    accountId: normalized.accountId,
    profileId: normalized.profileId,
    platform: normalized.platform,
  }).catch(() => null);

  const webhookLogValues: any = {
    eventType: normalized.event || null,
    zernioAccountId: normalized.accountId || null,
    zernioProfileId: normalized.profileId || null,
    payload,
    eventId: normalized.eventId || null,
    teamId: initialConnectionForLog?.teamId || null,
    platform: normalized.platform || initialConnectionForLog?.platform || null,
    status: 'received',
    rawPayload: payload,
  };

  const [insertedWebhookLog] = await db.insert(zernioWebhookLogs).values(webhookLogValues).returning({ id: zernioWebhookLogs.id }).catch(async (error: any) => {
    if (normalized.eventId) {
      await db.insert(zernioWebhookLogs).values({
        ...webhookLogValues,
        eventId: `${normalized.eventId}_duplicate_${Date.now()}`,
        status: 'duplicate',
        duplicateOfEventId: normalized.eventId,
        processingError: error?.message || 'duplicate_event',
      } as any).catch(() => null);
    }
    return [] as any[];
  });
  webhookLogId = insertedWebhookLog?.id ? Number(insertedWebhookLog.id) : null;

  const markWebhookLog = async (patch: any) => {
    if (!webhookLogId) return;
    await db.update(zernioWebhookLogs).set({ ...patch, processedAt: patch.processedAt || new Date() }).where(eq(zernioWebhookLogs.id, webhookLogId)).catch(() => null);
  };

  try {
    console.log('[zernio:webhook:received]', {
      event: normalized.event,
      platform: normalized.platform,
      accountId: normalized.accountId,
      profileId: normalized.profileId,
      conversationId: normalized.conversationId,
      direction: normalized.direction,
      hasText: Boolean(normalized.text),
      hasMedia: Boolean(normalized.mediaUrl),
    });

    if (normalized.event && /webhook\.test/i.test(normalized.event)) {
      await markWebhookLog({ status: 'processed' });
      return { ok: true, event: normalized.event, test: true };
    }

    if (normalized.event && /^account\.disconnected$/i.test(normalized.event)) {
      const result = await hardDeleteZernioConnectionRows({
        accountId: normalized.accountId,
        profileId: normalized.profileId,
        platform: normalized.platform,
      }).catch((error: any) => {
        console.warn('[zernio:account-disconnected:delete]', error?.message || error);
        return { deleted: 0, error: error?.message || 'delete_failed' } as any;
      });
      await markWebhookLog({ status: 'processed' });
      return { ok: true, event: normalized.event, accountDisconnected: true, hardDeleted: result };
    }

    if (normalized.event && /^account\.connected$/i.test(normalized.event)) {
      let connection = await findZernioConnectionByAccount({ accountId: normalized.accountId, profileId: normalized.profileId, platform: normalized.platform });
      if (!connection && normalized.platform) {
        connection = await db.query.zernioConnections.findFirst({
          where: and(eq(zernioConnections.platform, normalized.platform), eq(zernioConnections.status, 'pending')),
          orderBy: (table: any, { desc }: any) => [desc(table.updatedAt)],
          with: { localInstance: true } as any,
        } as any).catch(() => null);
      }

      if (connection) {
        let activeConnection: any = connection;
        if (normalized.accountId) {
          const conflict = await resolveZernioAccountConflict(activeConnection, {
            accountId: normalized.accountId,
            profileId: normalized.profileId || activeConnection.zernioProfileId,
            username: normalized.senderName || activeConnection.accountUsername,
            displayName: normalized.senderName || activeConnection.accountDisplayName,
            picture: normalized.senderPicture || activeConnection.accountPicture,
            source: 'account_connected_webhook',
          });
          if (conflict) activeConnection = conflict;
        }

        const [updatedConnection] = await db.update(zernioConnections).set({
          zernioAccountId: normalized.accountId || activeConnection.zernioAccountId || null,
          accountUsername: normalized.senderName || activeConnection.accountUsername || null,
          accountDisplayName: normalized.senderName || activeConnection.accountDisplayName || null,
          accountPicture: normalized.senderPicture || activeConnection.accountPicture || null,
          status: normalized.accountId ? 'connected' : activeConnection.status || 'pending',
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(zernioConnections.id, activeConnection.id)).returning().catch(async (error: any) => {
          console.warn('[zernio:account-connected:update-connection]', error?.message || error);
          const resolved = normalized.accountId
            ? await resolveZernioAccountConflict(activeConnection, {
                accountId: normalized.accountId,
                profileId: normalized.profileId || activeConnection.zernioProfileId,
                username: normalized.senderName || activeConnection.accountUsername,
                displayName: normalized.senderName || activeConnection.accountDisplayName,
                picture: normalized.senderPicture || activeConnection.accountPicture,
                source: 'account_connected_update_conflict',
              })
            : null;
          return resolved ? [resolved] : [] as any[];
        });
        if (updatedConnection) activeConnection = { ...activeConnection, ...updatedConnection };

        const ensuredConnection = await ensureZernioLocalInstanceForConnection(activeConnection, {
          accountId: normalized.accountId,
          senderName: normalized.senderName || normalized.accountId,
          profileId: normalized.profileId || activeConnection.zernioProfileId,
        });
        await deleteDuplicateZernioConnectionRows({ ...activeConnection, ...ensuredConnection, zernioAccountId: normalized.accountId || activeConnection.zernioAccountId });
        await markWebhookLog({ status: 'processed', teamId: activeConnection.teamId || null, platform: activeConnection.platform || normalized.platform || null });
      } else {
        await markWebhookLog({ status: 'error', processingError: 'connection_not_found_for_account_connected' });
      }
      return { ok: true, event: normalized.event, accountConnected: Boolean(connection) };
    }

    let connection = await findZernioConnectionByAccount({ accountId: normalized.accountId, profileId: normalized.profileId, platform: normalized.platform });
    if (!connection && normalized.event && /^post\./i.test(normalized.event)) {
      const rawPost = payload?.post || normalized.raw?.post || {};
      const rawPlatforms = Array.isArray(rawPost?.platforms) ? rawPost.platforms : [];
      const candidates = [
        { accountId: normalized.accountId, profileId: normalized.profileId, platform: normalized.platform },
        { accountId: rawPost?.accountId, profileId: rawPost?.profileId || normalized.profileId, platform: rawPost?.platform || normalized.platform },
        { accountId: payload?.account?.accountId || payload?.account?.id, profileId: payload?.account?.profileId || normalized.profileId, platform: payload?.account?.platform || normalized.platform },
        ...rawPlatforms.map((item: any) => ({
          accountId: item?.accountId || item?.account?.accountId || item?.account?.id,
          profileId: item?.profileId || item?.account?.profileId || normalized.profileId,
          platform: item?.platform || item?.name || item?.account?.platform || normalized.platform,
        })),
      ].filter((item) => String(item.accountId || '').trim());

      for (const item of candidates) {
        connection = await findZernioConnectionByAccount({
          accountId: item.accountId,
          profileId: item.profileId,
          platform: item.platform,
        }).catch(() => null);
        if (connection) break;
      }

      if (connection) {
        const saved = await saveZernioMarketingEvent(connection, normalized).catch((error: any) => ({ ok: false, error: error?.message || String(error) }));
        await markWebhookLog({ status: 'processed', teamId: connection.teamId || null, platform: connection.platform || normalized.platform || null });
        return { ok: true, event: normalized.event, marketingEvent: true, saved };
      }

      console.warn('[zernio:webhook:post_event_without_connection]', { event: normalized.event, eventId: normalized.eventId });
      await markWebhookLog({ status: 'processed', processingError: 'post_event_without_connection' });
      return { ok: true, event: normalized.event, marketingEvent: true, reason: 'connection_not_required' };
    }
    if (!connection) {
      console.warn('[zernio:webhook:connection_not_found]', normalized);
      await markWebhookLog({ status: 'error', processingError: 'connection_not_found' });
      return { ok: false, reason: 'connection_not_found', normalized };
    }
    let activeMessageConnection: any = connection;

    if (normalized.accountId && !activeMessageConnection.zernioAccountId) {
      const conflict = await resolveZernioAccountConflict(activeMessageConnection, {
        accountId: normalized.accountId,
        profileId: normalized.profileId || activeMessageConnection.zernioProfileId,
        username: normalized.senderName || activeMessageConnection.accountUsername,
        displayName: normalized.senderName || activeMessageConnection.accountDisplayName,
        picture: normalized.senderPicture || activeMessageConnection.accountPicture,
        source: 'webhook_message_account_fill',
      });
      if (conflict) {
        activeMessageConnection = conflict;
      } else {
        const [updated] = await db.update(zernioConnections).set({ zernioAccountId: normalized.accountId, status: 'connected', updatedAt: new Date() }).where(eq(zernioConnections.id, activeMessageConnection.id)).returning().catch((error) => {
          console.warn('[zernio:webhook:account-fill]', error?.message || error);
          return [] as any[];
        });
        if (updated) activeMessageConnection = { ...activeMessageConnection, ...updated };
      }
    }

    await markWebhookLog({ teamId: activeMessageConnection.teamId || null, platform: normalized.platform || activeMessageConnection.platform || null });

    if (normalized.event && /^message\.deleted$/i.test(normalized.event)) {
      const result = await deleteZernioMessageEvent(activeMessageConnection, normalized);
      await markWebhookLog({ status: 'processed' });
      return result;
    }

    if (normalized.event && /^message\.(sent|delivered|read|failed|edited)$/i.test(normalized.event)) {
      const result = await updateZernioMessageLifecycle(activeMessageConnection, normalized);
      await markWebhookLog({ status: 'processed' });
      return result;
    }

    if (isZernioCommentOrReviewEvent(normalized.event)) {
      if (!zernioSupportsCommentsOrReviews(normalized.platform || activeMessageConnection.platform)) {
        await markWebhookLog({ status: 'ignored', processingError: 'platform_without_comments_or_reviews' });
        return { ok: true, ignored: true, reason: 'platform_without_comments_or_reviews', platform: normalized.platform || activeMessageConnection.platform };
      }
      const result = await saveZernioCommentOrReviewEvent(activeMessageConnection, normalized);
      await markWebhookLog({ status: 'processed' });
      return result;
    }

    if (isZernioPostOrMarketingEvent(normalized.event)) {
      const result = await saveZernioMarketingEvent(activeMessageConnection, normalized);
      await markWebhookLog({ status: 'processed' });
      return result;
    }

    if (normalized.direction === 'outgoing') {
      await markWebhookLog({ status: 'ignored', processingError: 'outgoing_message' });
      return { ok: true, ignored: true, reason: 'outgoing_message' };
    }

    if (!zernioSupportsDirectMessages(normalized.platform || activeMessageConnection.platform)) {
      await markWebhookLog({ status: 'ignored', processingError: 'platform_without_direct_messages' });
      return { ok: true, ignored: true, reason: 'platform_without_direct_messages', platform: normalized.platform || activeMessageConnection.platform };
    }

    if (!normalized.conversationId) {
      await markWebhookLog({ status: 'ignored', processingError: 'missing_conversation_id' });
      return { ok: true, ignored: true, reason: 'missing_conversation_id' };
    }

    const inboundResult = await saveZernioInbound({
      connection: activeMessageConnection,
      platform: normalized.platform || activeMessageConnection.platform,
      conversationId: normalized.conversationId,
      messageId: normalized.messageId,
      text: normalized.text,
      timestamp: normalized.timestampValue ? new Date(normalized.timestampValue) : new Date(),
      senderName: normalized.senderName || normalized.senderId || null,
      senderPhone: normalized.senderPhone || normalized.senderId || null,
      senderPicture: normalized.senderPicture || null,
      mediaUrl: normalized.mediaUrl || null,
      mediaMimetype: normalized.mediaMimetype || null,
      messageType: normalized.messageType || null,
      skipAi: false,
    });
    await markWebhookLog({ status: 'processed' });
    return inboundResult;
  } catch (error: any) {
    console.warn('[zernio:webhook:process]', error?.message || error);
    await markWebhookLog({ status: 'error', processingError: error?.message || 'webhook_process_failed' });
    return { ok: false, error: error?.message || 'webhook_process_failed' };
  }
}
