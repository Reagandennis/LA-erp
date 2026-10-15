import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { tripForViewer } from '@/lib/trip-costs';
import { deleteTrip, getTripForUser, updateTrip } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripUpdateSchema } from '@/lib/validation';

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
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trip = await getTripForUser({ id, userId: auth.user.id, isAdmin });
  if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  return NextResponse.json({ trip: tripForViewer(trip, auth.user) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const previous = await getTripForUser({ id, userId: auth.user.id, isAdmin });

  const result = await updateTrip({
    id,
    userId: auth.user.id,
    isAdmin,
    input: {
      customerId: validation.data.customerId,
      ownerId: validation.data.ownerId,
      title: validation.data.title,
      description: validation.data.description,
      status: validation.data.status,
      startDate: validation.data.startDate,
      endDate: validation.data.endDate,
      currency: validation.data.currency,
      notes: validation.data.notes,
    },
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  if (validation.data.status && previous && validation.data.status !== previous.status) {
    await recordAuditEvent({
      action: 'trip.status.changed',
      entityType: 'trip',
      entityId: String(id),
      actorUserId: auth.user.id,
      metadata: {
        reference: result.reference,
        trackingCode: result.trackingCode,
        from: previous.status,
        to: validation.data.status,
      },
      request,
    });
  } else {
    await recordAuditEvent({
      action: 'trip.updated',
      entityType: 'trip',
      entityId: String(id),
      actorUserId: auth.user.id,
      metadata: { reference: result.reference, trackingCode: result.trackingCode },
      request,
    });
  }

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await deleteTrip({ id, userId: auth.user.id, isAdmin });
  if (result !== true) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'trip.deleted',
    entityType: 'trip',
    entityId: String(id),
    actorUserId: auth.user.id,
    request,
  });

  return NextResponse.json({ success: true });
}
