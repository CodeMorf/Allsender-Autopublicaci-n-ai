import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { generateReplyForComment } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const result = await generateReplyForComment(ctx.teamId, await request.json().catch(() => ({})));
  return NextResponse.json(result, { status: (result as any).status === false ? 400 : 200 });
}
