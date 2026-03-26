import { NextRequest, NextResponse } from 'next/server';

import {
  getRequestAuth,
  revokeSessionById,
} from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { getClearedSessionCookieOptions } from '@/lib/session-token';

export async function POST(request: NextRequest) {
  const auth = await getRequestAuth(request);

  if (auth) {
    await revokeSessionById(auth.sessionId);
    await recordAuditEvent({
      action: 'auth.logout',
      entityType: 'session',
      entityId: auth.sessionId,
      actorUserId: auth.user.id,
      targetUserId: auth.user.id,
      request,
    });
  }

  const response = NextResponse.json({
    success: true,
    message: 'Logged out successfully',
  });

  response.cookies.set(getClearedSessionCookieOptions());
  return response;
}
