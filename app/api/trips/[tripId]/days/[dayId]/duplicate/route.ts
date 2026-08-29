import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { duplicateTripDay } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripDayDuplicateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; dayId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: rawTrip, dayId: rawDay } = await params;
  const tripId = parseId(rawTrip);
  const dayId = parseId(rawDay);
  if (!tripId || !dayId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripDayDuplicateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await duplicateTripDay({
    tripId,
    dayId,
    userId: auth.user.id,
    isAdmin,
    includeEvents: validation.data.includeEvents,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'trip.itinerary.day.duplicated',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, sourceDayId: dayId },
    request,
  });

  return NextResponse.json({ trip: result }, { status: 201 });
}
