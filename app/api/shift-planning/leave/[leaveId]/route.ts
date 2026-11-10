import { NextRequest, NextResponse } from 'next/server';

import { lineForUser, withdrawLeave } from '@/lib/shift-planning';
import { requireViewer, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Withdraws the caller's own pending request. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ leaveId: string }> }) {
  return respond(async () => {
    const { ctx, response } = await requireViewer(request);
    if (response) return response;
    const id = Number((await params).leaveId);
    const line = await lineForUser(ctx.actor.id);
    const ok = line && Number.isInteger(id) ? await withdrawLeave(ctx.actor, id, line.id) : false;
    if (!ok) return NextResponse.json({ error: 'Leave request not found' }, { status: 404 });
    return NextResponse.json({ withdrawn: true });
  });
}
