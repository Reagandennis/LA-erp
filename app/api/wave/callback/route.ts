import { NextRequest, NextResponse } from 'next/server';

import { recordAuditEvent } from '@/lib/audit';
import { requireRequestAuth } from '@/lib/request-auth';
import { WAVE_STATE_COOKIE, completeWaveConnection } from '@/lib/wave';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function backToInvoices(request: NextRequest, outcome: 'connected' | 'error') {
  const url = new URL('/modules/invoices-review', request.nextUrl.origin);
  url.searchParams.set('wave', outcome);
  const response = NextResponse.redirect(url);
  response.cookies.delete(WAVE_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const expectedState = request.cookies.get(WAVE_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return backToInvoices(request, 'error');
  }

  try {
    await completeWaveConnection({ code, userId: auth.user.id });
  } catch (error) {
    console.error('[wave] OAuth callback failed:', error);
    return backToInvoices(request, 'error');
  }

  await recordAuditEvent({
    action: 'wave.connected',
    entityType: 'integration',
    entityId: 'wave',
    actorUserId: auth.user.id,
    request,
  });

  return backToInvoices(request, 'connected');
}
