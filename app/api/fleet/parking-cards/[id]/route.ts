import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { deleteParkingCard, getParkingStatement, updateParkingCard } from '@/lib/parking-cards-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { parkingCardUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

async function cardId(params: Params['params']) {
  const n = Number((await params).id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The card and every entry on it, for its statement. */
export async function GET(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.parkingCards);
  if (response || !auth) return response;
  const id = await cardId(params);
  if (!id) return NextResponse.json({ error: 'Invalid parking card id' }, { status: 400 });
  const statement = await getParkingStatement(id);
  if (!statement) return NextResponse.json({ error: 'Parking card not found' }, { status: 404 });
  return NextResponse.json(statement);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.parkingCards);
  if (response || !auth) return response;
  const id = await cardId(params);
  if (!id) return NextResponse.json({ error: 'Invalid parking card id' }, { status: 400 });

  const validation = parkingCardUpdateSchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const result = await updateParkingCard(id, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.parkingCards);
  if (response || !auth) return response;
  const id = await cardId(params);
  if (!id) return NextResponse.json({ error: 'Invalid parking card id' }, { status: 400 });
  const result = await deleteParkingCard(id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
