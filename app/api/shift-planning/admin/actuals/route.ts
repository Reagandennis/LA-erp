import { NextRequest, NextResponse } from 'next/server';

import { type ActualInput, recordActual } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Records what happened on a rostered shift: worked, sick or no-show. */
export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const body = await readJson(request);
    const record = await recordActual(ctx.actor, {
      lineId: Number(body.lineId),
      date: String(body.date ?? ''),
      status: body.status as ActualInput['status'],
      actualStart: typeof body.actualStart === 'string' ? body.actualStart : null,
      actualEnd: typeof body.actualEnd === 'string' ? body.actualEnd : null,
      note: typeof body.note === 'string' ? body.note : null,
    });
    return NextResponse.json({ record });
  });
}
