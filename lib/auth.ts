import 'server-only';

import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { cache } from 'react';

import { PRESENCE_HEARTBEAT_MS } from './presence';
import { prisma } from './prisma';
import { isPrismaDatabaseUnavailableError } from './prisma-errors';
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

  let session;

  try {
    session = await prisma.session.findUnique({
      where: { id: payload.sid },
      include: {
        user: {
          include: userAccessInclude,
        },
      },
    });
  } catch (error) {
    if (isPrismaDatabaseUnavailableError(error)) {
      console.warn(
        '[auth] Database unavailable while resolving the current session. Treating the request as unauthenticated.',
      );
      return null;
    }

    throw error;
  }

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

  // Presence heartbeat. Throttled so an active user costs at most one write a
  // minute rather than one per request.
  if (Date.now() - session.lastSeenAt.getTime() > PRESENCE_HEARTBEAT_MS) {
    try {
      await prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      });
    } catch {
      // Presence is best-effort; never fail a request over it.
    }
  }

  return {
    sessionId: session.id,
    expiresAt: session.expiresAt.toISOString(),
    user: buildAccessUser(user),
    // Per-user UI preferences that the root layout needs on every render.
    // They ride along on the session row so the layout avoids a second query.
    preferences: {
      worldClockZones: user.worldClockZones,
    },
  };
}

export async function getRequestAuth(request: NextRequest) {
  return resolveAuthenticatedUser(getSessionCookieValue(request));
}

/**
 * Resolves the current user for Server Components.
 *
 * Wrapped in React `cache` so the root layout and the page it renders share a
 * single session lookup per request instead of each hitting the database.
 */
export const getServerAuth = cache(async () => {
  const cookieStore = await cookies();
  return resolveAuthenticatedUser(
    cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null,
  );
});
