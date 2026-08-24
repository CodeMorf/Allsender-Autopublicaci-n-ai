import { NextRequest, NextResponse } from 'next/server';
import { generateAutomaticPosts, verifyAutopublishCronKey } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.headers.get('x-cron-secret') || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.nextUrl.searchParams.get('key');
  if (!(await verifyAutopublishCronKey(key))) return NextResponse.json({ status: false, code: 'INVALID_CRON_KEY' }, { status: 401 });
  const teamId = Number(request.nextUrl.searchParams.get('teamId') || 0) || null;
  const limit = Number(request.nextUrl.searchParams.get('limit') || 10);
  return NextResponse.json(await generateAutomaticPosts(teamId, limit));
}

export async function POST(request: NextRequest) { return GET(request); }
