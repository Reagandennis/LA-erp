import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { addTripItems } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripItineraryItemAddSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const tripId = parseId(raw);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripItineraryItemAddSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await addTripItems({
    tripId,
    userId: auth.user.id,
    isAdmin,
    items: validation.data.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? null,
      sourceQuoteItemId: item.sourceQuoteItemId ?? null,
      scheduledAt: item.scheduledAt ?? null,
      durationMinutes: item.durationMinutes ?? null,
      reminderMinutesBefore: item.reminderMinutesBefore ?? null,
    })),
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'trip.itinerary.item.added',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: {
      reference: result.reference,
      trackingCode: result.trackingCode,
      addedCount: validation.data.items.length,
    },
    request,
  });

  return NextResponse.json({ trip: result }, { status: 201 });
}
