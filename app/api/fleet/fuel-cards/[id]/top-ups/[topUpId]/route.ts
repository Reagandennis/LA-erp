import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { deleteTopUp, updateTopUp } from '@/lib/fuel-cards-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { topUpUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ id: string; topUpId: string }> };

async function parseIds(params: Params['params']) {
  const { id, topUpId } = await params;
  const cardId = Number(id);
  const entryId = Number(topUpId);
  const ok = Number.isInteger(cardId) && cardId > 0 && Number.isInteger(entryId) && entryId > 0;
  return ok ? { cardId, entryId } : null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fuelCards);
  if (response || !auth) return response;

  const ids = await parseIds(params);
  if (!ids) return NextResponse.json({ error: 'Invalid top-up id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = topUpUpdateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await updateTopUp(ids.cardId, ids.entryId, validation.data, { origin: request.nextUrl.origin });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fuelCards);
  if (response || !auth) return response;

  const ids = await parseIds(params);
  if (!ids) return NextResponse.json({ error: 'Invalid top-up id' }, { status: 400 });

  if (!(await deleteTopUp(ids.cardId, ids.entryId, { origin: request.nextUrl.origin }))) {
    return NextResponse.json({ error: 'Top-up not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true });
}
