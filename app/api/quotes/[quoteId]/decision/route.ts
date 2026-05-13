import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { decideQuote } from '@/lib/quotes';
import { getUserAccessById, userHasModule, userHasRole } from '@/lib/user';
import { quoteDecisionSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseQuoteId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const { quoteId: raw } = await params;
  const quoteId = parseQuoteId(raw);
  if (!quoteId) {
    return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const validation = quoteDecisionSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await decideQuote({
    id: quoteId,
    userId: auth.user.id,
    isAdmin,
    decision: validation.data.decision,
    note: validation.data.note ?? null,
  });

  if ('error' in result) {
    const status =
      result.error === 'Quote not found'
        ? 404
        : result.error === 'Only the assigned approver can decide this quote'
          ? 403
          : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: validation.data.decision === 'approved' ? 'quote.approved' : 'quote.declined',
    entityType: 'quote',
    entityId: String(quoteId),
    actorUserId: auth.user.id,
    targetUserId: result.createdBy.id,
    metadata: {
      reference: result.reference,
      trackingCode: result.trackingCode,
      note: validation.data.note ?? null,
    },
    request,
  });

  // Server-driven prompt: surface a "create trip" CTA if the actor has the
  // trip-planning module assigned and the quote was approved + has no trip yet.
  let promptCreateTrip = false;
  if (validation.data.decision === 'approved' && result.trip === null) {
    if (isAdmin) {
      promptCreateTrip = true;
    } else {
      const fresh = await getUserAccessById(auth.user.id);
      promptCreateTrip = fresh ? userHasModule(fresh, 'trip-planning') : false;
    }
  }

  return NextResponse.json({
    quote: result,
    prompts: { createTrip: promptCreateTrip },
  });
}
