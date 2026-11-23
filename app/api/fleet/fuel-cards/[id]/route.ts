import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { deleteFuelCard, getFuelCardStatement, updateFuelCard } from '@/lib/fuel-cards-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { fuelCardUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ id: string }> };

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The card with its top-ups and the fill-ups it paid, for its statement. */
export async function GET(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fuelCards);
  if (response || !auth) return response;

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid fuel card id' }, { status: 400 });

  const statement = await getFuelCardStatement(id);
  if (!statement) return NextResponse.json({ error: 'Fuel card not found' }, { status: 404 });
  return NextResponse.json(statement);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fuelCards);
  if (response || !auth) return response;

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid fuel card id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = fuelCardUpdateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await updateFuelCard(id, validation.data, { origin: request.nextUrl.origin });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fuelCards);
  if (response || !auth) return response;

  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: 'Invalid fuel card id' }, { status: 400 });

  const result = await deleteFuelCard(id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ deleted: true });
}
