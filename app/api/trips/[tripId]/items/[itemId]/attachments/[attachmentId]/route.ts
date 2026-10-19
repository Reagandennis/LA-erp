import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { API_ACCESS } from '@/lib/api-access';
import { fileResponse } from '@/lib/file-response';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { deleteTripItemAttachment, getTripItemAttachmentFile } from '@/lib/trip-attachments';
import { tripForViewer } from '@/lib/trip-costs';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ tripId: string; itemId: string; attachmentId: string }> };

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function parseParams(params: Params['params']) {
  const raw = await params;
  const tripId = parseId(raw.tripId);
  const itemId = parseId(raw.itemId);
  const attachmentId = parseId(raw.attachmentId);
  return tripId && itemId && attachmentId ? { tripId, itemId, attachmentId } : null;
}

/** The file (`?download=1` forces a download), or its preview with `?thumb=1`. */
export async function GET(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const ids = await parseParams(params);
  if (!ids) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const sp = request.nextUrl.searchParams;
  const file = await getTripItemAttachmentFile({
    ...ids,
    userId: auth.user.id,
    isAdmin: userHasRole(auth.user, ADMIN_ROLE_NAME),
    thumbnail: sp.get('thumb') === '1',
  });
  if (!file) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

  return fileResponse({
    ...file,
    download: sp.get('download') === '1',
    // An attachment never changes under its id; only the viewer's browser keeps it.
    cacheControl: 'private, max-age=86400, immutable',
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const ids = await parseParams(params);
  if (!ids) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const result = await deleteTripItemAttachment({
    ...ids,
    userId: auth.user.id,
    isAdmin: userHasRole(auth.user, ADMIN_ROLE_NAME),
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  await recordAuditEvent({
    action: 'trip.itinerary.item.attachment.removed',
    entityType: 'trip',
    entityId: String(ids.tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, itemId: ids.itemId, attachmentId: ids.attachmentId },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) });
}
