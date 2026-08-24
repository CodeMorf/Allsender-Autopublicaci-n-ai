import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { getCalendar } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json(await getCalendar(ctx.teamId, request.nextUrl.searchParams));
}
