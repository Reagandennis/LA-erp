import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { EmailError, isEmailConfigured } from '@/lib/email';
import { getQuoteForUser, markQuoteSent } from '@/lib/quotes';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { emailQuoteToCustomer } from '@/lib/transactional-email';
import { userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseQuoteId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.quotes);
  if (response || !auth) return response;

  const { quoteId: raw } = await params;
  const quoteId = parseQuoteId(raw);
  if (!quoteId) {
    return NextResponse.json({ error: 'Invalid quote id' }, { status: 400 });
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const quote = await getQuoteForUser({ id: quoteId, userId: auth.user.id, isAdmin });
  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  // Validate up-front so we never email a quote we can't actually dispatch.
  if (!isAdmin && quote.createdBy.id !== auth.user.id) {
    return NextResponse.json({ error: 'Only the creator can dispatch this quote' }, { status: 403 });
  }
  if (quote.status !== 'Approved') {
    return NextResponse.json({ error: 'Only approved quotes can be marked as sent' }, { status: 400 });
  }
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: 'Email is not set up yet. Configure SMTP under Admin → Email.' },
      { status: 400 },
    );
  }
  if (!quote.customer.email) {
    return NextResponse.json(
      { error: 'This client has no email address on file. Add one before sending.' },
      { status: 400 },
    );
  }

  // Deliver first; only mark the quote as sent if the email actually goes out.
  let emailedTo: string;
  try {
    const delivered = await emailQuoteToCustomer(quote);
    emailedTo = delivered.to;
  } catch (error) {
    const message = error instanceof EmailError ? error.message : 'Could not send the quote email.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const result = await markQuoteSent({ id: quoteId, userId: auth.user.id, isAdmin });
  if ('error' in result) {
    const status = result.error === 'Quote not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: 'quote.sent',
    entityType: 'quote',
    entityId: String(quoteId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference, emailedTo },
    request,
  });

  return NextResponse.json({ quote: result, emailedTo });
}
