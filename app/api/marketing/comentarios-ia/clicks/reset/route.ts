import { NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { resetCommentShortLinkClicks } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function POST() {
  const ctx = await requireComentariosIaContext();
  if (!ctx) {
    return NextResponse.json(
      { status: false, ok: false, code: 'UNAUTHORIZED', message: 'No autenticado' },
      { status: 401 }
    );
  }

  const result = await resetCommentShortLinkClicks(ctx.teamId);
  const { status: resetStatus, ...payload } = result;

  return NextResponse.json({ status: resetStatus === false ? false : true, ok: true, ...payload });
}
