import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { deleteInvoice, getInvoice, updateInvoice } from '@/lib/invoices';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { invoiceUpdateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });

  const invoice = await getInvoice(id);
  if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
  return NextResponse.json({ invoice });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = invoiceUpdateSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await updateInvoice({
    id,
    input: {
      customerId: validation.data.customerId,
      brandProfileId: validation.data.brandProfileId,
      issueDate: validation.data.issueDate,
      dueDate: validation.data.dueDate,
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
    const status = result.error === 'Invoice not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: 'invoice.updated',
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { number: result.number },
    request,
  });

  return NextResponse.json({ invoice: result });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });

  const result = await deleteInvoice(id);
  if (result !== true) {
    const status = result.error === 'Invoice not found' ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  await recordAuditEvent({
    action: 'invoice.deleted',
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    request,
  });

  return NextResponse.json({ success: true });
}
