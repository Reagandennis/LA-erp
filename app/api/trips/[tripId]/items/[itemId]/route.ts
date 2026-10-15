import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { canSeeTripCosts, tripForViewer } from '@/lib/trip-costs';
import { deleteTripItem, updateTripItem } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripItineraryItemUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: rawTrip, itemId: rawItem } = await params;
  const tripId = parseId(rawTrip);
  const itemId = parseId(rawItem);
  if (!tripId || !itemId) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const validation = tripItineraryItemUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await updateTripItem({
    tripId,
    itemId,
    userId: auth.user.id,
    isAdmin,
    // Without access to quotes a cost can't be changed, only left as it is.
    input: canSeeTripCosts(auth.user) ? validation.data : { ...validation.data, unitPrice: undefined },
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  const action =
    validation.data.completed === true
      ? 'trip.itinerary.item.completed'
      : 'trip.itinerary.item.updated';

  await recordAuditEvent({
    action,
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: {
      reference: result.reference,
      trackingCode: result.trackingCode,
      itemId,
    },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: rawTrip, itemId: rawItem } = await params;
  const tripId = parseId(rawTrip);
  const itemId = parseId(rawItem);
  if (!tripId || !itemId) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await deleteTripItem({ tripId, itemId, userId: auth.user.id, isAdmin });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'trip.itinerary.item.removed',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, trackingCode: result.trackingCode, itemId },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}
