import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { API_ACCESS } from '@/lib/api-access';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { addTripItemAttachments } from '@/lib/trip-attachments';
import { tripForViewer } from '@/lib/trip-costs';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Add photos and documents to an itinerary event (multipart, field `files`). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string; itemId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const { tripId: rawTrip, itemId: rawItem } = await params;
  const tripId = parseId(rawTrip);
  const itemId = parseId(rawItem);
  if (!tripId || !itemId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const rateLimit = await enforceRateLimit({
    scope: 'file.upload',
    key: `${auth.user.id}`,
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many uploads. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }
  const files = formData.getAll('files').filter((value): value is File => value instanceof File);

  const result = await addTripItemAttachments({
    tripId,
    itemId,
    userId: auth.user.id,
    isAdmin: userHasRole(auth.user, ADMIN_ROLE_NAME),
    files,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: 'trip.itinerary.item.attachments.added',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, itemId, files: files.map((file) => file.name) },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) }, { status: 201 });
}
