import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { tripForViewer } from '@/lib/trip-costs';
import { removeTripResource, updateTripResource } from '@/lib/trip-resources';
import { userHasRole } from '@/lib/user';
import { tripResourceUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

type Context = { params: Promise<{ tripId: string; resourceId: string }> };

/** Changes a staged resource's dates or quantity, or takes back its verdict. */
export async function PATCH(request: NextRequest, { params }: Context) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, resourceId: rawResource } = await params;
  const tripId = parseId(rawTrip);
  const resourceId = parseId(rawResource);
  if (!tripId || !resourceId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripResourceUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await updateTripResource({ tripId, resourceId, userId: auth.user.id, isAdmin, input: validation.data });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: validation.data.resolution === null ? 'trip.resource.verdict.cleared' : 'trip.resource.updated',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, resourceId, changed: Object.keys(validation.data) },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}

/** Takes a staged resource out of the pool. */
export async function DELETE(request: NextRequest, { params }: Context) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, resourceId: rawResource } = await params;
  const tripId = parseId(rawTrip);
  const resourceId = parseId(rawResource);
  if (!tripId || !resourceId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await removeTripResource({ tripId, resourceId, userId: auth.user.id, isAdmin });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: 'trip.resource.removed',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, resourceId },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}
