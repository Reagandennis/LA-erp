import { NextRequest, NextResponse } from 'next/server';

import {
  createTemplate,
  isColour,
  isTimeOfDay,
  listTemplates,
} from '@/lib/shift-planning';
import { requireManager, requireViewer } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;
  return NextResponse.json({ templates: await listTemplates() });
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const name = String(body?.name ?? '').trim();
  const startTime = String(body?.startTime ?? '').trim();
  const endTime = String(body?.endTime ?? '').trim();
  const colour = isColour(body?.colour) ? body.colour : 'blue';
  const weekdays = Array.isArray(body?.weekdays)
    ? [...new Set(body.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))]
    : [];

  if (!name) return NextResponse.json({ error: 'A shift name is required.' }, { status: 400 });
  if (!isTimeOfDay(startTime) || !isTimeOfDay(endTime)) {
    return NextResponse.json({ error: 'Times must be in 24-hour HH:MM form.' }, { status: 400 });
  }

  const template = await createTemplate({
    name,
    startTime,
    endTime,
    weekdays,
    colour,
    createdById: ctx.userId,
  });
  return NextResponse.json({ template }, { status: 201 });
}
