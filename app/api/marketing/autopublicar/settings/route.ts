import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { getMarketingSettings, updateMarketingSettings } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ status: true, settings: await getMarketingSettings(ctx.teamId) });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ status: true, settings: await updateMarketingSettings(ctx.teamId, await request.json().catch(() => ({}))) });
}
