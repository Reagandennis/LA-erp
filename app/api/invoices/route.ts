import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { createInvoice, listInvoices } from '@/lib/invoices';
import { prisma } from '@/lib/prisma';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { invoiceCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const invoices = await listInvoices();
  return NextResponse.json({ invoices });
}

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
  const validation = invoiceCreateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: validation.data.customerId },
    select: { id: true },
  });
  if (!customer) return NextResponse.json({ error: 'Client not found' }, { status: 400 });

  if (validation.data.brandProfileId) {
    const brand = await prisma.brandProfile.findUnique({
      where: { id: validation.data.brandProfileId },
      select: { id: true, archived: true },
    });
    if (!brand || brand.archived) {
      return NextResponse.json({ error: 'Selected company is not available' }, { status: 400 });
    }
  }

  const invoice = await createInvoice({
    customerId: validation.data.customerId,
    brandProfileId: validation.data.brandProfileId ?? null,
    sourceQuoteId: validation.data.sourceQuoteId ?? null,
    issueDate: validation.data.issueDate,
    dueDate: validation.data.dueDate,
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
    action: 'invoice.created',
    entityType: 'invoice',
    entityId: String(invoice.id),
    actorUserId: auth.user.id,
    metadata: { number: invoice.number, customerId: invoice.customer.id },
    request,
  });

  return NextResponse.json({ invoice }, { status: 201 });
}
