import { NextRequest, NextResponse } from 'next/server';

import { RosterError, lineForUser, requestLeave } from '@/lib/shift-planning';
import { readJson, requireViewer, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** A person asking for leave on their own roster line. */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireViewer(request);
    if (response) return response;
    const line = await lineForUser(ctx.actor.id);
    if (!line) throw new RosterError('You are not on the roster yet, so there is nothing to take leave from.');
    const body = await readJson(request);
    const leave = await requestLeave(ctx.actor, line.id, body);
    return NextResponse.json({ leave }, { status: 201 });
  });
}
