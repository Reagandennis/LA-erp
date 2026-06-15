import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import {
  deleteQuote,
  getQuoteForUser,
  updateDraftQuote,
} from '@/lib/quotes';
import { userHasRole } from '@/lib/user';
import { quoteUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseQuoteId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
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
  const quote = await getQuoteForUser({ id: quoteId, userId: auth.user.id, isAdmin });

  if (!quote) {
    return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
  }

  return NextResponse.json({ quote });
}

export async function PATCH(
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
  const validation = quoteUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const result = await updateDraftQuote({
    id: quoteId,
    userId: auth.user.id,
    isAdmin,
    input: {
      customerId: validation.data.customerId,
      approverId: validation.data.approverId,
      brandProfileId: validation.data.brandProfileId,
      subject: validation.data.subject,
      issueDate: validation.data.issueDate,
      expiryDate: validation.data.expiryDate,
      currency: validation.data.currency,
      taxRate: validation.data.taxRate,
      discountType: validation.data.discountType,
      discountValue: validation.data.discountValue,
      notes: validation.data.notes,
      terms: validation.data.terms,
      items: validation.data.items,
    },
  });

  if ('error' in result) {
    const status = result.error === 'Quote not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: 'quote.updated',
    entityType: 'quote',
    entityId: String(quoteId),
    actorUserId: auth.user.id,
    metadata: { reference: result.reference },
    request,
  });

  return NextResponse.json({ quote: result });
}

export async function DELETE(
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
  const result = await deleteQuote({ id: quoteId, userId: auth.user.id, isAdmin });

  if (result !== true) {
    const status = result.error === 'Quote not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: 'quote.deleted',
    entityType: 'quote',
    entityId: String(quoteId),
    actorUserId: auth.user.id,
    request,
  });

  return NextResponse.json({ success: true });
}
