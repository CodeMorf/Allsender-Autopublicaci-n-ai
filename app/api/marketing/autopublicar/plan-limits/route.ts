import { NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { getPlanLimits } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const data = await getPlanLimits(ctx.teamId);
  return NextResponse.json({ status: true, ...data });
}
