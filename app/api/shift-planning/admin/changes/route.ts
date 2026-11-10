import { NextRequest, NextResponse } from 'next/server';

import { applyChanges } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';
import type { ChangeInput } from '@/lib/shift-types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Saves a batch of roster changes as one unit. A 409 carries the rules that
 * stopped it: warnings need confirming, blocks need a reason to approve.
 */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const body = await readJson(request);
    const result = await applyChanges(ctx.actor, (Array.isArray(body.changes) ? body.changes : []) as ChangeInput[], {
      reason: typeof body.reason === 'string' ? body.reason : null,
      kind: body.kind === 'swap' ? 'swap' : 'override',
      confirmWarnings: body.confirmWarnings === true,
      forceReason: typeof body.forceReason === 'string' ? body.forceReason : null,
    });
    return NextResponse.json(result, { status: result.saved ? 200 : 409 });
  });
}
