import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { decideLeave, deleteLeave } from '@/lib/shift-planning';
import { requireManager } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** Approve or decline a request. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ leaveId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { leaveId } = await params;
  const body = (await request.json().catch(() => null)) as { status?: unknown } | null;
  const status = body?.status;
  if (status !== 'approved' && status !== 'declined') {
    return NextResponse.json({ error: 'Status must be approved or declined.' }, { status: 400 });
  }

  const leave = await decideLeave(leaveId, status, ctx.userId);
  if (!leave) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });

  await recordAuditEvent({
    action: `leave.${status}`,
    entityType: 'leave-request',
    entityId: leaveId,
    actorUserId: ctx.userId,
    targetUserId: leave.userId,
    metadata: { type: leave.type, startDate: leave.startDate, endDate: leave.endDate },
    request,
  });
  return NextResponse.json({ leave });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ leaveId: string }> },
) {
  const { ctx, response } = await requireManager(request);
  if (response || !ctx) return response;

  const { leaveId } = await params;
  const ok = await deleteLeave(leaveId);
  if (!ok) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
