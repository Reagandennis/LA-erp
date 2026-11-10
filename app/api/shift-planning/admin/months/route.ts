import { NextRequest, NextResponse } from 'next/server';

import { RosterError, confirmWorked, generateMonth, publishMonth, unpublishMonth } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Generate, reset, publish or unpublish a month, or confirm its past shifts as worked. */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const body = await readJson(request);
    const month = String(body.month ?? '');

    switch (body.action) {
      case 'generate':
        return NextResponse.json({ month: await generateMonth(ctx.actor, month) });
      case 'reset':
        return NextResponse.json({ month: await generateMonth(ctx.actor, month, { reset: true }) });
      case 'unpublish':
        return NextResponse.json({ month: await unpublishMonth(ctx.actor, month) });
      case 'confirm-worked':
        return NextResponse.json({ confirmed: await confirmWorked(ctx.actor, month) });
      case 'publish': {
        const result = await publishMonth(ctx.actor, month, {
          forceReason: typeof body.forceReason === 'string' ? body.forceReason : null,
        });
        return NextResponse.json(result, { status: result.saved ? 200 : 409 });
      }
      default:
        throw new RosterError('Unknown action.');
    }
  });
}
