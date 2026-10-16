import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { deleteTripLogEntry } from '@/lib/trip-log';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; entryId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, entryId: rawEntry } = await params;
  const tripId = parseId(rawTrip);
  const entryId = parseId(rawEntry);
  if (!tripId || !entryId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const result = await deleteTripLogEntry({
    tripId,
    entryId,
    userId: auth.user.id,
    isAdmin: userHasRole(auth.user, ADMIN_ROLE_NAME),
  });
  if (result === 'not-found') return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
  if (result === 'forbidden') {
    return NextResponse.json({ error: 'Only the author or an admin can remove this entry' }, { status: 403 });
  }

  await recordAuditEvent({
    action: 'trip.log.deleted',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { entryId },
    request,
  });

  return NextResponse.json({ ok: true });
}
