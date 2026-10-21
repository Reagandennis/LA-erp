import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { itineraryFilename, tripItineraryPdf } from '@/lib/trip-share';
import { getTripForUser } from '@/lib/trips';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The client itinerary as a PDF, for the planner to send on. `?crew=1`
 * includes crew and notes; `?photos=0` leaves out the stops' photos.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const tripId = parseId((await params).tripId);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trip = await getTripForUser({ id: tripId, userId: auth.user.id, isAdmin });
  if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

  const includeCrew = request.nextUrl.searchParams.get('crew') === '1';
  const includeAttachments = request.nextUrl.searchParams.get('photos') !== '0';
  const pdf = await tripItineraryPdf(trip, { includeCrew, includeAttachments });

  await recordAuditEvent({
    action: 'trip.pdf.downloaded',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: trip.reference, includeCrew, includeAttachments },
    request,
  });

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${itineraryFilename(trip.reference)}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
