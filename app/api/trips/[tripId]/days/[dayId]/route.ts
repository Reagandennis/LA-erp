import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { tripForViewer } from '@/lib/trip-costs';
import { deleteTripDay, updateTripDay } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripDayUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; dayId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, dayId: rawDay } = await params;
  const tripId = parseId(rawTrip);
  const dayId = parseId(rawDay);
  if (!tripId || !dayId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripDayUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await updateTripDay({
    tripId,
    dayId,
    userId: auth.user.id,
    isAdmin,
    ...validation.data,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'trip.itinerary.day.updated',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, dayId },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; dayId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, dayId: rawDay } = await params;
  const tripId = parseId(rawTrip);
  const dayId = parseId(rawDay);
  if (!tripId || !dayId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  // Default keeps the events and drops them into the Unscheduled tray.
  const mode = request.nextUrl.searchParams.get('items') === 'delete' ? 'delete' : 'unschedule';

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await deleteTripDay({ tripId, dayId, userId: auth.user.id, isAdmin, mode });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'trip.itinerary.day.deleted',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, dayId, mode },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}
