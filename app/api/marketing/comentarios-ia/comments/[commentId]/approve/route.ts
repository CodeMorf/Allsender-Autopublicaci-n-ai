import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { approveComment } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ commentId: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const { commentId } = await context.params;
  const result = await approveComment(ctx.teamId, Number(commentId), await request.json().catch(() => ({})));
  return NextResponse.json(result, { status: (result as any).status === false ? 400 : 200 });
}
