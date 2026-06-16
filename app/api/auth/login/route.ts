import { NextRequest, NextResponse } from 'next/server';

import {
  createSession,
  verifyPassword,
} from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { isPrismaDatabaseUnavailableError } from '@/lib/prisma-errors';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSessionCookieOptions } from '@/lib/session-token';
import { getUserByEmail } from '@/lib/user';
import { loginSchema } from '@/lib/validation';

function getRequestIp(request: NextRequest) {
  // Caddy (our only trusted proxy, on localhost) appends the real client IP to
  // the END of X-Forwarded-For. Read the last hop so a client-supplied XFF
  // header can't spoof the IP used for rate limiting / audit logging.
  const xff = request.headers.get('x-forwarded-for');
  if (!xff) return null;
  const hops = xff.split(',').map((part) => part.trim()).filter(Boolean);
  return hops.length ? hops[hops.length - 1] : null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const validation = loginSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 400 });
  }

  const { email, password } = validation.data;
  const ipAddress = getRequestIp(request);
  const userAgent = request.headers.get('user-agent');

  try {
    const rateLimit = await enforceRateLimit({
      scope: 'auth.login',
      key: `${email}:${ipAddress ?? 'unknown'}`,
      limit: 5,
      windowMs: 15 * 60 * 1000,
    });

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Too many login attempts. Try again shortly.',
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
        action: 'auth.login.failed',
        entityType: 'session',
        metadata: { reason: 'unknown-user', email },
        request,
      });

      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 },
      );
    }

    const validPassword = await verifyPassword(password, user.passwordHash);

    if (!validPassword) {
      await recordAuditEvent({
        action: 'auth.login.failed',
        entityType: 'session',
        actorUserId: user.id,
        targetUserId: user.id,
        metadata: { reason: 'bad-password', email },
        request,
      });

      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 },
      );
    }

    if (user.status !== 'active') {
      await recordAuditEvent({
        action: 'auth.login.failed',
        entityType: 'session',
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

    const { session, token } = await createSession({
      userId: user.id,
      email: user.email,
      sessionVersion: user.sessionVersion,
      ipAddress,
      userAgent,
    });

    await recordAuditEvent({
      action: 'auth.login.succeeded',
      entityType: 'session',
      entityId: session.id,
      actorUserId: user.id,
      targetUserId: user.id,
      request,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
      },
    });

    response.cookies.set(getSessionCookieOptions(token));
    return response;
  } catch (error) {
    if (isPrismaDatabaseUnavailableError(error)) {
      return NextResponse.json(
        {
          error:
            'Authentication is temporarily unavailable. Make sure PostgreSQL is running, then try again.',
        },
        { status: 503 },
      );
    }

    throw error;
  }
}
