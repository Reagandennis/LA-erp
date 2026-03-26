import { NextRequest, NextResponse } from 'next/server';

import {
  createSession,
  verifyPassword,
} from '@/lib/auth';
import { recordAuditEvent } from '@/lib/audit';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSessionCookieOptions } from '@/lib/session-token';
import { getUserByEmail } from '@/lib/user';
import { loginSchema } from '@/lib/validation';

function getRequestIp(request: NextRequest) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
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
}
