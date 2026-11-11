import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { tripForViewer } from '@/lib/trip-costs';
import { saveTripDayLog } from '@/lib/trip-resources';
import { userHasRole } from '@/lib/user';
import { tripDayLogSaveSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Saves one line of a day's shift and odometer log: a driver's or CPO's
 * shift times, or a vehicle's start and end readings.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ tripId: string; dayId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, dayId: rawDay } = await params;
  const tripId = parseId(rawTrip);
  const dayId = parseId(rawDay);
  if (!tripId || !dayId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripDayLogSaveSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await saveTripDayLog({ tripId, dayId, userId: auth.user.id, isAdmin, input: validation.data });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: 'trip.daylog.saved',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, dayId, kind: validation.data.kind, subjectId: validation.data.subjectId },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}
