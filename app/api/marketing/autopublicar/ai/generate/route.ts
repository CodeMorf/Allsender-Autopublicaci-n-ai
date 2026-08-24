import { NextRequest, NextResponse } from 'next/server';
import { requireAutopublishContext } from '@/lib/marketing-autopublicar/auth';
import { generateAutopublishContent } from '@/lib/marketing-autopublicar/service';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireAutopublishContext();
  if (!ctx) return NextResponse.json({ status: false, code: 'UNAUTHORIZED', message: 'No autenticado' }, { status: 401 });
  try {
    return NextResponse.json(await generateAutopublishContent(ctx.teamId, await request.json().catch(() => ({}))));
  } catch (error: any) {
    return NextResponse.json({ status: false, code: 'AI_GENERATE_FAILED', message: error?.message || 'No se pudo generar contenido.' }, { status: 500 });
  }
}
