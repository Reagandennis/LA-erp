import { NextRequest, NextResponse } from 'next/server';

import { decideLeave, requestLeave } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A scheduler entering leave for someone; `approve` grants it in the same step. */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const body = await readJson(request);
    const leave = await requestLeave(ctx.actor, Number(body.lineId), body);
    if (body.approve !== true) return NextResponse.json({ leave, needsCover: [] }, { status: 201 });
    const decided = await decideLeave(ctx.actor, leave.id, 'approve');
    return NextResponse.json(decided ?? { leave, needsCover: [] }, { status: 201 });
  });
}
