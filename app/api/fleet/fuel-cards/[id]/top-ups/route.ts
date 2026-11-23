import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { createTopUp } from '@/lib/fuel-cards-server';
import { requireModuleRequest } from '@/lib/request-auth';
import { topUpCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.fuelCards);
  if (response || !auth) return response;

  const cardId = Number((await params).id);
  if (!Number.isInteger(cardId) || cardId <= 0) return NextResponse.json({ error: 'Invalid fuel card id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = topUpCreateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await createTopUp(auth.user.id, cardId, validation.data, { origin: request.nextUrl.origin });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ item: result.item }, { status: 201 });
}
