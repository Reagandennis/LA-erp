import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { canSeeTripCosts, tripForViewer } from '@/lib/trip-costs';
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
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
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
      dayId: item.dayId ?? null,
      itemType: item.itemType,
      category: item.category,
      body: item.body ?? null,
      timeLabel: item.timeLabel ?? null,
      providerName: item.providerName ?? null,
      bookingUrl: item.bookingUrl ?? null,
      phone: item.phone ?? null,
      placeName: item.placeName ?? null,
      address: item.address ?? null,
      details: (item.details ?? null) as Record<string, string> | null,
      description: item.description,
      subtitle: item.subtitle ?? null,
      quantity: item.quantity,
      // Costs are quote prices: only people who can see quotes may set them.
      unitPrice: canSeeTripCosts(auth.user) ? (item.unitPrice ?? null) : null,
      sourceQuoteItemId: item.sourceQuoteItemId ?? null,
      scheduledAt: item.scheduledAt ?? null,
      endsAt: item.endsAt ?? null,
      durationMinutes: item.durationMinutes ?? null,
      reminderMinutesBefore: item.reminderMinutesBefore ?? null,
      imageUrl: item.imageUrl ?? null,
      confirmationCode: item.confirmationCode ?? null,
      driverId: item.driverId ?? null,
      officerId: item.officerId ?? null,
      vehicleId: item.vehicleId ?? null,
      travelers: item.travelers ?? [],
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

  return NextResponse.json({ trip: tripForViewer(result, auth.user) }, { status: 201 });
}
