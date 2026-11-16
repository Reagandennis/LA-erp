import { NextRequest, NextResponse } from 'next/server';

import { hashPassword, verifyPassword } from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { isPrismaDatabaseUnavailableError } from '@/lib/prisma-errors';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getUserByEmail, resetManagedUserPassword } from '@/lib/user';
import { changePasswordSchema } from '@/lib/validation';

function getRequestIp(request: NextRequest) {
  // Caddy (our only trusted proxy, on localhost) appends the real client IP to
  // the END of X-Forwarded-For. Read the last hop so a client-supplied XFF
  // header can't spoof the IP used for rate limiting / audit logging.
  const xff = request.headers.get('x-forwarded-for');
  if (!xff) return null;
  const hops = xff.split(',').map((part) => part.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

/**
 * Lets someone change their own password from the sign-in screen. There is no
 * session here: the email and current password are the proof of identity, so
 * this is guarded like the login route (same rate limit, same vague errors).
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const validation = changePasswordSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const { email, currentPassword, newPassword } = validation.data;
  const ipAddress = getRequestIp(request);

  try {
    const rateLimit = await enforceRateLimit({
      scope: 'auth.password.change',
      key: `${email}:${ipAddress ?? 'unknown'}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many attempts. Try again shortly.',
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    const user = await getUserByEmail(email);

    if (!user) {
      await recordAuditEvent({
        action: 'auth.password.change.failed',
        entityType: 'user',
        metadata: { reason: 'unknown-user', email },
        request,
      });

      return NextResponse.json(
        { error: 'Invalid email or current password' },
        { status: 401 },
      );
    }

    const validPassword = await verifyPassword(currentPassword, user.passwordHash);

    if (!validPassword) {
      await recordAuditEvent({
        action: 'auth.password.change.failed',
        entityType: 'user',
        entityId: String(user.id),
        actorUserId: user.id,
        targetUserId: user.id,
        metadata: { reason: 'bad-password', email },
        request,
      });

      return NextResponse.json(
        { error: 'Invalid email or current password' },
        { status: 401 },
      );
    }

    if (user.status !== 'active') {
      await recordAuditEvent({
        action: 'auth.password.change.failed',
        entityType: 'user',
        entityId: String(user.id),
        actorUserId: user.id,
        targetUserId: user.id,
        metadata: { reason: 'inactive-status', status: user.status },
        request,
      });

      return NextResponse.json(
        { error: 'Account access has been restricted' },
        { status: 403 },
      );
    }

    // Also signs the account out everywhere, so a session opened with the old
    // password does not outlive it.
    await resetManagedUserPassword({
      userId: user.id,
      passwordHash: await hashPassword(newPassword),
    });

    await recordAuditEvent({
      action: 'auth.password.changed',
      entityType: 'user',
      entityId: String(user.id),
      actorUserId: user.id,
      targetUserId: user.id,
      request,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (isPrismaDatabaseUnavailableError(error)) {
      return NextResponse.json(
        {
          error:
            'Changing passwords is temporarily unavailable. Make sure PostgreSQL is running, then try again.',
        },
        { status: 503 },
      );
    }

    throw error;
  }
}
