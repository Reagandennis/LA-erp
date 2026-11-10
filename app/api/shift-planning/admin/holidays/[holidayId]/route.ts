import { NextRequest, NextResponse } from 'next/server';

import { removeHoliday } from '@/lib/shift-planning';
import { requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ holidayId: string }> }) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const ok = await removeHoliday(ctx.actor, (await params).holidayId);
    if (!ok) return NextResponse.json({ error: 'Holiday not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  });
}
