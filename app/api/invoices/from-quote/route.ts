import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { createInvoiceFromQuote } from '@/lib/invoices';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { invoiceFromQuoteSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rateLimit = await enforceRateLimit({
    scope: 'invoice.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many invoice actions. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = invoiceFromQuoteSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await createInvoiceFromQuote({
    quoteId: validation.data.quoteId,
    userId: auth.user.id,
    dueInDays: validation.data.dueInDays,
  });

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'Quote not found' ? 404 : 400 });
  }

  await recordAuditEvent({
    action: 'invoice.created',
    entityType: 'invoice',
    entityId: String(result.id),
    actorUserId: auth.user.id,
    metadata: { number: result.number, fromQuoteId: validation.data.quoteId },
    request,
  });

  return NextResponse.json({ invoice: result }, { status: 201 });
}
