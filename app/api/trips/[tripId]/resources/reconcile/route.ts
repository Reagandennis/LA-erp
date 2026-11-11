import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { tripForViewer } from '@/lib/trip-costs';
import { reconcileTripResources } from '@/lib/trip-resources';
import { userHasRole } from '@/lib/user';
import { tripResourceReconcileSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The check before a trip completes: the Controller's verdict on each staged
 * resource no event used (unused and off the bill, or used and logged), and,
 * with `complete`, the move to Completed in the same step.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const tripId = Number((await params).tripId);
  if (!Number.isInteger(tripId) || tripId <= 0) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripResourceReconcileSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await reconcileTripResources({
    tripId,
    userId: auth.user.id,
    isAdmin,
    verdicts: validation.data.verdicts,
    complete: validation.data.complete,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const { trip } = result;
  if (result.resolved > 0) {
    await recordAuditEvent({
      action: 'trip.resources.reconciled',
      entityType: 'trip',
      entityId: String(tripId),
      actorUserId: auth.user.id,
      metadata: {
        reference: trip.reference,
        unused: validation.data.verdicts.filter((verdict) => verdict.resolution === 'unused').map((verdict) => verdict.resourceId),
        kept: validation.data.verdicts.filter((verdict) => verdict.resolution === 'used').map((verdict) => verdict.resourceId),
      },
      request,
    });
  }
  if (result.completed) {
    await recordAuditEvent({
      action: 'trip.status.changed',
      entityType: 'trip',
      entityId: String(tripId),
      actorUserId: auth.user.id,
      metadata: { reference: trip.reference, trackingCode: trip.trackingCode, from: result.previousStatus, to: 'Completed' },
      request,
    });
  }

  return NextResponse.json({ trip: tripForViewer(trip, auth.user) });
}
