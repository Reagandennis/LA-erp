import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { getQuoteForUser } from '@/lib/quotes';
import { createTripFromQuote } from '@/lib/trips';
import { userHasRole } from '@/lib/user';
import { tripFromQuoteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseQuoteId(value: string) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quotes);
  if (response || !auth) return response;

  const { quoteId: raw } = await params;
  const quoteId = parseQuoteId(raw);
  if (!quoteId) return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 });

  const rateLimit = await enforceRateLimit({
    scope: 'quote.trip.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many trip-from-quote actions. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const validation = tripFromQuoteSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);

  // Authorisation: the actor must be a participant on the quote (creator/approver/admin)
  const quote = await getQuoteForUser({ id: quoteId, userId: auth.user.id, isAdmin });
  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  const result = await createTripFromQuote({
    quoteId,
    actorUserId: auth.user.id,
    ownerId: validation.data.ownerId ?? null,
    title: validation.data.title ?? undefined,
    description: validation.data.description ?? null,
    startDate: validation.data.startDate ?? null,
    endDate: validation.data.endDate ?? null,
    notes: validation.data.notes ?? null,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status ?? 400 });
  }

  await recordAuditEvent({
    action: 'quote.trip.created',
    entityType: 'trip',
    entityId: String(result.trip.id),
    actorUserId: auth.user.id,
    metadata: {
      quoteId,
      tripId: result.trip.id,
      tripReference: result.trip.reference,
      trackingCode: result.trackingCode,
      itemCount: result.trip.items.length,
    },
    request,
  });

  // Return the latest quote alongside the new trip so the client can refresh both
  const refreshedQuote = await getQuoteForUser({ id: quoteId, userId: auth.user.id, isAdmin });

  return NextResponse.json({ trip: result.trip, quote: refreshedQuote }, { status: 201 });
}
