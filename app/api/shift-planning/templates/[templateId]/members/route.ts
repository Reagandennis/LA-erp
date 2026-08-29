import { NextRequest, NextResponse } from 'next/server';

import { removeTemplateMember, setTemplateMember } from '@/lib/shift-planning';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Attach a person to a shift pattern (or update their contracted hours). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { templateId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: 'A person is required.' }, { status: 400 });
  }
  const hours = body?.hours == null ? null : Number(body.hours);

  await setTemplateMember(templateId, userId, Number.isFinite(hours as number) ? (hours as number) : null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { templateId } = await params;
  const userId = Number(new URL(request.url).searchParams.get('userId'));
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: 'A person is required.' }, { status: 400 });
  }
  await removeTemplateMember(templateId, userId);
  return NextResponse.json({ ok: true });
}
