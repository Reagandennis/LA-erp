import { NextRequest, NextResponse } from 'next/server';

import { removeTemplateTeam, setTemplateTeam } from '@/lib/shift-planning';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { templateId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const teamId = String(body?.teamId ?? '').trim();
  if (!teamId) return NextResponse.json({ error: 'A team is required.' }, { status: 400 });
  const hours = body?.hours == null ? null : Number(body.hours);

  await setTemplateTeam(templateId, teamId, Number.isFinite(hours as number) ? (hours as number) : null);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { templateId } = await params;
  const teamId = (new URL(request.url).searchParams.get('teamId') ?? '').trim();
  if (!teamId) return NextResponse.json({ error: 'A team is required.' }, { status: 400 });
  await removeTemplateTeam(templateId, teamId);
  return NextResponse.json({ ok: true });
}
