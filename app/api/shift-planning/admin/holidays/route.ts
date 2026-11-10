import { NextRequest, NextResponse } from 'next/server';

import { addHoliday } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const holiday = await addHoliday(ctx.actor, await readJson(request));
    return NextResponse.json({ holiday }, { status: 201 });
  });
}
