import { NextRequest, NextResponse } from 'next/server';

import { RosterError, decideLeave } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Approve, decline or cancel a leave request. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ leaveId: string }> }) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const id = Number((await params).leaveId);
    const { decision } = await readJson(request);
    if (decision !== 'approve' && decision !== 'decline' && decision !== 'cancel') throw new RosterError('Unknown decision.');
    const result = Number.isInteger(id) ? await decideLeave(ctx.actor, id, decision) : null;
    if (!result) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
    return NextResponse.json(result);
  });
}
