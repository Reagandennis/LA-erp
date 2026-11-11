import { NextRequest, NextResponse } from 'next/server';

import { API_ACCESS } from '@/lib/api-access';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireModuleRequest } from '@/lib/request-auth';
import { SERVICE_COUNTRIES } from '@/lib/service-catalog';
import { tripForViewer } from '@/lib/trip-costs';
import { stageTripResource } from '@/lib/trip-resources';
import { getTripForUser } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripResourceCreateSchema } from '@/lib/validation';
import { listPoolOptions } from '@/lib/vendors';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * What this trip can stage: the approved vendors for a country (the trip's,
 * unless `?country=` names another) and each one's catalog there.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const tripId = parseId((await params).tripId);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trip = await getTripForUser({ id: tripId, userId: auth.user.id, isAdmin });
  if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

  const asked = request.nextUrl.searchParams.get('country');
  const country = asked && (SERVICE_COUNTRIES as readonly string[]).includes(asked) ? asked : trip.country;
  return NextResponse.json({ country, ...(await listPoolOptions(country)) });
}

/** Stages a service from an approved vendor's catalog into the trip's pool. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tripId: string }> }) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const tripId = parseId((await params).tripId);
  if (!tripId) return NextResponse.json({ error: 'Invalid trip id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = tripResourceCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await stageTripResource({ tripId, userId: auth.user.id, isAdmin, input: validation.data });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const staged = result.resources.at(-1);
  await recordAuditEvent({
    action: 'trip.resource.staged',
    entityType: 'trip',
    entityId: String(tripId),
    actorUserId: auth.user.id,
    metadata: {
      reference: result.reference,
      vendor: staged?.vendorName,
      service: staged?.serviceCode ?? staged?.serviceName,
      quantity: validation.data.quantity,
      startDate: validation.data.startDate ?? null,
      endDate: validation.data.endDate ?? null,
    },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(result, auth.user) }, { status: 201 });
}
