import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { canSeeTripCosts, tripForViewer } from '@/lib/trip-costs';
import {
  TRIP_PAGE_SIZE_MAX,
  TRIP_SORTS,
  TRIP_STATUSES,
  TripTravelerError,
  createTrip,
  listTripsForUser,
  searchTrips,
  type TripSort,
  type TripStatus,
} from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripCreateSchema } from '@/lib/validation';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SEARCH_PARAMS = ['q', 'status', 'sort', 'page', 'pageSize'] as const;

const tripSearchQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(TRIP_STATUSES as [TripStatus, ...TripStatus[]]).optional(),
  sort: z.enum(TRIP_SORTS as [TripSort, ...TripSort[]]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(TRIP_PAGE_SIZE_MAX).optional(),
});

/**
 * With `q`, `status`, `sort`, `page` or `pageSize` the response is one page
 * (`{ trips, total, page, pageSize }`); with none it is the whole list
 * (`{ trips }`), which other screens still read.
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const searchParams = request.nextUrl.searchParams;
  if (!SEARCH_PARAMS.some((key) => searchParams.has(key))) {
    const trips = await listTripsForUser({ userId: auth.user.id, isAdmin });
    return NextResponse.json({ trips });
  }

  const validation = tripSearchQuerySchema.safeParse(
    Object.fromEntries(SEARCH_PARAMS.flatMap((key) => (searchParams.has(key) ? [[key, searchParams.get(key)]] : []))),
  );
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid query' }, { status: 400 });
  }
  const page = await searchTrips({ userId: auth.user.id, isAdmin, ...validation.data });
  return NextResponse.json(page);
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.trips);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'trip.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many trip actions. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = tripCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  let trip;
  try {
    trip = await createTrip({
      customerId: validation.data.customerId,
      country: validation.data.country,
      clientCode: validation.data.clientCode ?? null,
      travelers: validation.data.travelers,
      ownerId: validation.data.ownerId ?? null,
      title: validation.data.title,
      description: validation.data.description ?? null,
      status: validation.data.status,
      startDate: validation.data.startDate ?? null,
      endDate: validation.data.endDate ?? null,
      currency: validation.data.currency,
      notes: validation.data.notes ?? null,
      items: validation.data.items.map((item) => ({
        itemType: item.itemType,
        description: item.description,
        subtitle: item.subtitle ?? null,
        quantity: item.quantity,
        unitPrice: canSeeTripCosts(auth.user) ? (item.unitPrice ?? null) : null,
        sourceQuoteItemId: item.sourceQuoteItemId ?? null,
        scheduledAt: item.scheduledAt ?? null,
        endsAt: item.endsAt ?? null,
        durationMinutes: item.durationMinutes ?? null,
        reminderMinutesBefore: item.reminderMinutesBefore ?? null,
        imageUrl: item.imageUrl ?? null,
        confirmationCode: item.confirmationCode ?? null,
      })),
      createdById: auth.user.id,
    });
  } catch (error) {
    if (error instanceof TripTravelerError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  await recordAuditEvent({
    action: 'trip.created',
    entityType: 'trip',
    entityId: String(trip.id),
    actorUserId: auth.user.id,
    metadata: { reference: trip.reference, trackingCode: trip.trackingCode },
    request,
  });

  return NextResponse.json({ trip: tripForViewer(trip, auth.user) }, { status: 201 });
}
