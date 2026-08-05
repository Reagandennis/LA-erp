import { NextRequest, NextResponse } from 'next/server';

import { disconnectQuickBooks, getQuickBooksStatus } from '@/lib/quickbooks';
import { recordAuditEvent } from '@/lib/audit';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  return NextResponse.json(await getQuickBooksStatus());
}

/** Disconnect (revokes the stored token, best effort). */
export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await disconnectQuickBooks();
  await recordAuditEvent({
    action: 'quickbooks.disconnected',
    entityType: 'integration',
    entityId: 'quickbooks',
    actorUserId: auth.user.id,
    request,
  });
  return NextResponse.json(await getQuickBooksStatus());
}
