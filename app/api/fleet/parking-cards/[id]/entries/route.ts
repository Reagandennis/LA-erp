import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { createParkingEntry } from '@/lib/parking-cards-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { parkingEntryCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Logs parking, a top-up or a balance check on the card. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.parkingCards);
  if (response || !auth) return response;
  const cardId = Number((await params).id);
  if (!Number.isInteger(cardId) || cardId <= 0) return NextResponse.json({ error: 'Invalid parking card id' }, { status: 400 });

  const validation = parkingEntryCreateSchema.safeParse((await request.json().catch(() => null)) ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }
  const result = await createParkingEntry(auth.user.id, cardId, validation.data);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item }, { status: 201 });
}
