import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { submitQuote } from '@/lib/quotes';
import { userHasRole } from '@/lib/user';

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

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await submitQuote({ id: quoteId, userId: auth.user.id, isAdmin });

  if ('error' in result) {
    const status = result.error === 'Quote not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: 'quote.submitted',
    entityType: 'quote',
    entityId: String(quoteId),
    actorUserId: auth.user.id,
    targetUserId: result.approver?.id ?? null,
    metadata: { reference: result.reference },
    request,
  });

  return NextResponse.json({ quote: result });
}
