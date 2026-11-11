import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { billingCsv, buildBillingLog } from '@/lib/trip-resource-model';
import { getTripForUser } from '@/lib/trips';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * The trip's billing log as a CSV: each billable staged service, then every
 * shift and odometer line. Resources verified as unused are left out, so the
 * client is never charged for them. Carries no prices.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const tripId = Number((await params).tripId);
  if (!Number.isInteger(tripId) || tripId <= 0) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trip = await getTripForUser({ id: tripId, userId: auth.user.id, isAdmin });
  if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

  const log = buildBillingLog(trip);
  const csv = billingCsv(log, { reference: trip.reference, client: trip.customer.name });

  await recordAuditEvent({
    action: 'trip.billing.exported',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: { reference: trip.reference, services: log.services.length, dayLines: log.days.length, notBilled: log.notBilled.length },
    request,
  });

  const filename = `${trip.reference.replace(/[^A-Za-z0-9._-]+/g, '-')}-billing-log.csv`;
  // BOM so Excel opens the UTF-8 (names with accents) correctly.
  return new NextResponse(new Uint8Array(Buffer.from('﻿' + csv, 'utf8')), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
