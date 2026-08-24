import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { deleteOrCancelPost, getPost, updatePost } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ postId: string }> };

async function idFrom(context: Ctx) {
  const { postId } = await context.params;
  const id = Number(postId);
  return Number.isFinite(id) ? id : 0;
}

export async function GET(_request: NextRequest, context: Ctx) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const post = await getPost(ctx.teamId, await idFrom(context));
  if (!post) return NextResponse.json({ status: false, code: 'NOT_FOUND', message: 'Post no encontrado' }, { status: 404 });
  return NextResponse.json({ status: true, post });
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  try {
    const post = await updatePost(ctx.teamId, await idFrom(context), await request.json().catch(() => ({})));
    if (!post) return NextResponse.json({ status: false, code: 'NOT_FOUND', message: 'Post no encontrado' }, { status: 404 });
    return NextResponse.json({ status: true, post });
  } catch (error: any) {
    return NextResponse.json({ status: false, code: 'UPDATE_FAILED', message: error?.message || 'No se pudo actualizar' }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, context: Ctx) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const post = await deleteOrCancelPost(ctx.teamId, await idFrom(context));
  if (!post) return NextResponse.json({ status: false, code: 'NOT_FOUND', message: 'Post no encontrado' }, { status: 404 });
  return NextResponse.json({ status: true, post, message: 'Post actualizado' });
}
