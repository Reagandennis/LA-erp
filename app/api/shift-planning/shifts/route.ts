import { NextRequest, NextResponse } from 'next/server';

import { createShift, isValidDateKey, listShifts, type ShiftBlock } from '@/lib/schedule';
import { requireManager, requireViewer } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Shifts overlapping a date range. Anyone with the module may look. */
export async function GET(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  return NextResponse.json({ shifts: await listShifts(from, to) });
}

export async function POST(request: NextRequest) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const employeeId = Number(body?.employeeId);
  const date = body?.date;
  const block = body?.block as ShiftBlock | undefined;
  const templateId = typeof body?.templateId === 'string' && body.templateId ? body.templateId : null;

  if (!Number.isInteger(employeeId) || employeeId <= 0) {
    return NextResponse.json({ error: 'A person is required.' }, { status: 400 });
  }
  if (!isValidDateKey(date)) {
    return NextResponse.json({ error: 'Date must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (!block?.type) return NextResponse.json({ error: 'A shift type is required.' }, { status: 400 });

  try {
    const shift = await createShift({ adminId: ctx.userId, employeeId, date, block, templateId });
    return NextResponse.json({ shift }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not create the shift.' },
      { status: 400 },
    );
  }
}
