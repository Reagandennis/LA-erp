import { NextRequest, NextResponse } from 'next/server';

import { listActiveSessions, revokeSession, revokeUserSessions } from '@/lib/admin-console';
import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireAdminRequest } from '@/lib/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Signed-in sessions across all users.
 *
 * GET                    every live session
 * DELETE ?id=<session>   sign that one session out
 * DELETE ?userId=<id>    sign that user out everywhere (for yourself: every
 *                        session except the one making the request)
 */
export async function GET(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;
  return NextResponse.json({ sessions: await listActiveSessions(auth.sessionId) });
}

export async function DELETE(request: NextRequest) {
  const { auth, response } = await requireAdminRequest(request);
  if (response || !auth) return response;

  const rateLimit = await enforceRateLimit({
    scope: 'admin.session.revoke',
    key: `${auth.user.id}`,
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many sign-outs. Slow down and try again.', retryAfterSeconds: rateLimit.retryAfterSeconds },
      { status: 429 },
    );
  }

  const { searchParams } = new URL(request.url);
  const sessionId = (searchParams.get('id') ?? '').trim();
  const userId = Number(searchParams.get('userId'));

  if (sessionId) {
    if (sessionId === auth.sessionId) {
      return NextResponse.json({ error: 'This is your current session. Use Sign out instead.' }, { status: 400 });
    }
    const revoked = await revokeSession(sessionId);
    if (!revoked) return NextResponse.json({ error: 'Session not found or already ended' }, { status: 404 });
    await recordAuditEvent({
      action: 'admin.session.revoked',
      entityType: 'session',
      entityId: revoked.id,
      actorUserId: auth.user.id,
      targetUserId: revoked.userId,
      request,
    });
    return NextResponse.json({ success: true, revoked: 1, sessions: await listActiveSessions(auth.sessionId) });
  }

  if (Number.isInteger(userId) && userId > 0) {
    const keep = userId === auth.user.id ? auth.sessionId : undefined;
    const revoked = await revokeUserSessions(userId, keep);
    if (revoked > 0) {
      await recordAuditEvent({
        action: 'admin.session.revoked_all',
        entityType: 'user',
        entityId: String(userId),
        actorUserId: auth.user.id,
        targetUserId: userId,
        metadata: { sessions: revoked },
        request,
      });
    }
    return NextResponse.json({ success: true, revoked, sessions: await listActiveSessions(auth.sessionId) });
  }

  return NextResponse.json({ error: 'Pass a session id or a user id' }, { status: 400 });
}
