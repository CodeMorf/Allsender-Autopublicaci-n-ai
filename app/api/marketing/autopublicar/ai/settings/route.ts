import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { getAutopublishAutomationSettings, updateAutopublishAutomationSettings } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ status: true, settings: await getAutopublishAutomationSettings(ctx.teamId) });
}

export async function PUT(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const updated = await updateAutopublishAutomationSettings(ctx.teamId, await request.json().catch(() => ({})));
  return NextResponse.json({ status: true, settings: updated });
}
