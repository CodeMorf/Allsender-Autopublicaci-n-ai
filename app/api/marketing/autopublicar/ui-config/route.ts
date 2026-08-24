import { NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { getUiConfig, registerAutopublishModule } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  await registerAutopublishModule();
  return NextResponse.json(await getUiConfig(ctx.teamId));
}
