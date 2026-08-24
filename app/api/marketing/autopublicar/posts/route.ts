import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { createPost, listPosts } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const data = await listPosts(ctx.teamId, request.nextUrl.searchParams);
  return NextResponse.json({ status: true, ...data });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const result = await createPost(ctx.teamId, ctx.userId, body, request.headers.get('x-request-id'));
  if (!result.status) return NextResponse.json({ status: false, code: (result as any).code || 'CREATE_FAILED', message: (result as any).message || 'No se pudo crear' }, { status: (result as any).httpStatus || 400 });
  return NextResponse.json(result, { status: (result as any).httpStatus || 201 });
}
