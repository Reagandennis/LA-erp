import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { notifyTripEscalation } from '@/lib/trip-escalations';
import { addTripLogEntry, listTripLog } from '@/lib/trip-log';
import { userHasRole } from '@/lib/user';
import { tripLogEntryCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const tripId = parseId(raw);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const entries = await listTripLog({
    tripId,
    userId: auth.user.id,
    isAdmin: userHasRole(auth.user, ADMIN_ROLE_NAME),
  });
  if (!entries) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  return NextResponse.json({ entries });
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
  const validation = tripLogEntryCreateSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const entry = await addTripLogEntry({
    tripId,
    userId: auth.user.id,
    userName: auth.user.name,
    isAdmin: userHasRole(auth.user, ADMIN_ROLE_NAME),
    input: validation.data,
  });
  if (!entry) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

  // The entry is saved either way; who was told comes back with it.
  const escalation = entry.escalated
    ? await notifyTripEscalation({
        tripId,
        entry,
        actor: { id: auth.user.id, name: auth.user.name },
        tripUrl: new URL(`/modules/trip-planning/${tripId}`, request.nextUrl.origin).toString(),
      })
    : null;

  await recordAuditEvent({
    action: 'trip.log.added',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { entryId: entry.id, escalated: entry.escalated, ...(escalation ? { notified: escalation.notified, emailed: escalation.emailed } : {}) },
    request,
  });

  return NextResponse.json({ entry, escalation }, { status: 201 });
}
