import { NextRequest, NextResponse } from 'next/server';
import { requireComentariosIaContext } from '@/lib/marketing-comentarios-ia/auth';
import { getCommentPlanLimits, getCommentSettings, updateCommentSettings } from '@/lib/marketing-comentarios-ia/service';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const [settings, plan] = await Promise.all([getCommentSettings(ctx.teamId), getCommentPlanLimits(ctx.teamId)]);
  return NextResponse.json({ status: true, settings, ...plan });
}

export async function POST(request: NextRequest) {
  const ctx = await requireComentariosIaContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  const settings = await updateCommentSettings(ctx.teamId, await request.json().catch(() => ({})));
  const plan = await getCommentPlanLimits(ctx.teamId);
  return NextResponse.json({ status: true, settings, ...plan });
}

export const PUT = POST;

export const PATCH = POST;
