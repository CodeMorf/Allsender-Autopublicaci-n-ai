import { NextRequest, NextResponse } from 'next/server';
import { cleanupAutopublish, verifyAutopublishCronKey } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (!(await verifyAutopublishCronKey(key))) return NextResponse.json({ status: false, code: 'INVALID_CRON_KEY' }, { status: 401 });
  const teamId = Number(request.nextUrl.searchParams.get('teamId') || 0) || null;
  return NextResponse.json(await cleanupAutopublish(teamId));
}

export async function POST(request: NextRequest) { return GET(request); }
