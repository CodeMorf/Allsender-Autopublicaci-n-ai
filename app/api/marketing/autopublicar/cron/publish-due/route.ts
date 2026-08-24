import { NextRequest, NextResponse } from 'next/server';
import { publishDuePosts } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const expected = String(process.env.CRON_SECRET || process.env.ZERNIO_SYNC_SECRET || '').trim();
  const received = String(request.headers.get('x-cron-secret') || '').trim();
  if (expected && received !== expected) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'Cron secret inválido' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const teamId = body?.teamId ? Number(body.teamId) : null;
  return NextResponse.json(await publishDuePosts(teamId, Number(body?.limit || 10)));
}
