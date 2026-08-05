import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { QUICKBOOKS_STATE_COOKIE, completeQuickBooksConnection } from '@/lib/quickbooks';
import { requireRequestAuth } from '@/lib/request-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function backToInvoices(request: NextRequest, outcome: 'connected' | 'error') {
  const url = new URL('/modules/invoices-review', request.nextUrl.origin);
  url.searchParams.set('quickbooks', outcome);
  const response = NextResponse.redirect(url);
  response.cookies.delete(QUICKBOOKS_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const code = request.nextUrl.searchParams.get('code');
  const realmId = request.nextUrl.searchParams.get('realmId');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(QUICKBOOKS_STATE_COOKIE)?.value;

  if (!code || !realmId || !state || !expectedState || state !== expectedState) {
    return backToInvoices(request, 'error');
  }

  try {
    await completeQuickBooksConnection({ code, realmId, userId: auth.user.id });
  } catch (error) {
    console.error('[quickbooks] OAuth callback failed:', error);
    return backToInvoices(request, 'error');
  }

  await recordAuditEvent({
    action: 'quickbooks.connected',
    entityType: 'integration',
    entityId: realmId,
    actorUserId: auth.user.id,
    request,
  });

  return backToInvoices(request, 'connected');
}
