import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { approveComment } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ commentLogId: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  try {
    const { commentLogId } = await context.params;
    const comment = await approveComment(ctx.teamId, Number(commentLogId), await request.json().catch(() => ({})));
    if (!comment) return NextResponse.json({ status: false, code: 'NOT_FOUND', message: 'Comentario no encontrado' }, { status: 404 });
    return NextResponse.json({ status: true, comment });
  } catch (error: any) {
    return NextResponse.json({ status: false, code: 'APPROVE_FAILED', message: error?.message || 'No se pudo aprobar' }, { status: 400 });
  }
}
