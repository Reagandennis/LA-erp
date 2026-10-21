import { NextRequest, NextResponse } from 'next/server';

import { buildClientItinerary } from '@/app/modules/trip-planning/[tripId]/client-itinerary';
import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { EmailError, isEmailConfigured } from '@/lib/email';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { isShareable, saveShareLink, tripBrandProfileId } from '@/lib/trip-share';
import { getTripForUser } from '@/lib/trips';
import { emailTripItineraryToCustomer } from '@/lib/transactional-email';
import { userHasRole } from '@/lib/user';
import { tripShareEmailSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Emails the client the share link (made now if there isn't one) with the PDF attached. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const tripId = parseId((await params).tripId);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripShareEmailSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trip = await getTripForUser({ id: tripId, userId: auth.user.id, isAdmin });
  if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
  if (!isShareable(trip.status)) {
    return NextResponse.json({ error: 'Only an active trip can be shared' }, { status: 400 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: 'Email is not set up yet. Configure SMTP under Admin → Email.' },
      { status: 400 },
    );
  }
  if (!trip.customer.email) {
    return NextResponse.json(
      { error: 'This client has no email address on file. Add one before sending.' },
      { status: 400 },
    );
  }

  const { includeCrew, includeAttachments } = validation.data;
  const { link } = await saveShareLink({ tripId, userId: auth.user.id, includeCrew, includeAttachments });

  let emailedTo: string;
  try {
    const delivered = await emailTripItineraryToCustomer({
      itinerary: buildClientItinerary(trip, { includeCrew, includeAttachments }),
      customer: trip.customer,
      shareUrl: new URL(link.path, request.nextUrl.origin).toString(),
      brandProfileId: await tripBrandProfileId(trip),
    });
    emailedTo = delivered.to;
  } catch (error) {
    const message = error instanceof EmailError ? error.message : 'Could not send the itinerary email.';
    return NextResponse.json({ error: message, link }, { status: 502 });
  }

  await recordAuditEvent({
    action: 'trip.share.emailed',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: trip.reference, emailedTo, includeCrew, includeAttachments },
    request,
  });

  return NextResponse.json({ link, emailedTo });
}
