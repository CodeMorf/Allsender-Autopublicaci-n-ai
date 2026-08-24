import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { publishPost } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ postId: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const { postId } = await context.params;
  const result = await publishPost(ctx.teamId, Number(postId), request.headers.get('x-request-id'));
  if (!result.status) return NextResponse.json({ status: false, code: (result as any).code || 'PUBLISH_FAILED', message: (result as any).message || (result as any).result?.error || 'No se pudo publicar', result: (result as any).result, post: (result as any).post }, { status: (result as any).httpStatus || 502 });
  return NextResponse.json(result);
}
