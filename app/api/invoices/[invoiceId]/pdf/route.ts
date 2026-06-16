import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { buildInvoicePdf } from '@/lib/document-pdf';
import { getInvoice } from '@/lib/invoices';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

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

  const buffer = await buildInvoicePdf(invoice);

  await recordAuditEvent({
    action: 'invoice.pdf.downloaded',
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { number: invoice.number },
    request,
  });

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${invoice.number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
