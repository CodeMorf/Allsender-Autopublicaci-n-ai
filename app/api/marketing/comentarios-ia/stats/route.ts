import { NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { getCommentStats } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ status: true, stats: await getCommentStats(ctx.teamId) });
}
