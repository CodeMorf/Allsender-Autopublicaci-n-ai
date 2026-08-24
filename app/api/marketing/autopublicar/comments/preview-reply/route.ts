import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { previewCommentReply } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const result = await previewCommentReply(ctx.teamId, await request.json().catch(() => ({})));
  if (!result.status) return NextResponse.json(result, { status: (result as any).httpStatus || 422 });
  return NextResponse.json(result);
}
