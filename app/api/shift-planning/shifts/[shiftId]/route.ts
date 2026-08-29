import { NextRequest, NextResponse } from 'next/server';

import { deleteShiftById, updateShift, type ShiftBlock } from '@/lib/schedule';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * Edit one shift. Addressed by path rather than a body id — the old route took
 * the id in a DELETE body, which is awkward to call and impossible to cache.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const id = Number((await params).shiftId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad shift id.' }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { block?: ShiftBlock } | null;
  if (!body?.block?.type) {
    return NextResponse.json({ error: 'A shift type is required.' }, { status: 400 });
  }

  const shift = await updateShift({ adminId: ctx.userId, id, block: body.block });
  if (!shift) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  return NextResponse.json({ shift });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const id = Number((await params).shiftId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Bad shift id.' }, { status: 400 });

  const deleted = await deleteShiftById(id);
  if (!deleted) return NextResponse.json({ error: 'Shift not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
