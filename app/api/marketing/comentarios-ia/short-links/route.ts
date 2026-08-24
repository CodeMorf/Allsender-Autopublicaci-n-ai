import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { createShortLink } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({}));
    const link = await createShortLink(ctx.teamId, ctx.userId, body.destinationUrl, body.slug || body.title || 'comentario', body.title || 'Comentarios IA');
    return NextResponse.json({ status: true, ok: true, ...link });
  } catch (error: any) {
    return NextResponse.json({ status: false, code: 'SHORT_LINK_FAILED', message: error?.message || 'No se pudo crear link corto' }, { status: 400 });
  }
}
