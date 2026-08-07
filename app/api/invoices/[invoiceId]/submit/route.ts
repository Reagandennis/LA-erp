import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { isEmailConfigured } from '@/lib/email';
import { submitInvoiceForApproval } from '@/lib/invoices';
import { emailInvoiceApprovalRequest } from '@/lib/transactional-email';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { invoiceSubmitSchema } from '@/lib/validation';

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
  const validation = invoiceSubmitSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json({ error: validation.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 });
  }

  const result = await submitInvoiceForApproval({
    id,
    userId: auth.user.id,
    isAdmin,
    approverId: validation.data.approverId,
  });
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === 'Invoice not found' ? 404 : 400 });
  }

  // The approver already has a bell notification; email them too so approval
  // requests reach people who are not in the app. Best effort — never fail
  // the submission over a mail problem.
  let approverEmailed = false;
  if (isEmailConfigured() && result.approver?.email) {
    try {
      await emailInvoiceApprovalRequest({
        invoice: result,
        approver: { name: result.approver.name, email: result.approver.email },
        submitterName: auth.user.name,
        reviewUrl: new URL('/modules/invoices-review', request.nextUrl.origin).toString(),
      });
      approverEmailed = true;
    } catch (error) {
      console.error('[invoices] approval request email failed:', error);
    }
  }

  await recordAuditEvent({
    action: 'invoice.submitted',
    entityType: 'invoice',
    entityId: String(id),
    actorUserId: auth.user.id,
    metadata: { number: result.number, approverId: validation.data.approverId, approverEmailed },
    request,
  });

  return NextResponse.json({ invoice: result, approverEmailed });
}
