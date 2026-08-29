import { NextRequest, NextResponse } from 'next/server';

import { clearDriveToken, driveTokenExpiry, storeDriveToken } from '@/lib/google-drive-session';
import { ADMIN_ROLE_NAME } from '@/lib/rbac';
import { requireRequestAuth } from '@/lib/request-auth';
import { userHasModule, userHasRole } from '@/lib/user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const MODULE_SLUG = 'google-drive-storage';

type AuthUser = Parameters<typeof userHasRole>[0];
function canUse(user: AuthUser): boolean {
  return userHasRole(user, ADMIN_ROLE_NAME) || userHasModule(user, MODULE_SLUG);
}

/** Whether this user currently has a live Google connection. */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const expiresAt = driveTokenExpiry(auth.user.id);
  return NextResponse.json({
    connected: expiresAt !== null,
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
  });
}

/**
 * Hand the server a Google access token obtained in the browser.
 *
 * Stored in memory against the session user so subsequent GETs (thumbnails,
 * downloads) don't have to carry the token in their URLs.
 */
export async function POST(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { accessToken?: unknown } | null;
  const token = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'A Google access token is required.' }, { status: 400 });
  }

  storeDriveToken(auth.user.id, token);
  return NextResponse.json({ connected: true });
}

/** Disconnect: forget the token. The Google grant itself is unaffected. */
export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) return response;
  if (!canUse(auth.user)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  clearDriveToken(auth.user.id);
  return NextResponse.json({ connected: false });
}
