import { NextRequest, NextResponse } from 'next/server';

import { addCto } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Adds a compensatory day by hand: one the roster could not earn by itself, or a correction. */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const entry = await addCto(ctx.actor, await readJson(request));
    return NextResponse.json({ entry }, { status: 201 });
  });
}
