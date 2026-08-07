import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { isEmailConfigured } from '@/lib/email';
import { decideInvoice } from '@/lib/invoices';
import { emailInvoiceDecisionToCreator } from '@/lib/transactional-email';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { invoiceDecisionSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function parseId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  const isAdmin = userHasRole(auth.user, ADMIN_ROLE_NAME);
  if (!isAdmin && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { invoiceId: raw } = await params;
  const id = parseId(raw);
  if (!id) return NextResponse.json({ error: 'Invalid invoice id' }, { status: 400 });

  const body = await request.json().catch(() => null);
  const validation = invoiceDecisionSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await decideInvoice({
    id,
    userId: auth.user.id,
    isAdmin,
    decision: validation.data.decision,
    note: validation.data.note ?? null,
  });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'Invoice not found' ? 404 : 400 });
  }

  // Best-effort decision email back to whoever created the invoice.
  if (isEmailConfigured() && result.createdBy.email) {
    try {
      await emailInvoiceDecisionToCreator({
        invoice: result,
        decision: validation.data.decision,
        note: validation.data.note ?? null,
        reviewUrl: new URL('/modules/invoices-review', request.nextUrl.origin).toString(),
      });
    } catch (error) {
      console.error('[invoices] decision email failed:', error);
    }
  }

  await recordAuditEvent({
    action: `invoice.${validation.data.decision}`,
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { number: result.number },
    request,
  });

  return NextResponse.json({ invoice: result });
}
