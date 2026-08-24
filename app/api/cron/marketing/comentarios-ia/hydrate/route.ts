import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import postgres from 'postgres';

export const runtime = 'nodejs';

type AnyRecord = Record<string, any>;

function asString(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function q(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function parseMaybeJson(value: any): any {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  if (!(text.startsWith('{') || text.startsWith('['))) return value;

  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function findDeep(value: any, keys: string[], depth = 0): string {
  if (!value || depth > 8) return '';

  const parsed = parseMaybeJson(value);

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findDeep(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }

  if (typeof parsed !== 'object') return '';

  for (const key of keys) {
    const direct = parsed[key];
    if (asString(direct)) return asString(direct);
  }

  for (const child of Object.values(parsed)) {
    const found = findDeep(child, keys, depth + 1);
    if (found) return found;
  }

  return '';
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
      WHERE table_schema = 'public' AND table_name = ${table}
    ) AS ok
  `;
  return Boolean(rows?.[0]?.ok);
}

async function columns(sql: any, table: string): Promise<string[]> {
  const rows = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
  return rows.map((row: any) => row.column_name);
}

async function tokenAllowed(sql: any, request: NextRequest): Promise<boolean> {
  const key =
    request.nextUrl.searchParams.get('key') ||
    request.nextUrl.searchParams.get('secret') ||
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';

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

function getFromRowOrMeta(row: AnyRecord, rowKeys: string[], metaKeys: string[]): string {
  for (const key of rowKeys) {
    if (asString(row[key])) return asString(row[key]);
  }

  return findDeep(row.metadata, metaKeys);
}

function pageIdFromPlatformPostId(platformPostId: string): string {
  const text = asString(platformPostId);
  return text.includes('_') ? asString(text.split('_')[0]) : '';
}

function authorIdFromMeta(metadata: any): string {
  const parsed = parseMaybeJson(metadata);
  const payload = parsed?.payload || parsed?.data || parsed;
  const author = payload?.comment?.author || payload?.author || payload?.from || payload?.user || {};
  return asString(author?.id || author?.userId || author?.externalId) || findDeep(metadata, ['authorId', 'author_id', 'userId', 'user_id']);
}

function isReplyFromMeta(metadata: any): boolean {
  const value = findDeep(metadata, ['isReply', 'is_reply']);
  return value === 'true';
}

async function getConnectedAccount(sql: any, teamId: any, platform: string): Promise<string> {
  if (!(await tableExists(sql, 'zernio_connections'))) return '';

  const rows = await sql.unsafe(
    `SELECT zernio_account_id, platform, status
     FROM zernio_connections
     WHERE team_id::text = $1::text
       AND COALESCE(zernio_account_id, '') <> ''
       AND LOWER(COALESCE(platform, '')) = LOWER($2)
       AND LOWER(COALESCE(status, '')) IN ('connected', 'active', 'ok')
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [String(teamId), platform || 'facebook']
  ).catch(() => []);

  return asString(rows?.[0]?.zernio_account_id);
}

async function hydrateRows(sql: any, limit: number) {
  const table = 'marketing_ai_comment_logs';

  if (!(await tableExists(sql, table))) {
    return { processed: 0, hydrated: 0, skipped: 0, results: [] };
  }

  const cols = await columns(sql, table);
  const has = (name: string) => cols.includes(name);

  const required = ['id', 'team_id', 'status', 'account_id', 'external_comment_id', 'external_post_id', 'metadata', 'comment_text', 'ai_reply', 'action', 'updated_at'];
  const selected = required.filter(has);

  const rows = await sql.unsafe(
    `SELECT ${selected.map(q).join(', ')}
     FROM ${q(table)}
     WHERE status IN ('pending_connection', 'needs_setup', 'pending', 'generated', 'approved')
     ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );

  let hydrated = 0;
  let skipped = 0;
  const results: any[] = [];

  for (const row of rows) {
    const id = row.id;
    const teamId = row.team_id;
    const platform = asString(row.platform || findDeep(row.metadata, ['platform'])) || 'facebook';

    let accountId = getFromRowOrMeta(
      row,
      ['account_id', 'accountId', 'zernio_account_id', 'zernioAccountId'],
      ['accountId', 'account_id', 'zernioAccountId', 'zernio_account_id', '_id']
    );

    let commentId = getFromRowOrMeta(
      row,
      ['external_comment_id', 'externalCommentId', 'comment_id', 'commentId'],
      ['commentId', 'comment_id', 'externalCommentId', 'external_comment_id', 'id']
    );

    let postId = getFromRowOrMeta(
      row,
      ['external_post_id', 'externalPostId', 'post_id', 'postId'],
      [
        'postId',
        'post_id',
        'externalPostId',
        'external_post_id',
        'platformPostId',
        'platform_post_id',
        'zernioPostId',
        'zernio_post_id'
      ]
    );

    const pageId = pageIdFromPlatformPostId(postId || findDeep(row.metadata, ['platformPostId', 'platform_post_id']));
    const authorId = authorIdFromMeta(row.metadata);
    if ((pageId && authorId && pageId === authorId) || (isReplyFromMeta(row.metadata) && pageId && authorId && pageId === authorId)) {
      await sql.unsafe(
        `UPDATE ${q(table)}
         SET ${q('status')} = 'ignored',
             ${q('action')} = 'self_reply_loop_guard',
             ${q('metadata')} = COALESCE(${q('metadata')}, '{}'::jsonb) || $2::jsonb,
             ${q('updated_at')} = NOW()
         WHERE id = $1`,
        [id, JSON.stringify({ antiLoop: true, reason: 'author_is_page', pageId, authorId, checkedAt: new Date().toISOString() })]
      ).catch(() => null);
      skipped++;
      results.push({ id, ok: true, ignored: true, reason: 'self_reply_loop_guard' });
      continue;
    }

    if (!accountId) {
      accountId = await getConnectedAccount(sql, teamId, platform);
    }

    const missing = {
      accountId: !accountId,
      postId: !postId,
      commentId: !commentId,
    };

    if (missing.accountId || missing.postId || missing.commentId) {
      skipped++;

      const sets = [];
      const values: any[] = [];
      let idx = 1;

      if (has('status')) sets.push(`${q('status')} = 'pending_connection'`);
      if (has('action')) sets.push(`${q('action')} = 'waiting_channel_match'`);
      if (has('updated_at')) sets.push(`${q('updated_at')} = NOW()`);

      values.push(id);

      await sql.unsafe(
        `UPDATE ${q(table)}
         SET ${sets.join(', ')}
         WHERE id = $${idx}`,
        values
      ).catch(() => null);

      results.push({ id, ok: false, reason: 'missing_network_ids', missing });
      continue;
    }

    const sets = [];
    const values: any[] = [];
    let idx = 1;

    if (has('account_id')) {
      sets.push(`${q('account_id')} = $${idx++}`);
      values.push(accountId);
    }

    if (has('external_post_id')) {
      sets.push(`${q('external_post_id')} = $${idx++}`);
      values.push(postId);
    }

    if (has('external_comment_id')) {
      sets.push(`${q('external_comment_id')} = $${idx++}`);
      values.push(commentId);
    }

    if (has('status')) sets.push(`${q('status')} = 'pending'`);
    if (has('action')) sets.push(`${q('action')} = 'hydrated_from_platform_post_id'`);
    if (has('updated_at')) sets.push(`${q('updated_at')} = NOW()`);

    values.push(id);

    await sql.unsafe(
      `UPDATE ${q(table)}
       SET ${sets.join(', ')}
       WHERE id = $${idx}`,
      values
    );

    hydrated++;
    results.push({ id, ok: true, accountId, postId, commentId });
  }

  return { processed: rows.length, hydrated, skipped, results };
}

export async function GET(request: NextRequest) {
  const sql = getDb();

  try {
    if (!(await tokenAllowed(sql, request))) {
      return NextResponse.json({ ok: false, message: 'No autorizado.' }, { status: 401 });
    }

    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 60), 1), 150);
    const result = await hydrateRows(sql, limit);

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, message: 'No pudimos preparar los comentarios automáticamente.', detail: error?.message || String(error) },
      { status: 500 }
    );
  } finally {
    await sql.end().catch(() => null);
  }
}

export const POST = GET;
