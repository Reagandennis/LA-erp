import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { EmailError, isEmailConfigured } from '@/lib/email';
import { getInvoice, sendInvoice } from '@/lib/invoices';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { emailInvoiceToCustomer } from '@/lib/transactional-email';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
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
  if (invoice.status === 'Void') {
    return NextResponse.json({ error: 'Cannot send a void invoice' }, { status: 400 });
  }
  if (invoice.status === 'Draft' || invoice.status === 'Pending Approval' || invoice.status === 'Declined') {
    return NextResponse.json(
      { error: 'This invoice must be approved before it can be sent' },
      { status: 400 },
    );
  }
  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: 'Email is not set up yet. Configure SMTP under Admin → Email.' },
      { status: 400 },
    );
  }
  if (!invoice.customer.email) {
    return NextResponse.json(
      { error: 'This client has no email address on file. Add one before sending.' },
      { status: 400 },
    );
  }

  // Deliver first; only mark the invoice as sent if the email actually goes out.
  let emailedTo: string;
  try {
    const delivered = await emailInvoiceToCustomer(invoice);
    emailedTo = delivered.to;
  } catch (error) {
    const message = error instanceof EmailError ? error.message : 'Could not send the invoice email.';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const sent = await sendInvoice(id);
  if ('error' in sent) {
    return NextResponse.json({ error: sent.error }, { status: 400 });
  }

  await recordAuditEvent({
    action: 'invoice.sent',
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { number: sent.number, emailedTo },
    request,
  });

  return NextResponse.json({ invoice: sent, emailedTo });
}
