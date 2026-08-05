import 'server-only';

import { prisma } from './prisma';

/** How stale a session heartbeat may get before we write a fresh one. */
export const PRESENCE_HEARTBEAT_MS = 60 * 1000;

/** Seen within this window → online. */
const ONLINE_WINDOW_MS = 3 * 60 * 1000;
/** Seen within this window → away (signed in, but idle). */
const AWAY_WINDOW_MS = 30 * 60 * 1000;

export type PresenceStatus = 'online' | 'away' | 'offline';

export interface UserPresence {
  userId: number;
  status: PresenceStatus;
  /** ISO timestamp of the most recent heartbeat, or null if never seen. */
  lastSeenAt: string | null;
}

export function statusFor(lastSeenAt: Date | null): PresenceStatus {
  if (!lastSeenAt) return 'offline';

  const age = Date.now() - lastSeenAt.getTime();
  if (age <= ONLINE_WINDOW_MS) return 'online';
  if (age <= AWAY_WINDOW_MS) return 'away';
  return 'offline';
}

/**
 * Presence for the given users, derived from their freshest live session.
 * A user with no unrevoked, unexpired session is offline.
 */
export async function getPresenceFor(userIds: number[]): Promise<UserPresence[]> {
  const unique = [...new Set(userIds)].filter((id) => Number.isInteger(id));

  if (unique.length === 0) {
    return [];
  }

  const sessions = await prisma.session.groupBy({
    by: ['userId'],
    where: {
      userId: { in: unique },
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    _max: { lastSeenAt: true },
  });

  const freshest = new Map(
    sessions.map((row) => [row.userId, row._max.lastSeenAt ?? null]),
  );

  return unique.map((userId) => {
    const lastSeenAt = freshest.get(userId) ?? null;
    return {
      userId,
      status: statusFor(lastSeenAt),
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    };
  });
}

/** Presence for every active user — used by admin and people directories. */
export async function getAllPresence(): Promise<UserPresence[]> {
  const users = await prisma.user.findMany({
    where: { status: 'active' },
    select: { id: true },
  });

  return getPresenceFor(users.map((user) => user.id));
}
