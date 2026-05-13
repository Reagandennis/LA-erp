import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { createTrip, listTripsForUser } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const trips = await listTripsForUser({ userId: auth.user.id, isAdmin });
  return NextResponse.json({ trips });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
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

  const trip = await createTrip({
    customerId: validation.data.customerId,
    ownerId: validation.data.ownerId ?? null,
    title: validation.data.title,
    description: validation.data.description ?? null,
    status: validation.data.status,
    startDate: validation.data.startDate ?? null,
    endDate: validation.data.endDate ?? null,
    currency: validation.data.currency,
    notes: validation.data.notes ?? null,
    items: validation.data.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice ?? null,
      sourceQuoteItemId: item.sourceQuoteItemId ?? null,
    })),
    createdById: auth.user.id,
  });

  await recordAuditEvent({
    action: 'trip.created',
    entityType: 'trip',
    entityId: String(trip.id),
    actorUserId: auth.user.id,
    metadata: { reference: trip.reference, trackingCode: trip.trackingCode },
    request,
  });

  return NextResponse.json({ trip }, { status: 201 });
}
