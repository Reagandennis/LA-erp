import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { requireModuleRequest } from '@/lib/request-auth';
import { saveTripCloseout } from '@/lib/trip-closeout';
import { tripCloseoutSaveSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tripId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tripCloseout);
  if (response || !auth) return response;

  const { tripId: raw } = await params;
  const tripId = parseId(raw);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripCloseoutSaveSchema.safeParse(body ?? {});
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const result = await saveTripCloseout({ tripId, userId: auth.user.id, input: validation.data });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const closed = validation.data.closed;
  await recordAuditEvent({
    action: closed && !result.wasClosed
      ? 'trip.closeout.closed'
      : !closed && result.wasClosed
        ? 'trip.closeout.reopened'
        : 'trip.closeout.updated',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, checks: result.closeout.checks, changed: result.changed },
    request,
  });

  return NextResponse.json({ closeout: result.closeout });
}
