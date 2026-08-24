import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { cancelPost } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ postId: string }> };

export async function POST(_request: NextRequest, context: Ctx) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  try {
    const { postId } = await context.params;
    const post = await cancelPost(ctx.teamId, Number(postId));
    if (!post) return NextResponse.json({ status: false, code: 'NOT_FOUND', message: 'Post no encontrado' }, { status: 404 });
    return NextResponse.json({ status: true, post });
  } catch (error: any) {
    return NextResponse.json({ status: false, code: 'CANCEL_FAILED', message: error?.message || 'No se pudo cancelar' }, { status: 400 });
  }
}
