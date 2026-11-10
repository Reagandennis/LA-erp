import { NextRequest, NextResponse } from 'next/server';

import { currentMonth, teamRoster } from '@/lib/shift-planning';
import { monthParam, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Everyone's month. Admins and schedulers only; staff read their own through /me. */
export async function GET(request: NextRequest) {
  return respond(async () => {
    const { response } = await requireManager(request);
    if (response) return response;
    const month = monthParam(request, await currentMonth());
    return NextResponse.json(await teamRoster(month));
  });
}
