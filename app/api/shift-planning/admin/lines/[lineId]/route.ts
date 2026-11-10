import { NextRequest, NextResponse } from 'next/server';

import { deleteLine, updateLine } from '@/lib/shift-planning';
import { readJson, requireManager, respond } from '@/lib/shift-planning-route';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ lineId: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const id = Number((await params).lineId);
    const line = Number.isInteger(id) ? await updateLine(ctx.actor, id, await readJson(request)) : null;
    if (!line) return NextResponse.json({ error: 'Roster line not found' }, { status: 404 });
    return NextResponse.json({ line });
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  return respond(async () => {
    const { ctx, response } = await requireManager(request);
    if (response) return response;
    const id = Number((await params).lineId);
    const ok = Number.isInteger(id) ? await deleteLine(ctx.actor, id) : false;
    if (!ok) return NextResponse.json({ error: 'Roster line not found' }, { status: 404 });
    return NextResponse.json({ deleted: true });
  });
}
