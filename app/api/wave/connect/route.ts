import { randomUUID } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';
import { WAVE_STATE_COOKIE, buildAuthorizeUrl, isWaveConfigured } from '@/lib/wave';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!userHasRole(auth.user, ADMIN_ROLE_NAME) && !userHasModule(auth.user, 'invoices-review')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!isWaveConfigured()) {
    return NextResponse.json(
      { error: 'Wave is not configured. Set WAVE_CLIENT_ID and WAVE_CLIENT_SECRET.' },
      { status: 400 },
    );
  }

  const state = randomUUID();
  const redirect = NextResponse.redirect(buildAuthorizeUrl(state));
  redirect.cookies.set(WAVE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return redirect;
}
