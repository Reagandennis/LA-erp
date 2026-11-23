import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { deleteParkingEntry, updateParkingEntry } from '@/lib/parking-cards-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { parkingEntryUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ id: string; entryId: string }> };

async function ids(params: Params['params']) {
  const { id, entryId } = await params;
  const cardId = Number(id);
  const entry = Number(entryId);
  return Number.isInteger(cardId) && cardId > 0 && Number.isInteger(entry) && entry > 0 ? { cardId, entry } : null;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.parkingCards);
  if (response || !auth) return response;
  const parsed = await ids(params);
  if (!parsed) return NextResponse.json({ error: 'Invalid entry id' }, { status: 400 });

  const validation = parkingEntryUpdateSchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const result = await updateParkingEntry(parsed.cardId, parsed.entry, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.parkingCards);
  if (response || !auth) return response;
  const parsed = await ids(params);
  if (!parsed) return NextResponse.json({ error: 'Invalid entry id' }, { status: 400 });
  if (!(await deleteParkingEntry(parsed.cardId, parsed.entry))) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
