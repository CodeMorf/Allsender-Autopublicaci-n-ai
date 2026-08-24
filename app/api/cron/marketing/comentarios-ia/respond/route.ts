import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import postgres from 'postgres';
import { guardPendingCommentLoops, processPendingCommentsCron } from '@/lib/marketing-comentarios-ia/service';

export const runtime = 'nodejs';

function asString(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalize(value: any): string {
  return asString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseMaybeJson(value: any): any {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function walk(value: any, callback: (item: any) => string | boolean | void, depth = 0): string {
  if (!value || depth > 8) return '';

  const parsed = parseMaybeJson(value);

  const result = callback(parsed);
  if (typeof result === 'string' && result) return result;
  if (result === true) return 'true';

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = walk(item, callback, depth + 1);
      if (found) return found;
    }
    return '';
  }

  if (typeof parsed === 'object') {
    for (const child of Object.values(parsed)) {
      const found = walk(child, callback, depth + 1);
      if (found) return found;
    }
  }

  return '';
}

function getAuthorId(metadata: any): string {
  return walk(metadata, (item) => {
    if (item && typeof item === 'object' && item.author && typeof item.author === 'object') {
      return asString(item.author.id || item.author.userId || item.author.externalId);
    }
  });
}

function getAuthorName(metadata: any): string {
  return walk(metadata, (item) => {
    if (item && typeof item === 'object' && item.author && typeof item.author === 'object') {
      return asString(item.author.name || item.author.username);
    }
  });
}

function getPlatformPostId(metadata: any): string {
  return walk(metadata, (item) => {
    if (item && typeof item === 'object') {
      return asString(item.platformPostId || item.platform_post_id);
    }
  });
}

function isReply(metadata: any): boolean {
  return walk(metadata, (item) => {
    if (item && typeof item === 'object' && item.isReply === true) return true;
  }) === 'true';
}

function pageIdFromPlatformPostId(platformPostId: string): string {
  const text = asString(platformPostId);
  if (!text.includes('_')) return '';
  return text.split('_')[0] || '';
}

function getDb() {
  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Database connection not configured');
  return postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10 });
}

async function tableExists(sql: any, table: string): Promise<boolean> {
  const rows = await sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=${table}
    ) AS ok
  `;
  return Boolean(rows?.[0]?.ok);
}

async function tokenAllowed(sql: any, request: NextRequest, key: string): Promise<boolean> {
  const direct = [
    process.env.CRON_SECRET,
    process.env.CAMPAIGN_CRON_SECRET,
    process.env.ZERNIO_SYNC_SECRET,
    process.env.AUTOPUBLICAR_CRON_TOKEN,
    process.env.COMENTARIOS_IA_CRON_TOKEN,
  ].map(asString).filter(Boolean);

  if (key && direct.includes(key)) return true;

  if (!key) return false;
  if (!(await tableExists(sql, 'autopublicar_cron_tokens'))) return false;

  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const rows = await sql.unsafe(
    `SELECT id
     FROM autopublicar_cron_tokens
     WHERE token_hash = $1
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())
     LIMIT 1`,
    [hash]
  ).catch(() => []);

  return rows.length > 0;
}

async function hasSamePreviousAiReply(sql: any, row: any): Promise<boolean> {
  const text = normalize(row.comment_text);
  if (!text || text.length < 20) return false;

  const rows = await sql.unsafe(
    `SELECT id
     FROM marketing_ai_comment_logs
     WHERE team_id = $1
       AND id <> $2
       AND ai_reply IS NOT NULL
       AND TRIM(ai_reply) <> ''
       AND LOWER(TRIM(ai_reply)) = LOWER(TRIM($3))
     LIMIT 1`,
    [row.team_id, row.id, row.comment_text]
  ).catch(() => []);

  return rows.length > 0;
}

async function guardSelfReplies(sql: any, limit: number) {
  if (!(await tableExists(sql, 'marketing_ai_comment_logs'))) {
    return { checked: 0, ignored: 0, items: [] };
  }

  const rows = await sql.unsafe(
    `SELECT id, team_id, platform, status, action, comment_text, ai_reply, metadata, updated_at
     FROM marketing_ai_comment_logs
     WHERE status IN ('pending', 'generated', 'approved', 'pending_connection', 'needs_setup', 'failed')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  let ignored = 0;
  const items: any[] = [];

  for (const row of rows) {
    const metadata = row.metadata || {};
    const platformPostId = getPlatformPostId(metadata);
    const pageId = pageIdFromPlatformPostId(platformPostId);
    const authorId = getAuthorId(metadata);
    const authorName = getAuthorName(metadata);
    const replyEvent = isReply(metadata);
    const sameAiReply = await hasSamePreviousAiReply(sql, row);

    const ownAuthor = Boolean(pageId && authorId && pageId === authorId);
    const shouldIgnore =
      ownAuthor ||
      sameAiReply ||
      (replyEvent && sameAiReply);

    if (!shouldIgnore) {
      items.push({
        id: row.id,
        ok: true,
        ignored: false,
        reason: 'customer_comment',
        authorId,
        pageId,
        isReply: replyEvent,
      });
      continue;
    }

    await sql.unsafe(
      `UPDATE marketing_ai_comment_logs
       SET status = 'ignored',
           action = 'self_reply_loop_guard',
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        row.id,
        JSON.stringify({
          antiLoop: true,
          ignoredAt: new Date().toISOString(),
          reason: ownAuthor ? 'author_is_page' : 'comment_matches_previous_ai_reply',
          authorId,
          authorName,
          pageId,
          platformPostId,
          isReply: replyEvent,
        }),
      ]
    );

    ignored += 1;
    items.push({
      id: row.id,
      ignored: true,
      reason: ownAuthor ? 'author_is_page' : 'comment_matches_previous_ai_reply',
      authorId,
      authorName,
      pageId,
      isReply: replyEvent,
    });
  }

  return { checked: rows.length, ignored, items };
}

export async function GET(request: NextRequest) {
  const sql = getDb();

  try {
    const key =
      request.nextUrl.searchParams.get('key') ||
      request.nextUrl.searchParams.get('secret') ||
      request.headers.get('x-cron-secret') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
      '';

    if (!(await tokenAllowed(sql, request, key))) {
      return NextResponse.json({ status: false, message: 'No autorizado.' }, { status: 401 });
    }

    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 60), 1), 150);
    const safeOnly = request.nextUrl.searchParams.get('safeOnly') === '1';

    const guard = await guardPendingCommentLoops(limit);

    if (safeOnly) {
      return NextResponse.json({
        status: true,
        safeOnly: true,
        guard,
        message: 'Protección anti-loop validada.',
      });
    }

    const result = await processPendingCommentsCron(key, limit);

    return NextResponse.json({
      status: true,
      guard,
      result,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        status: false,
        message: 'No pudimos procesar comentarios automáticamente.',
        detail: error?.message || String(error),
      },
      { status: 500 }
    );
  } finally {
    await sql.end().catch(() => null);
  }
}

export const POST = GET;
