import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { getPlanLimits, listPublishReadyAccounts } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const platform = request.nextUrl.searchParams.get('platform');
  const [accounts, plan] = await Promise.all([listPublishReadyAccounts(ctx.teamId, platform), getPlanLimits(ctx.teamId)]);
  return NextResponse.json({
    status: true,
    accounts,
    emptyState: accounts.length === 0,
    connectUrl: '/es/settings/connect',
    message: accounts.length === 0 ? 'No tienes redes conectadas para autopublicar.' : undefined,
    planLimits: plan.planLimits,
    featureLocks: plan.featureLocks,
  });
}
