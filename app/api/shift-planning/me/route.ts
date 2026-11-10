import { NextRequest, NextResponse } from 'next/server';

import { currentMonth, myShifts } from '@/lib/shift-planning';
import { monthParam, requireViewer, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The caller's own shifts: published months only, never anyone else's. */
export async function GET(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireViewer(request);
    if (response) return response;
    const month = monthParam(request, await currentMonth());
    return NextResponse.json(await myShifts(ctx.actor.id, month));
  });
}
