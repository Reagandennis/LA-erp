import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { createQuote, listQuotesForUser } from '@/lib/quotes';
import { userHasRole } from '@/lib/user';
import { quoteCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  const quotes = await listQuotesForUser({ userId: auth.user.id, isAdmin });
  return NextResponse.json({ quotes });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'quote.create',
    key: `${auth.user.id}`,
    limit: 30,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many quote actions. Slow down and try again.',
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  const validation = quoteCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const customer = await (
    prisma as unknown as {
      customer: {
        findUnique: (args: { where: { id: number } }) => Promise<{ id: number } | null>;
      };
    }
  ).customer.findUnique({ where: { id: validation.data.customerId } });
  if (!customer) {
    return NextResponse.json({ error: 'Customer not found' }, { status: 400 });
  }

  if (validation.data.approverId) {
    if (validation.data.approverId === auth.user.id) {
      return NextResponse.json(
        { error: 'You cannot assign yourself as the approver' },
        { status: 400 },
      );
    }
    const approver = await prisma.user.findUnique({
      where: { id: validation.data.approverId },
      select: { id: true, status: true },
    });
    if (!approver || approver.status !== 'active') {
      return NextResponse.json({ error: 'Approver is not available' }, { status: 400 });
    }
  }

  if (validation.data.brandProfileId) {
    const brand = await prisma.brandProfile.findUnique({
      where: { id: validation.data.brandProfileId },
      select: { id: true, archived: true },
    });
    if (!brand || brand.archived) {
      return NextResponse.json({ error: 'Selected company is not available' }, { status: 400 });
    }
  }

  const quote = await createQuote({
    customerId: validation.data.customerId,
    approverId: validation.data.approverId ?? null,
    brandProfileId: validation.data.brandProfileId ?? null,
    subject: validation.data.subject,
    issueDate: validation.data.issueDate,
    expiryDate: validation.data.expiryDate,
    currency: validation.data.currency,
    taxRate: validation.data.taxRate,
    discountType: validation.data.discountType,
    discountValue: validation.data.discountValue,
    notes: validation.data.notes ?? null,
    terms: validation.data.terms ?? null,
    items: validation.data.items,
    createdById: auth.user.id,
  });

  await recordAuditEvent({
    action: 'quote.created',
    entityType: 'quote',
    entityId: String(quote.id),
    actorUserId: auth.user.id,
    metadata: { reference: quote.reference, customerId: quote.customer.id },
    request,
  });

  return NextResponse.json({ quote }, { status: 201 });
}
