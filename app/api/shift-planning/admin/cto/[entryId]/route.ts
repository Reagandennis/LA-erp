import { NextRequest, NextResponse } from 'next/server';

import { removeCto } from '@/lib/shift-planning';
import { requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ entryId: string }> }) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const id = Number((await params).entryId);
    const ok = Number.isInteger(id) ? await removeCto(ctx.actor, id) : false;
    if (!ok) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  });
}
