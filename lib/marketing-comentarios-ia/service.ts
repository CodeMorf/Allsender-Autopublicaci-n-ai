import 'server-only';
import crypto from 'crypto';
import { client } from '@/lib/db/drizzle';
import { zernioPost } from '@/lib/zernio/client';
import { morfGenerate } from '@/lib/morf-ai/runtime/generate';

type SqlClient = typeof client & { unsafe: (query: string, args?: any[]) => Promise<any[]> };
const sql = client as SqlClient;

export type CommentAlgorithm = 'whatsapp_direct' | 'product_link' | 'smart_ai';

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
    } catch {}
  }
  return {};
}

function parseJsonAny(value: unknown): any {
  if (!value) return {};
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return {};
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function walkJson(value: any, visitor: (item: any) => string | boolean | void, depth = 0): string {
  if (!value || depth > 8) return '';
  const parsed = parseJsonAny(value);
  const direct = visitor(parsed);
  if (typeof direct === 'string' && direct) return direct;
  if (direct === true) return 'true';
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = walkJson(item, visitor, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof parsed === 'object') {
    for (const child of Object.values(parsed)) {
      const found = walkJson(child, visitor, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

function normalizeLoopText(value: unknown): string {
  return asString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageIdFromPlatformPostId(value: unknown): string {
  const postId = asString(value);
  if (!postId.includes('_')) return '';
  return asString(postId.split('_')[0]);
}

function metadataPlatformPostId(metadata: any): string {
  return walkJson(metadata, (item) => {
    if (!item || typeof item !== 'object') return '';
    return asString(
      item.platformPostId ||
      item.platform_post_id ||
      item.externalPostId ||
      item.external_post_id ||
      item.postId ||
      item.post_id
    );
  });
}

function metadataCommentId(metadata: any): string {
  return walkJson(metadata, (item) => {
    if (!item || typeof item !== 'object') return '';
    return asString(item.commentId || item.comment_id || item.externalCommentId || item.external_comment_id || item.id);
  });
}

function metadataAuthorId(metadata: any): string {
  return walkJson(metadata, (item) => {
    if (!item || typeof item !== 'object') return '';
    const author = item.author || item.from || item.user;
    if (author && typeof author === 'object') return asString(author.id || author.userId || author.externalId);
    return '';
  });
}

function metadataAuthorName(metadata: any): string {
  return walkJson(metadata, (item) => {
    if (!item || typeof item !== 'object') return '';
    const author = item.author || item.from || item.user;
    if (author && typeof author === 'object') return asString(author.name || author.username || author.displayName);
    return '';
  });
}

function metadataPageName(metadata: any): string {
  return walkJson(metadata, (item) => {
    if (!item || typeof item !== 'object') return '';
    if (item.page && typeof item.page === 'object') {
      return asString(item.page.name || item.page.username || item.page.displayName);
    }
    if (item.account && typeof item.account === 'object') {
      return asString(item.account.name || item.account.username || item.account.displayName || item.account.accountName);
    }
    return asString(item.pageName || item.page_name || item.accountName || item.account_name);
  });
}

function metadataIsReply(metadata: any): boolean {
  return walkJson(metadata, (item) => item && typeof item === 'object' && item.isReply === true) === 'true';
}

function looksLikeGeneratedReply(text: string): boolean {
  const clean = normalizeLoopText(text);
  if (!clean) return false;
  return [
    'claro te paso la informacion del producto',
    'para darte el precio',
    'te confirmamos precio y disponibilidad',
    'hola logihub',
    'hola codemorf',
    'hola ecomarket',
    'cualquier duda sigo por aqui',
    'https auth allsender tech r',
  ].some((pattern) => clean.includes(pattern));
}

function textLooksSimilar(left: string, right: string): boolean {
  const a = normalizeLoopText(left);
  const b = normalizeLoopText(right);
  if (!a || !b || Math.min(a.length, b.length) < 20) return false;
  if (a === b) return true;
  if (a.length > 35 && b.length > 35 && (a.includes(b) || b.includes(a))) return true;
  const aTokens = new Set(a.split(' ').filter((word) => word.length > 3));
  const bTokens = new Set(b.split(' ').filter((word) => word.length > 3));
  if (aTokens.size < 4 || bTokens.size < 4) return false;
  let common = 0;
  for (const token of aTokens) if (bTokens.has(token)) common += 1;
  return common / Math.min(aTokens.size, bTokens.size) >= 0.82;
}

function normalizePlatform(value: unknown): string {
  const platform = asString(value, 'zernio').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (platform === 'twitter') return 'x';
  return platform || 'zernio';
}

function normalizeAlgorithm(value: unknown): CommentAlgorithm {
  const raw = asString(value, 'whatsapp_direct').toLowerCase();
  if (['product', 'products', 'product_link', 'tienda', 'web'].includes(raw)) return 'product_link';
  if (['smart', 'smart_ai', 'ai', 'intelligent', 'conversacional'].includes(raw)) return 'smart_ai';
  return 'whatsapp_direct';
}

function safeSlug(input: string) {
  return String(input || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || crypto.randomBytes(4).toString('hex');
}

function currentBaseUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.BASE_URL || process.env.APP_URL || 'https://auth.allsender.tech').replace(/\/+$/, '');
}

function currentShortBaseUrl() {
  // Dominio corto opcional. Si configuras NEXT_PUBLIC_SHORT_LINK_BASE_URL=https://tu.dominio
  // los links saldrán como https://tu.dominio/r/xxxxx. Si no, usa el dominio actual.
  return String(process.env.NEXT_PUBLIC_SHORT_LINK_BASE_URL || process.env.SHORT_LINK_BASE_URL || currentBaseUrl()).replace(/\/+$/, '');
}

function compactShortSlug(teamId: number, slugHint: string) {
  const cleaned = safeSlug(slugHint || '');
  const generic = !cleaned || /^(wa|whatsapp|comentarios|comentario|link|cliente)(-|$)/i.test(cleaned) || cleaned.length > 24;
  if (generic) return `w${Number(teamId || 0).toString(36)}${crypto.randomBytes(3).toString('hex')}`.slice(0, 9);
  return cleaned.slice(0, 24);
}

function whatsappUrl(phone: string, message: string) {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  return `https://wa.me/${digits}?text=${encodeURIComponent(message || 'Hola, quiero información.')}`;
}

export async function ensureComentariosIaSqlReady() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS marketing_ai_comment_settings (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      is_enabled BOOLEAN NOT NULL DEFAULT true,
      mode VARCHAR(60) NOT NULL DEFAULT 'automatic',
      base_instructions TEXT NULL,
      auto_dm BOOLEAN NOT NULL DEFAULT false,
      auto_reply_public BOOLEAN NOT NULL DEFAULT true,
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

    CREATE TABLE IF NOT EXISTS short_links (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      slug VARCHAR(120) NOT NULL,
      title VARCHAR(180) NULL,
      destination_url TEXT NOT NULL,
      channel VARCHAR(80) NULL DEFAULT 'comentarios-ia',
      clicks INTEGER NOT NULL DEFAULT 0,
      leads INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(team_id, slug)
    );

    CREATE TABLE IF NOT EXISTS short_link_clicks (
      id SERIAL PRIMARY KEY,
      team_id INTEGER NOT NULL,
      link_id INTEGER NULL,
      ip_hash VARCHAR(120) NULL,
      user_agent TEXT NULL,
      referer TEXT NULL,
      channel VARCHAR(80) NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS autopublicar_cron_tokens (
      id SERIAL PRIMARY KEY,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      label VARCHAR(120) NOT NULL DEFAULT 'aaPanel Autopublicar',
      is_active BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS algorithm VARCHAR(80) NOT NULL DEFAULT 'whatsapp_direct';
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(40) NULL;
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS default_whatsapp_message TEXT NOT NULL DEFAULT 'Hola, vengo desde redes sociales y quiero información.';
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS short_links_enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS product_feed_enabled BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS tone VARCHAR(80) NOT NULL DEFAULT 'vendedor';
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'es';
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS business_prompt TEXT NULL;
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS fallback_to_whatsapp BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS blocked_words TEXT[] NOT NULL DEFAULT ARRAY['spam','estafa','fraude','abogado','demanda'];
    ALTER TABLE marketing_ai_comment_settings ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE marketing_ai_comment_settings ALTER COLUMN is_enabled SET DEFAULT true;
    ALTER TABLE marketing_ai_comment_settings ALTER COLUMN mode SET DEFAULT 'automatic';
    ALTER TABLE marketing_ai_comment_settings ALTER COLUMN auto_reply_public SET DEFAULT true;
    ALTER TABLE marketing_ai_comment_settings ALTER COLUMN approval_required SET DEFAULT false;

    CREATE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_team_status ON marketing_ai_comment_logs(team_id, status, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_marketing_ai_comment_logs_unique_external ON marketing_ai_comment_logs(team_id, platform, external_comment_id) WHERE external_comment_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_short_links_team_slug ON short_links(team_id, slug);
    ALTER TABLE short_link_clicks ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(120) NULL;
    ALTER TABLE short_link_clicks ADD COLUMN IF NOT EXISTS is_unique BOOLEAN NOT NULL DEFAULT true;
    ALTER TABLE short_link_clicks ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE short_link_clicks ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
    CREATE INDEX IF NOT EXISTS idx_short_link_clicks_real_dedupe ON short_link_clicks(team_id, link_id, fingerprint, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_short_link_clicks_team_channel_real ON short_link_clicks(team_id, channel, is_unique, is_bot, created_at DESC);
  `);
}

function planFromName(name: string | null | undefined): 'basic' | 'pro' | 'agency' {
  const raw = asString(name, 'basic').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/(agency|agencia|enterprise|empresa|premium|full|360|ultimate|max|completo|complete|todo|ia)/.test(raw)) return 'agency';
  if (/(pro|profesional|business|negocio|ventas|growth|plus)/.test(raw)) return 'pro';
  return 'basic';
}

export async function getCommentPlanLimits(teamId: number) {
  const rows = await sql.unsafe(`SELECT COALESCE(plan_name, subscription_status, 'basic') AS plan_name FROM teams WHERE id = $1 LIMIT 1`, [teamId]).catch(() => []);
  const planName = asString(rows?.[0]?.plan_name, 'basic');
  const planCode = planFromName(planName);
  const allowProduct = planCode !== 'basic';
  const allowSmartAi = planCode === 'agency';
  return {
    planCode,
    planName,
    upgradeUrl: '/es/pricing',
    limits: {
      allowWhatsappDirect: true,
      allowProductLink: allowProduct,
      allowSmartAi,
      allowAutoReply: planCode !== 'basic',
      allowShortLinks: true,
      maxCommentsPerMonth: planCode === 'agency' ? 0 : planCode === 'pro' ? 1000 : 200,
    },
    featureLocks: [
      { feature: 'product_link', locked: !allowProduct, reason: 'Respuesta con producto requiere plan Pro o superior.', upgradeUrl: '/es/pricing' },
      { feature: 'smart_ai', locked: !allowSmartAi, reason: 'IA conversacional requiere plan IA/Premium.', upgradeUrl: '/es/pricing' },
      { feature: 'auto_reply', locked: planCode === 'basic', reason: 'Respuesta automática requiere plan Pro o superior.', upgradeUrl: '/es/pricing' },
    ],
  };
}

function mapSettings(row: any) {
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    enabled: Boolean(row.is_enabled),
    mode: asString(row.mode, 'manual_review'),
    algorithm: normalizeAlgorithm(row.algorithm),
    whatsappNumber: row.whatsapp_number || '',
    defaultWhatsappMessage: asString(row.default_whatsapp_message, 'Hola, vengo desde redes sociales y quiero información.'),
    shortLinksEnabled: Boolean(row.short_links_enabled),
    productFeedEnabled: Boolean(row.product_feed_enabled),
    approvalRequired: Boolean(row.approval_required),
    autoDm: Boolean(row.auto_dm),
    autoReplyPublic: Boolean(row.auto_reply_public),
    tone: asString(row.tone, 'vendedor'),
    language: asString(row.language, 'es'),
    businessPrompt: row.business_prompt || row.base_instructions || '',
    baseInstructions: row.base_instructions || '',
    fallbackToWhatsapp: Boolean(row.fallback_to_whatsapp),
    blockedWords: Array.isArray(row.blocked_words) ? row.blocked_words : [],
    metadata: parseJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getCommentSettings(teamId: number) {
  await ensureComentariosIaSqlReady();
  const [row] = await sql.unsafe(
    `INSERT INTO marketing_ai_comment_settings (team_id, is_enabled, mode, approval_required, auto_reply_public)
     VALUES ($1, true, 'automatic', false, true)
     ON CONFLICT (team_id) DO UPDATE SET team_id = EXCLUDED.team_id
     RETURNING *`,
    [teamId]
  );
  return mapSettings(row);
}

export async function updateCommentSettings(teamId: number, body: any) {
  await ensureComentariosIaSqlReady();
  const current = await getCommentSettings(teamId);
  const desiredAlgorithm = normalizeAlgorithm(body?.algorithm || current.algorithm);
  const plan = await getCommentPlanLimits(teamId);
  const algorithm = desiredAlgorithm === 'smart_ai' && !plan.limits.allowSmartAi
    ? current.algorithm
    : desiredAlgorithm === 'product_link' && !plan.limits.allowProductLink
      ? current.algorithm
      : desiredAlgorithm;
  const [row] = await sql.unsafe(
    `UPDATE marketing_ai_comment_settings
     SET is_enabled = $2, mode = $3, algorithm = $4, whatsapp_number = $5, default_whatsapp_message = $6,
         short_links_enabled = $7, product_feed_enabled = $8, approval_required = $9, auto_dm = $10,
         auto_reply_public = $11, tone = $12, language = $13, business_prompt = $14, base_instructions = $15,
         fallback_to_whatsapp = $16, blocked_words = $17, metadata = COALESCE(metadata, '{}'::jsonb) || $18::jsonb, updated_at = NOW()
     WHERE team_id = $1 RETURNING *`,
    [
      teamId,
      typeof body?.enabled === 'boolean' ? body.enabled : current.enabled,
      asString(body?.mode, current.mode),
      algorithm,
      body?.whatsappNumber ?? current.whatsappNumber,
      asString(body?.defaultWhatsappMessage, current.defaultWhatsappMessage),
      typeof body?.shortLinksEnabled === 'boolean' ? body.shortLinksEnabled : current.shortLinksEnabled,
      typeof body?.productFeedEnabled === 'boolean' ? body.productFeedEnabled : current.productFeedEnabled,
      typeof body?.approvalRequired === 'boolean' ? body.approvalRequired : current.approvalRequired,
      typeof body?.autoDm === 'boolean' ? body.autoDm : current.autoDm,
      typeof body?.autoReplyPublic === 'boolean' ? body.autoReplyPublic : current.autoReplyPublic,
      asString(body?.tone, current.tone),
      asString(body?.language, current.language),
      body?.businessPrompt ?? current.businessPrompt,
      body?.baseInstructions ?? current.baseInstructions,
      typeof body?.fallbackToWhatsapp === 'boolean' ? body.fallbackToWhatsapp : current.fallbackToWhatsapp,
      Array.isArray(body?.blockedWords) ? body.blockedWords : current.blockedWords,
      JSON.stringify(parseJsonObject(body?.metadata)),
    ]
  );
  return mapSettings(row);
}

function mapComment(row: any) {
  return {
    id: Number(row.id),
    teamId: Number(row.team_id),
    platform: normalizePlatform(row.platform),
    provider: asString(row.provider, 'zernio'),
    accountId: row.account_id || null,
    externalCommentId: row.external_comment_id || null,
    externalPostId: row.external_post_id || null,
    authorUsername: row.author_username || null,
    commentText: asString(row.comment_text),
    aiReply: row.ai_reply || null,
    action: asString(row.action, 'pending'),
    status: asString(row.status, 'pending'),
    metadata: parseJsonObject(row.metadata),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function markSelfReplyLoopGuard(row: any, reason: string, details: Record<string, any> = {}) {
  const [updated] = await sql.unsafe(
    `UPDATE marketing_ai_comment_logs
        SET status = 'ignored',
            action = 'self_reply_loop_guard',
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE team_id = $1 AND id = $2
      RETURNING *`,
    [
      Number(row.team_id),
      Number(row.id),
      JSON.stringify({
        antiLoop: true,
        reason,
        checkedAt: new Date().toISOString(),
        ...details,
      }),
    ]
  );
  return updated || row;
}

export async function isSelfOrLoopComment(row: any) {
  const metadata = parseJsonAny(row?.metadata || {});
  const status = asString(row?.status).toLowerCase();
  const action = asString(row?.action).toLowerCase();
  const commentText = asString(row?.comment_text || row?.commentText);
  const platformPostId = asString(row?.external_post_id || row?.externalPostId || metadataPlatformPostId(metadata));
  const pageId = pageIdFromPlatformPostId(platformPostId);
  const authorId = metadataAuthorId(metadata);
  const authorName = metadataAuthorName(metadata);
  const pageName = metadataPageName(metadata);
  const replyEvent = metadataIsReply(metadata);
  const externalCommentId = asString(row?.external_comment_id || row?.externalCommentId || metadataCommentId(metadata));

  if (['answered', 'ignored'].includes(status) || action === 'public_reply_sent' || action === 'private_reply_sent') {
    return { block: true, reason: 'already_processed', shouldUpdate: false, platformPostId, pageId, authorId, authorName, externalCommentId };
  }

  if (replyEvent && pageId && authorId && pageId === authorId) {
    return { block: true, reason: 'page_reply_event', shouldUpdate: true, platformPostId, pageId, authorId, authorName, externalCommentId };
  }

  if (pageId && authorId && pageId === authorId) {
    return { block: true, reason: 'author_is_page', shouldUpdate: true, platformPostId, pageId, authorId, authorName, externalCommentId };
  }

  if (looksLikeGeneratedReply(commentText)) {
    return { block: true, reason: 'looks_like_ai_reply', shouldUpdate: true, platformPostId, pageId, authorId, authorName, externalCommentId };
  }

  if (row?.team_id && row?.id && commentText) {
    const previous = await sql.unsafe(
      `SELECT id, ai_reply
         FROM marketing_ai_comment_logs
        WHERE team_id = $1
          AND id <> $2
          AND ai_reply IS NOT NULL
          AND TRIM(ai_reply) <> ''
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 80`,
      [Number(row.team_id), Number(row.id)]
    ).catch(() => []);
    const matched = previous.find((item: any) => textLooksSimilar(commentText, item.ai_reply));
    if (matched) {
      return { block: true, reason: 'comment_matches_previous_ai_reply', shouldUpdate: true, matchedLogId: matched.id, platformPostId, pageId, authorId, authorName, externalCommentId };
    }
  }

  return { block: false, reason: 'customer_comment', shouldUpdate: false, platformPostId, pageId, authorId, authorName, externalCommentId };
}

export async function guardCommentLogBeforeReply(row: any) {
  const guard = await isSelfOrLoopComment(row);
  if (!guard.block || !guard.shouldUpdate) return { guard, row };
  const updated = await markSelfReplyLoopGuard(row, guard.reason, guard);
  return { guard, row: updated };
}

export async function guardPendingCommentLoops(limit = 80) {
  await ensureComentariosIaSqlReady();
  const rows = await sql.unsafe(
    `SELECT *
       FROM marketing_ai_comment_logs
      WHERE status IN ('received','pending','generated','approved','pending_connection','needs_setup','failed')
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT $1`,
    [Math.min(150, Math.max(1, Number(limit || 80)))]
  );
  let ignored = 0;
  const items: any[] = [];
  for (const row of rows) {
    const result = await guardCommentLogBeforeReply(row);
    if (result.guard.block && result.guard.shouldUpdate) ignored += 1;
    items.push({ id: row.id, ignored: result.guard.block && result.guard.shouldUpdate, reason: result.guard.reason });
  }
  return { checked: rows.length, ignored, items };
}

export async function listComments(teamId: number, query: URLSearchParams) {
  await ensureComentariosIaSqlReady();
  const page = Math.max(1, Number(query.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(query.get('limit') || 20)));
  const offset = (page - 1) * limit;
  const status = asString(query.get('status'));
  const platform = normalizePlatform(query.get('platform') || '');
  const where: string[] = ['team_id = $1'];
  const args: any[] = [teamId];
  if (status) { args.push(status); where.push(`status = $${args.length}`); }
  if (platform && platform !== 'zernio') { args.push(platform); where.push(`lower(platform) = $${args.length}`); }
  args.push(limit, offset);
  const rows = await sql.unsafe(`SELECT * FROM marketing_ai_comment_logs WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args);
  const countRows = await sql.unsafe(`SELECT COUNT(*)::int AS total FROM marketing_ai_comment_logs WHERE ${where.join(' AND ')}`, args.slice(0, -2));
  const total = Number(countRows?.[0]?.total || 0);
  return { comments: rows.map(mapComment), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } };
}

export async function getCommentStats(teamId: number) {
  await ensureComentariosIaSqlReady();
  const rows = await sql.unsafe(
    `SELECT status, COUNT(*)::int AS total FROM marketing_ai_comment_logs WHERE team_id = $1 GROUP BY status`,
    [teamId]
  );
  const base: Record<string, number> = { received: 0, pending: 0, generated: 0, approved: 0, answered: 0, ignored: 0, needs_human: 0, failed: 0 };
  for (const row of rows) base[asString(row.status, 'pending')] = Number(row.total || 0);
  const clicks = await sql.unsafe(`SELECT COALESCE(SUM(clicks), 0)::int AS clicks FROM short_links WHERE team_id = $1 AND channel = 'comentarios-ia'`, [teamId]).catch(() => [{ clicks: 0 }]);
  const rawClicks = await sql.unsafe(
    `SELECT COUNT(*)::int AS raw_clicks
       FROM short_link_clicks
      WHERE team_id = $1 AND channel = 'comentarios-ia'`,
    [teamId]
  ).catch(() => [{ raw_clicks: 0 }]);
  return {
    ...base,
    total: Object.values(base).reduce((a, b) => a + b, 0),
    linkClicks: Number(clicks?.[0]?.clicks || 0),
    rawLinkClicks: Number(rawClicks?.[0]?.raw_clicks || 0),
  };
}

export async function createShortLink(teamId: number, userId: number | null, destinationUrl: string, slugHint: string, title = 'Link Comentarios IA') {
  await ensureComentariosIaSqlReady();
  const destination = asString(destinationUrl);
  if (!/^https?:\/\//i.test(destination)) throw new Error('URL destino inválida.');

  const requestedSlug = compactShortSlug(teamId, slugHint || title || 'comentario');
  const compactMode = requestedSlug.startsWith(`w${Number(teamId || 0).toString(36)}`);

  for (let i = 0; i < 12; i += 1) {
    const candidate = compactMode
      ? `w${Number(teamId || 0).toString(36)}${crypto.randomBytes(3).toString('hex')}`.slice(0, 9)
      : (i ? `${requestedSlug}-${i + 1}` : requestedSlug);

    const existingGlobal = await sql.unsafe(
      `SELECT id, team_id FROM short_links WHERE slug = $1 AND COALESCE(is_active, true) = true LIMIT 1`,
      [candidate]
    ).catch(() => []);

    // La ruta pública resuelve solo por slug. Evitamos colisiones globales entre clientes.
    if (existingGlobal?.[0] && Number(existingGlobal[0].team_id) !== Number(teamId)) continue;

    try {
      const [row] = await sql.unsafe(
        `INSERT INTO short_links (team_id, user_id, slug, title, destination_url, channel, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'comentarios-ia', $6::jsonb, NOW(), NOW())
         ON CONFLICT (team_id, slug) DO UPDATE SET destination_url = EXCLUDED.destination_url, title = EXCLUDED.title, is_active = true, updated_at = NOW()
         RETURNING *`,
        [teamId, userId, candidate, title, destination, JSON.stringify({ source: 'comentarios-ia', compact: true })]
      );
      return { slug: row.slug, shortUrl: `${currentShortBaseUrl()}/r/${row.slug}`, destinationUrl: row.destination_url };
    } catch (error) {
      if (i === 11) throw error;
    }
  }
  throw new Error('No se pudo crear link corto.');
}

export async function findShortLinkBySlug(slug: string) {
  await ensureComentariosIaSqlReady();
  const rows = await sql.unsafe(`SELECT * FROM short_links WHERE slug = $1 AND is_active = true ORDER BY updated_at DESC LIMIT 1`, [slug]);
  return rows?.[0] || null;
}

function isPreviewOrBotRequest(request: Request) {
  const ua = asString(request.headers.get('user-agent')).toLowerCase();
  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''} ${request.headers.get('x-purpose') || ''}`.toLowerCase();
  if (/prefetch|preview|prerender/.test(purpose)) return true;
  return /(bot|crawler|spider|facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|slackbot|linkedinbot|pinterest|discordbot|embedly|preview)/i.test(ua);
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  return forwarded.split(',')[0]?.trim() || request.headers.get('x-real-ip') || request.headers.get('cf-connecting-ip') || '';
}

export async function trackShortLinkClick(link: any, request: Request) {
  await ensureComentariosIaSqlReady();
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') || '';
  const referer = request.headers.get('referer') || null;
  const lang = request.headers.get('accept-language') || '';
  const ipHash = ip ? crypto.createHash('sha256').update(ip).digest('hex').slice(0, 64) : null;
  const fingerprint = crypto.createHash('sha256').update(`${ip || 'no-ip'}|${userAgent}|${lang}|${link.id}`).digest('hex').slice(0, 64);
  const isBot = isPreviewOrBotRequest(request);

  let isUnique = false;
  if (!isBot) {
    const recent = await sql.unsafe(
      `SELECT id FROM short_link_clicks
        WHERE team_id = $1
          AND link_id = $2
          AND fingerprint = $3
          AND COALESCE(is_bot, false) = false
          AND COALESCE(is_unique, false) = true
          AND created_at > NOW() - INTERVAL '30 minutes'
        LIMIT 1`,
      [link.team_id, link.id, fingerprint]
    ).catch(() => []);
    isUnique = !recent?.[0];
  }

  await sql.unsafe(
    `INSERT INTO short_link_clicks (team_id, link_id, ip_hash, user_agent, referer, channel, fingerprint, is_unique, is_bot, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, 'comentarios-ia', $6, $7, $8, $9::jsonb, NOW())`,
    [
      link.team_id,
      link.id,
      ipHash,
      userAgent || null,
      referer,
      fingerprint,
      isUnique,
      isBot,
      JSON.stringify({ realClick: isUnique, ignoredReason: isBot ? 'bot_or_preview' : isUnique ? null : 'duplicate_30m' }),
    ]
  ).catch(() => null);

  if (isUnique) {
    await sql.unsafe(`UPDATE short_links SET clicks = COALESCE(clicks, 0) + 1, updated_at = NOW() WHERE id = $1`, [link.id]).catch(() => null);
  }
}

export async function resetCommentShortLinkClicks(teamId: number) {
  await ensureComentariosIaSqlReady();
  const linkRows = await sql.unsafe(
    `SELECT id FROM short_links WHERE team_id = $1 AND channel = 'comentarios-ia'`,
    [teamId]
  ).catch(() => []);
  const linkIds = linkRows.map((row: any) => Number(row.id)).filter(Boolean);

  await sql.unsafe(
    `UPDATE short_links
        SET clicks = 0,
            leads = 0,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('clicks_reset_at', NOW()),
            updated_at = NOW()
      WHERE team_id = $1 AND channel = 'comentarios-ia'`,
    [teamId]
  ).catch(() => null);

  if (linkIds.length) {
    await sql.unsafe(
      `DELETE FROM short_link_clicks WHERE team_id = $1 AND link_id = ANY($2::int[])`,
      [teamId, linkIds]
    ).catch(() => null);
  } else {
    await sql.unsafe(`DELETE FROM short_link_clicks WHERE team_id = $1 AND channel = 'comentarios-ia'`, [teamId]).catch(() => null);
  }

  return { status: true, reset: true, linkClicks: 0, links: linkIds.length };
}

function tokenize(text: string) {
  return asString(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
}

export async function matchProductForComment(teamId: number, body: any) {
  await ensureComentariosIaSqlReady();
  const text = `${asString(body?.commentText)} ${asString(body?.postText)}`;
  const terms = new Set(tokenize(text));
  const rows = await sql.unsafe(
    `SELECT id, sku, name, description, category, price, currency, image_url, stock, metadata
       FROM ai_sales_products
      WHERE team_id = $1 AND COALESCE(is_active, true) = true
      ORDER BY updated_at DESC LIMIT 200`,
    [teamId]
  ).catch(() => []);
  let best: any = null;
  let bestScore = 0;
  for (const row of rows) {
    const haystack = tokenize(`${row.name || ''} ${row.sku || ''} ${row.description || ''} ${row.category || ''} ${JSON.stringify(row.metadata || {})}`);
    const score = haystack.reduce((sum, t) => sum + (terms.has(t) ? 1 : 0), 0) + (asString(row.name).toLowerCase() && text.toLowerCase().includes(asString(row.name).toLowerCase()) ? 5 : 0);
    if (score > bestScore) { bestScore = score; best = row; }
  }
  if (!best || bestScore < 1) return { ok: true, matched: false, confidence: 0 };
  const metadata = parseJsonObject(best.metadata);
  const url = asString(metadata.url || metadata.product_url || metadata.source_url || metadata.link || metadata.permalink);
  let shortUrl: string | null = null;
  if (url) {
    try { shortUrl = (await createShortLink(teamId, null, url, `prod-${best.sku || best.name}`, best.name)).shortUrl; } catch {}
  }
  return {
    ok: true,
    matched: true,
    confidence: Math.min(0.98, 0.45 + bestScore / 10),
    product: {
      id: Number(best.id), sku: best.sku, name: best.name, description: best.description, category: best.category,
      price: best.price === null || best.price === undefined ? null : Number(best.price), currency: best.currency || 'DOP',
      imageUrl: best.image_url || null, stock: best.stock === null || best.stock === undefined ? null : Number(best.stock), url: url || null, shortUrl,
    },
  };
}

async function generateWithGlobalAi(teamId: number, prompt: string) {
  // CodeMorf es el único proveedor autorizado para Comentarios IA. Si no
  // responde, el llamador usa una respuesta determinista segura; nunca se
  // consultan OpenAI, Gemini u OpenRouter como fallback silencioso.
  try {
    const result = await morfGenerate(
      {
        teamId,
        moduleCode: 'comments_ai',
        capability: 'text',
        messages: [
          { role: 'system', content: 'Responde como asistente de comentarios en redes sociales. Texto corto, natural, en español, sin inventar precios ni promesas.' },
          { role: 'user', content: prompt },
        ],
        metadata: { channel: 'social', feature: 'comments_ai_reply', provider_policy: 'codemorf_only' },
      },
      { timeoutMs: 8000 }
    );
    if (result.ok && result.text) {
      return result.text.replace(/^"|"$/g, '').trim() || null;
    }
    if (!result.ok) {
      console.warn('[comentarios-ia:codemorf-only] no disponible:', result.reason, result.message);
    }
  } catch (error: any) {
    console.warn('[comentarios-ia:codemorf-only] falló:', error?.message || error);
  }
  return null;
}

function detectIntent(text: string) {
  const lower = asString(text).toLowerCase();
  if (/(puta|mierda|estafa|ladron|ladr[oó]n|fraude|basura|demanda|abogado|spam)/i.test(lower)) return 'needs_human';
  if (/(precio|cu[aá]nto|cuanto|vale|costo|coste|price)/i.test(lower)) return 'price_request';
  if (/(disponible|stock|hay|tienen|queda)/i.test(lower)) return 'availability';
  if (/(quiero|comprar|ordenar|me interesa|lo quiero|pedido|link|enlace)/i.test(lower)) return 'purchase_intent';
  if (/(env[ií]o|delivery|domicilio|ubicaci[oó]n|d[oó]nde|donde|horario|ubicados|direccion|direcci[oó]n)/i.test(lower)) return 'logistics';
  if (/(gracias|excelente|bien|ok|perfecto|me gusta|interesante)/i.test(lower)) return 'engagement';
  return 'general';
}

function shortWhatsappCta(settings: any, intent: string) {
  const wa = whatsappUrl(settings.whatsappNumber, settings.defaultWhatsappMessage);
  if (!wa) return '';
  if (intent === 'price_request') return `Te confirmamos precio y disponibilidad aquí: ${wa}`;
  if (intent === 'logistics') return `Te damos ubicación/envío por WhatsApp aquí: ${wa}`;
  if (intent === 'purchase_intent') return `Te atendemos y cerramos tu pedido aquí: ${wa}`;
  return `Escríbenos por WhatsApp y te ayudamos aquí: ${wa}`;
}

function conversationalFallbackReply(settings: any, commentText: string, productMatch?: any, authorUsername?: string | null) {
  const intent = detectIntent(commentText);
  const name = asString(authorUsername).replace(/^@/, '').split(/[\s._-]+/)[0];
  const hi = name && name.length > 2 ? `Hola ${name} 👋` : 'Hola 👋';
  if (intent === 'needs_human') return { reply: '', action: 'needs_human', needsHuman: true, intent };

  if (productMatch?.matched && productMatch?.product) {
    const p = productMatch.product;
    const price = p.price ? ` Precio: ${p.currency || 'DOP'} ${p.price}.` : '';
    const stock = p.stock !== null && p.stock !== undefined ? ` ${p.stock > 0 ? 'Está disponible ✅' : 'Déjanos confirmar disponibilidad.'}` : '';
    const link = p.shortUrl ? ` Puedes verlo aquí: ${p.shortUrl}` : '';
    const intro = intent === 'price_request'
      ? `${hi}, claro, te paso la información del producto.`
      : intent === 'availability'
        ? `${hi}, sí, revisamos disponibilidad para ti.`
        : intent === 'purchase_intent'
          ? `${hi}, perfecto, te ayudo con ese producto.`
          : `${hi}, gracias por escribirnos.`;
    return { reply: `${intro} ${p.name}.${price}${stock}${link}`.replace(/\s+/g, ' ').trim(), action: 'reply_with_product', needsHuman: false, intent };
  }

  const cta = shortWhatsappCta(settings, intent);
  if (cta) {
    const textByIntent: Record<string, string> = {
      price_request: `${hi}, claro. Para darte el precio exacto y disponibilidad actual, ${cta}`,
      availability: `${hi}, con gusto. ${cta}`,
      purchase_intent: `${hi}, perfecto. ${cta}`,
      logistics: `${hi}, sí, podemos ayudarte con esa información. ${cta}`,
      engagement: `${hi}, gracias por tu comentario 🙌`,
      general: `${hi}, gracias por escribirnos. ¿Buscas precio, disponibilidad o envío? ${cta}`,
    };
    return { reply: textByIntent[intent] || textByIntent.general, action: 'reply_with_whatsapp', needsHuman: false, intent };
  }

  const genericByIntent: Record<string, string> = {
    price_request: `${hi}, claro. Escríbenos y te confirmamos precio y disponibilidad.`,
    availability: `${hi}, con gusto revisamos disponibilidad para ti.`,
    purchase_intent: `${hi}, perfecto. Te ayudamos a completar tu pedido.`,
    logistics: `${hi}, podemos ayudarte con ubicación, horario o envío.`,
    engagement: `${hi}, gracias por tu comentario 🙌`,
    general: `${hi}, gracias por escribirnos. ¿Buscas precio, disponibilidad o envío?`,
  };
  return { reply: genericByIntent[intent] || genericByIntent.general, action: 'reply_basic', needsHuman: false, intent };
}

function isWeakAiReply(text: string) {
  const clean = asString(text).toLowerCase();
  if (!clean) return true;
  if (/^https?:\/\//.test(clean)) return true;
  if (clean.length < 18) return true;
  if (/^(link|enlace|whatsapp|wa)[:\s-]*https?:/i.test(clean)) return true;
  return false;
}

export async function generateReplyForComment(teamId: number, body: any) {
  await ensureComentariosIaSqlReady();
  const settings = await getCommentSettings(teamId);
  const commentId = Number(body?.commentId || 0);
  let comment: any = null;
  if (commentId) {
    const rows = await sql.unsafe(`SELECT * FROM marketing_ai_comment_logs WHERE team_id = $1 AND id = $2 LIMIT 1`, [teamId, commentId]);
    comment = rows?.[0] || null;
    if (comment) {
      const guarded = await guardCommentLogBeforeReply(comment);
      if (guarded.guard.block) {
        return {
          ok: false,
          status: false,
          code: 'SELF_REPLY_LOOP_GUARD',
          message: 'Respuesta propia ignorada.',
          comment: mapComment(guarded.row),
        };
      }
      comment = guarded.row;
    }
  }
  const commentText = asString(body?.commentText || comment?.comment_text);
  if (!commentText) return { ok: false, status: false, code: 'COMMENT_REQUIRED', message: 'Falta comentario.' };
  const plan = await getCommentPlanLimits(teamId);
  let algorithm = normalizeAlgorithm(body?.algorithm || settings.algorithm);
  // El módulo conversacional usa CodeMorf cuando el plan lo permite. No se
  // depende de una fila legacy de ai_configs para activar el comportamiento.
  if (algorithm === 'whatsapp_direct' && !body?.algorithm && settings.metadata?.forceWhatsappOnly !== true) {
    algorithm = 'smart_ai';
  }
  if (algorithm === 'smart_ai' && !plan.limits.allowSmartAi) algorithm = plan.limits.allowProductLink ? 'product_link' : 'whatsapp_direct';
  if (algorithm === 'product_link' && !plan.limits.allowProductLink) algorithm = 'whatsapp_direct';
  const productMatch: any = algorithm !== 'whatsapp_direct' && settings.productFeedEnabled ? await matchProductForComment(teamId, { commentText, postText: body?.postText || comment?.metadata?.postText || '' }) : { ok: true, matched: false, confidence: 0, product: null };
  const base = conversationalFallbackReply(settings, commentText, productMatch, body?.authorUsername || comment?.author_username || null);
  let reply = base.reply;
  let usedAi = false;
  if (algorithm === 'smart_ai' && !base.needsHuman) {
    const aiPrompt = [
      'Eres el community manager comercial de una tienda. Responde como humano, no como bot.',
      'Objetivo: contestar el comentario de forma útil y conversacional. No escribas solo un link.',
      'Reglas: máximo 2 frases cortas. Usa el link solo como CTA final cuando ayude. No inventes datos. Si falta dato, invita a WhatsApp con naturalidad.',
      'No uses frases repetidas tipo: gracias por escribirnos, para precio disponibilidad atención rápida. Varía la respuesta según el comentario.',
      `Tono: ${settings.tone}. Idioma: ${settings.language}.`,
      settings.businessPrompt ? `Negocio: ${settings.businessPrompt}` : '',
      `Comentario del cliente: ${commentText}`,
      productMatch?.matched ? `Producto detectado: ${JSON.stringify(productMatch.product)}` : 'Producto detectado: ninguno claro.',
      `Respuesta base permitida si la IA no mejora: ${base.reply}`,
      'Devuelve solo la respuesta final, sin comillas, sin explicación.'
    ].filter(Boolean).join('\n');
    const aiText = await generateWithGlobalAi(teamId, aiPrompt);
    if (aiText && !isWeakAiReply(aiText)) { reply = aiText.slice(0, 900); usedAi = true; }
  }
  if (settings.shortLinksEnabled && reply && settings.whatsappNumber && reply.includes('wa.me/')) {
    try {
      const wa = whatsappUrl(settings.whatsappNumber, settings.defaultWhatsappMessage);
      const short = await createShortLink(teamId, null, wa, `wa-${teamId}`, 'WhatsApp Comentarios IA');
      reply = reply.replace(wa, short.shortUrl);
    } catch {}
  }
  const result = { ok: true, status: true, reply, intent: base.intent, confidence: usedAi ? 0.92 : productMatch?.matched ? productMatch.confidence : 0.72, action: base.action, shortUrl: null, needsHuman: base.needsHuman, algorithm, usedAi, product: productMatch?.product || null };
  if (commentId) {
    await sql.unsafe(
      `UPDATE marketing_ai_comment_logs SET ai_reply = $3, action = $4, status = $5, metadata = COALESCE(metadata, '{}'::jsonb) || $6::jsonb, updated_at = NOW() WHERE team_id = $1 AND id = $2`,
      [teamId, commentId, reply || null, result.action, result.needsHuman ? 'needs_human' : 'generated', JSON.stringify({ generatedBy: usedAi ? 'global_ai' : 'fallback', intent: result.intent, algorithm, product: result.product })]
    );
  }
  return result;
}

async function getComment(teamId: number, id: number) {
  const rows = await sql.unsafe(`SELECT * FROM marketing_ai_comment_logs WHERE team_id = $1 AND id = $2 LIMIT 1`, [teamId, id]);
  return rows?.[0] || null;
}

export async function sendCommentReply(teamId: number, commentId: number, reply: string, mode: 'public' | 'private' = 'public') {
  await ensureComentariosIaSqlReady();
  const row = await getComment(teamId, commentId);
  if (!row) return { status: false, code: 'NOT_FOUND', message: 'Comentario no encontrado.' };
  const guarded = await guardCommentLogBeforeReply(row);
  if (guarded.guard.block) {
    return {
      status: false,
      code: 'SELF_REPLY_LOOP_GUARD',
      message: 'Respuesta propia ignorada.',
      comment: mapComment(guarded.row),
    };
  }
  const message = asString(reply || row.ai_reply);
  if (!message) return { status: false, code: 'REPLY_REQUIRED', message: 'Falta respuesta.' };

  const accountId = asString(row.account_id);
  const postId = asString(row.external_post_id);
  const commentExternalId = asString(row.external_comment_id);

  // Comentarios viejos o logs incompletos pueden traer texto, pero no los IDs necesarios
  // para responder en la red social. En ese caso NO marcamos como fallo de IA; queda claro
  // que falta dato de Zernio y el usuario puede regenerar/revisar sin perder la respuesta.
  if (!accountId || !postId || !commentExternalId) {
    const [updated] = await sql.unsafe(
      `UPDATE marketing_ai_comment_logs
          SET ai_reply = $3,
              status = 'needs_setup',
              action = 'reply_missing_zernio_ids',
              metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
              updated_at = NOW()
        WHERE team_id = $1 AND id = $2
        RETURNING *`,
      [teamId, commentId, message, JSON.stringify({ error: 'missing_account_post_or_comment', accountId: Boolean(accountId), postId: Boolean(postId), commentId: Boolean(commentExternalId) })]
    );
    return { status: false, code: 'MISSING_ZERNIO_IDS', message: 'Este comentario no trae los IDs de Zernio para responder en la red. Los comentarios nuevos sí deben traerlos.', comment: updated ? mapComment(updated) : null };
  }

  try {
    const result = mode === 'private'
      ? await zernioPost(`/v1/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentExternalId)}/private-reply`, { accountId, message })
      : await zernioPost(`/v1/inbox/comments/${encodeURIComponent(postId)}`, { accountId, commentId: commentExternalId, message });
    const [updated] = await sql.unsafe(
      `UPDATE marketing_ai_comment_logs SET ai_reply = $3, action = $4, status = 'answered', metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb, updated_at = NOW() WHERE team_id = $1 AND id = $2 RETURNING *`,
      [teamId, commentId, message, mode === 'private' ? 'private_reply_sent' : 'public_reply_sent', JSON.stringify({ zernioResult: result })]
    );
    await sql.unsafe(`INSERT INTO marketing_ai_event_logs (team_id, platform, provider, account_id, event_type, status, metadata, created_at, updated_at) VALUES ($1, $2, 'zernio', $3, 'comment.reply_sent', 'sent', $4::jsonb, NOW(), NOW())`, [teamId, row.platform, accountId, JSON.stringify({ commentId, mode })]).catch(() => null);
    return { status: true, comment: mapComment(updated), zernioResult: result };
  } catch (error: any) {
    const messageText = error?.message || 'No se pudo responder por Zernio.';
    const permissionIssue = /(permission|permiso|unauthorized|forbidden|token|access|scope|reconnect|401|403)/i.test(messageText) || [401, 403].includes(Number(error?.status || 0));
    await sql.unsafe(
      `UPDATE marketing_ai_comment_logs
          SET ai_reply = $3,
              status = 'failed',
              action = $4,
              metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
              updated_at = NOW()
        WHERE team_id = $1 AND id = $2`,
      [
        teamId,
        commentId,
        message,
        permissionIssue ? 'channel_permission_required' : 'reply_failed',
        JSON.stringify({
          error: messageText,
          status: error?.status || null,
          mode,
          error_type: permissionIssue ? 'reconnect_channel_required' : 'publish_failed',
          user_message: permissionIssue ? 'Requiere reconectar el canal' : 'No se pudo publicar la respuesta',
        }),
      ]
    );
    return { status: false, code: permissionIssue ? 'RECONNECT_CHANNEL_REQUIRED' : 'ZERNIO_REPLY_FAILED', message: permissionIssue ? 'Requiere reconectar el canal' : 'No se pudo publicar la respuesta' };
  }
}

export async function approveComment(teamId: number, commentId: number, body: any) {
  const reply = asString(body?.reply);
  if (!reply) return { status: false, code: 'REPLY_REQUIRED', message: 'Falta respuesta.' };
  await sql.unsafe(`UPDATE marketing_ai_comment_logs SET ai_reply = $3, status = 'approved', action = 'approved', updated_at = NOW() WHERE team_id = $1 AND id = $2`, [teamId, commentId, reply]);
  if (body?.sendNow) return sendCommentReply(teamId, commentId, reply, body?.privateReply ? 'private' : 'public');
  const row = await getComment(teamId, commentId);
  return { status: true, comment: row ? mapComment(row) : null };
}

export async function ignoreComment(teamId: number, commentId: number, body: any) {
  const [row] = await sql.unsafe(
    `UPDATE marketing_ai_comment_logs SET status = $3, action = $4, metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb, updated_at = NOW() WHERE team_id = $1 AND id = $2 RETURNING *`,
    [teamId, commentId, body?.needsHuman ? 'needs_human' : 'ignored', body?.needsHuman ? 'needs_human' : 'ignored', JSON.stringify({ reason: body?.reason || null })]
  );
  return row ? { status: true, comment: mapComment(row) } : { status: false, code: 'NOT_FOUND', message: 'Comentario no encontrado.' };
}

function validateCronToken(key: string) {
  const token = asString(key);
  if (!token) return false;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return sql.unsafe(`SELECT id FROM autopublicar_cron_tokens WHERE token_hash = $1 AND is_active = true AND (expires_at IS NULL OR expires_at > NOW()) LIMIT 1`, [hash]).then((r) => r.length > 0).catch(() => false);
}

export async function processPendingCommentsCron(key: string, limit: number) {
  await ensureComentariosIaSqlReady();
  if (!(await validateCronToken(key))) return { status: false, code: 'UNAUTHORIZED', message: 'Token inválido.' };
  const rows = await sql.unsafe(
    `SELECT c.*, s.is_enabled, s.mode, s.approval_required, s.auto_dm, s.auto_reply_public
       FROM marketing_ai_comment_logs c
       JOIN marketing_ai_comment_settings s ON s.team_id = c.team_id
      WHERE c.status IN ('received','pending','generated','approved') AND s.is_enabled = true
      ORDER BY c.created_at ASC LIMIT $1`,
    [Math.min(50, Math.max(1, limit || 10))]
  );
  const results: any[] = [];
  for (const row of rows) {
    const guarded = await guardCommentLogBeforeReply(row);
    if (guarded.guard.block) {
      results.push({ id: row.id, skipped: true, reason: guarded.guard.reason });
      continue;
    }
    const readyAccount = asString(row.account_id);
    const readyPost = asString(row.external_post_id);
    const readyComment = asString(row.external_comment_id);
    if (!readyAccount || !readyPost || !readyComment) {
      await sql.unsafe(
        `UPDATE marketing_ai_comment_logs
            SET status = 'pending_connection',
                action = 'waiting_channel_match',
                metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = NOW()
          WHERE team_id = $1 AND id = $2`,
        [Number(row.team_id), Number(row.id), JSON.stringify({ user_message: 'Conexion pendiente', missingIds: { accountId: !readyAccount, postId: !readyPost, commentId: !readyComment } })]
      ).catch(() => null);
      results.push({ id: row.id, skipped: true, reason: 'pending_connection' });
      continue;
    }
    const generated = row.ai_reply
      ? { status: true, reply: row.ai_reply, reused: true }
      : await generateReplyForComment(Number(row.team_id), { commentId: Number(row.id), commentText: row.comment_text }).catch((error: any) => ({ status: false, error: error?.message || String(error) }));

    if (!(generated as any).status || (generated as any).needsHuman) {
      results.push({ id: row.id, generated });
      continue;
    }

    const shouldSend = !row.approval_required && (row.mode === 'automatic' || row.auto_reply_public || row.auto_dm);
    if (shouldSend) {
      const sent = await sendCommentReply(Number(row.team_id), Number(row.id), (generated as any).reply, row.auto_dm ? 'private' : 'public');
      results.push({ id: row.id, generated, sent });
    } else {
      results.push({ id: row.id, generated, sent: false, reason: 'approval_required_or_manual_mode' });
    }
  }
  return { status: true, processed: results.length, results };
}
