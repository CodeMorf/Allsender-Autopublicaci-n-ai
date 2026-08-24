import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { listComments } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  return NextResponse.json({ status: true, ...(await listComments(ctx.teamId, request.nextUrl.searchParams)) });
}
