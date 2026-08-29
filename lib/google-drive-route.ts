import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import { getDriveToken } from './google-drive-session';
import { DriveError } from './google-drive';
import { ADMIN_ROLE_NAME } from './rbac';
import { requireRequestAuth } from './request-auth';
import { userHasModule, userHasRole } from './user';

/**
 * Shared gate for every Drive route.
 *
 * Two checks, both necessary: the caller must hold the module, and must have
 * handed over a live Google token. The token is looked up by session user, so a
 * request can only ever reach that user's own Drive.
 */

const MODULE_SLUG = 'google-drive-storage';

type AuthUser = Parameters<typeof userHasRole>[0];

export interface DriveContext {
  userId: number;
  token: string;
}

export async function resolveDriveRequest(
  request: NextRequest,
): Promise<{ ctx: DriveContext; response: null } | { ctx: null; response: NextResponse }> {
  const { auth, response } = await requireRequestAuth(request);
  if (response || !auth) {
    return {
      ctx: null,
      response: response ?? NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  const user = auth.user as AuthUser;
  if (!userHasRole(user, ADMIN_ROLE_NAME) && !userHasModule(user, MODULE_SLUG)) {
    return { ctx: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const token = getDriveToken(auth.user.id);
  if (!token) {
    // 428 rather than 401: the app session is fine, it's the Google consent
    // that's missing or lapsed, and the client reconnects instead of logging in.
    return {
      ctx: null,
      response: NextResponse.json({ error: 'not-connected' }, { status: 428 }),
    };
  }

  return { ctx: { userId: auth.user.id, token }, response: null };
}

/** Turn a Drive failure into a response, preserving what Google actually said. */
export function driveErrorResponse(error: unknown): NextResponse {
  if (error instanceof DriveError) {
    // A rejected token means the consent lapsed mid-session.
    const status = error.status === 401 || error.status === 403 ? 428 : 502;
    return NextResponse.json(
      { error: status === 428 ? 'not-connected' : error.message },
      { status },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : 'Google Drive request failed' },
    { status: 502 },
  );
}
