import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { getShareLink, isShareable, revokeShareLink, saveShareLink } from '@/lib/trip-share';
import { getTripForUser } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripShareSaveSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Anyone who can open the trip can share it, as with its log. */
async function loadTrip(request: NextRequest, params: Promise<{ tripId: string }>) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return { response };

  const tripId = parseId((await params).tripId);
  if (!tripId) return { response: NextResponse.json({ error: 'Invalid trip id' }, { status: 400 }) };

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trip = await getTripForUser({ id: tripId, userId: auth.user.id, isAdmin });
  if (!trip) return { response: NextResponse.json({ error: 'Trip not found' }, { status: 404 }) };
  return { auth, trip };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, trip, response } = await loadTrip(request, params);
  if (!auth || !trip) return response;
  return NextResponse.json({ link: await getShareLink(trip.id) });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, trip, response } = await loadTrip(request, params);
  if (!auth || !trip) return response;

  const body = await request.json().catch(() => null);
  const validation = tripShareSaveSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  if (!isShareable(trip.status)) {
    return NextResponse.json({ error: 'Only an active trip can be shared' }, { status: 400 });
  }

  const { link, action } = await saveShareLink({
    tripId: trip.id,
    userId: auth.user.id,
    includeCrew: validation.data.includeCrew,
    includeAttachments: validation.data.includeAttachments,
    regenerate: validation.data.regenerate,
  });

  await recordAuditEvent({
    action: `trip.share.${action}`,
    entityType: 'trip',
    entityId: String(trip.id),
    actorUserId: auth.user.id,
    // Never the token: the audit log is not a place to keep credentials.
    metadata: { reference: trip.reference, includeCrew: link.includeCrew, includeAttachments: link.includeAttachments },
    request,
  });

  return NextResponse.json({ link });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, trip, response } = await loadTrip(request, params);
  if (!auth || !trip) return response;

  if (await revokeShareLink(trip.id)) {
    await recordAuditEvent({
      action: 'trip.share.revoked',
      entityType: 'trip',
      entityId: String(trip.id),
      actorUserId: auth.user.id,
      metadata: { reference: trip.reference },
      request,
    });
  }
  return NextResponse.json({ link: null });
}
