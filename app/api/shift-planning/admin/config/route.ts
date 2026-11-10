import { NextRequest, NextResponse } from 'next/server';

import { saveRules } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** The rotation, shift times and every threshold the rules read. */
export async function PUT(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const rules = await saveRules(ctx.actor, await readJson(request));
    return NextResponse.json({ rules });
  });
}
