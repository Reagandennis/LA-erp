import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

import { prisma } from './prisma';
import {
  SESSION_COOKIE_NAME,
  getSessionCookieValue,
  getSessionDurationSeconds,
  signSessionToken,
  verifySessionToken,
} from './session-token';
import { buildAccessUser, userAccessInclude } from './user';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(input: {
  userId: number;
  email: string;
  sessionVersion: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}) {
  const session = await prisma.session.create({
    data: {
      userId: input.userId,
      expiresAt: new Date(Date.now() + getSessionDurationSeconds() * 1000),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  return {
    session,
    token: signSessionToken({
      userId: input.userId,
      sessionId: session.id,
      email: input.email,
      sessionVersion: input.sessionVersion,
    }),
  };
}

export async function revokeSessionById(sessionId: string) {
  await prisma.session.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

async function resolveAuthenticatedUser(token: string | null) {
  if (!token) {
    return null;
  }

  const payload = verifySessionToken(token);

  if (!payload) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    include: {
      user: {
        include: userAccessInclude,
      },
    },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  const user = session.user;

  if (
    !user ||
    user.status !== 'active' ||
    user.sessionVersion !== payload.ver ||
    user.id !== Number(payload.sub)
  ) {
    return null;
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
    user: buildAccessUser(user),
  };
}

export async function getRequestAuth(request: NextRequest) {
  return resolveAuthenticatedUser(getSessionCookieValue(request));
}

export async function getServerAuth() {
  const cookieStore = await cookies();
  return resolveAuthenticatedUser(
    cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null,
  );
}
