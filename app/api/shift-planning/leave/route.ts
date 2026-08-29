import { NextRequest, NextResponse } from 'next/server';

import { createLeave, isDateKey, isLeaveType, listLeave } from '@/lib/shift-planning';
import { requireViewer } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;

  const { searchParams } = new URL(request.url);
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const range = isDateKey(from) && isDateKey(to) ? { from, to } : { from: undefined, to: undefined };
  return NextResponse.json({ leave: await listLeave(range.from, range.to) });
}

/**
 * Request leave. Anyone may request it for themselves; only a manager may book
 * it for someone else, and when they do it is approved on the spot.
 */
export async function POST(request: NextRequest) {
  const { ctx, response } = await requireViewer(request);
  if (response || !ctx) return response;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const type = isLeaveType(body?.type) ? body.type : null;
  const startDate = String(body?.startDate ?? '');
  const endDate = String(body?.endDate ?? '');
  const note = typeof body?.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const requestedFor = body?.userId == null ? ctx.userId : Number(body.userId);

  if (!type) return NextResponse.json({ error: 'Choose a leave type.' }, { status: 400 });
  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    return NextResponse.json({ error: 'Dates must be YYYY-MM-DD.' }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json({ error: 'The end date is before the start date.' }, { status: 400 });
  }
  if (requestedFor !== ctx.userId && !ctx.canManage) {
    return NextResponse.json(
      { error: 'Only a manager can book leave for someone else.' },
      { status: 403 },
    );
  }

  const leave = await createLeave({
    userId: requestedFor,
    type,
    startDate,
    endDate,
    note,
    autoApproveById: ctx.canManage ? ctx.userId : undefined,
  });
  return NextResponse.json({ leave }, { status: 201 });
}
