import 'server-only';

import { prisma } from './prisma';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Expired or revoked sessions are kept this long for troubleshooting, then deleted. */
export const SESSION_RETENTION_DAYS = 30;
/** Rate-limit buckets are only meaningful inside their window; a day of slack is plenty. */
export const RATE_LIMIT_RETENTION_DAYS = 1;

export async function pruneExpiredSessions(
  now: Date = new Date(),
  retentionDays: number = SESSION_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const { count } = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return count;
}

export async function pruneRateLimitBuckets(
  now: Date = new Date(),
  retentionDays: number = RATE_LIMIT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const { count } = await prisma.rateLimitBucket.deleteMany({
    where: { expiresAt: { lt: cutoff } },
  });
  return count;
}

export async function runMaintenance(): Promise<{ sessions: number; rateLimitBuckets: number }> {
  const sessions = await pruneExpiredSessions();
  const rateLimitBuckets = await pruneRateLimitBuckets();
  if (sessions > 0 || rateLimitBuckets > 0) {
    console.log(
      `[maintenance] pruned ${sessions} session(s) and ${rateLimitBuckets} rate-limit bucket(s).`,
    );
  }
  return { sessions, rateLimitBuckets };
}

export interface MaintenanceSchedule {
  /** Delay before the first run so boot-time work (migrations, seeds) settles first. */
  initialDelayMs?: number;
  intervalMs?: number;
}

/**
 * Runs {@link runMaintenance} shortly after boot and then on an interval.
 * Both timers are unref'd so they never keep the process alive on shutdown.
 * Returns a function that cancels the schedule.
 */
export function scheduleMaintenance({
  initialDelayMs = 60 * 1000,
  intervalMs = 6 * 60 * 60 * 1000,
}: MaintenanceSchedule = {}): () => void {
  let interval: ReturnType<typeof setInterval> | null = null;

  const run = () => {
    runMaintenance().catch((error) => {
      console.error('[maintenance] run failed:', error);
    });
  };

  const initial = setTimeout(() => {
    run();
    interval = setInterval(run, intervalMs);
    interval.unref?.();
  }, initialDelayMs);
  initial.unref?.();

  return () => {
    clearTimeout(initial);
    if (interval) clearInterval(interval);
  };
}
