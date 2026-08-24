import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { sendCommentReply } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ commentId: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const { commentId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await sendCommentReply(ctx.teamId, Number(commentId), body.reply, body.privateReply ? 'private' : 'public');
  return NextResponse.json(result, { status: (result as any).status === false ? 400 : 200 });
}
