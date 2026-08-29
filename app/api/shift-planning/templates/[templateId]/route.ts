import { NextRequest, NextResponse } from 'next/server';

import { deleteTemplate, isColour, isTimeOfDay, updateTemplate } from '@/lib/shift-planning';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { templateId } = await params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
  if (isTimeOfDay(body.startTime)) patch.startTime = body.startTime;
  if (isTimeOfDay(body.endTime)) patch.endTime = body.endTime;
  if (isColour(body.colour)) patch.colour = body.colour;
  if (typeof body.active === 'boolean') patch.active = body.active;
  if (Array.isArray(body.weekdays)) {
    patch.weekdays = [
      ...new Set(body.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)),
    ];
  }

  const template = await updateTemplate(templateId, patch);
  if (!template) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  return NextResponse.json({ template });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { templateId } = await params;
  const ok = await deleteTemplate(templateId);
  if (!ok) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
