import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { matchProductForComment } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json(await matchProductForComment(ctx.teamId, await request.json().catch(() => ({}))));
}
