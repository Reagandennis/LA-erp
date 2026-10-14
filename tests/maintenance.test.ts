import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  sessionDeleteMany: vi.fn(),
  bucketDeleteMany: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    session: { deleteMany: mocks.sessionDeleteMany },
    rateLimitBucket: { deleteMany: mocks.bucketDeleteMany },
  },
}));

import {
  RATE_LIMIT_RETENTION_DAYS,
  SESSION_RETENTION_DAYS,
  pruneExpiredSessions,
  pruneRateLimitBuckets,
  runMaintenance,
  scheduleMaintenance,
} from '../lib/maintenance';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('maintenance', () => {
  beforeEach(() => {
    mocks.sessionDeleteMany.mockReset().mockResolvedValue({ count: 0 });
    mocks.bucketDeleteMany.mockReset().mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('deletes sessions that expired or were revoked before the retention cutoff', async () => {
    mocks.sessionDeleteMany.mockResolvedValue({ count: 4 });
    const now = new Date('2026-10-14T12:00:00Z');

    const count = await pruneExpiredSessions(now);

    const cutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * DAY_MS);
    expect(count).toBe(4);
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
  });

  it('deletes rate-limit buckets whose window closed before the cutoff', async () => {
    mocks.bucketDeleteMany.mockResolvedValue({ count: 9 });
    const now = new Date('2026-10-14T12:00:00Z');

    const count = await pruneRateLimitBuckets(now);

    const cutoff = new Date(now.getTime() - RATE_LIMIT_RETENTION_DAYS * DAY_MS);
    expect(count).toBe(9);
    expect(mocks.bucketDeleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: cutoff } },
    });
  });

  it('runs both pruners and reports the totals', async () => {
    mocks.sessionDeleteMany.mockResolvedValue({ count: 2 });
    mocks.bucketDeleteMany.mockResolvedValue({ count: 3 });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runMaintenance()).resolves.toEqual({ sessions: 2, rateLimitBuckets: 3 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when there is nothing to prune', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runMaintenance();
    expect(log).not.toHaveBeenCalled();
  });

  it('schedules a first run after the initial delay and then on the interval', async () => {
    vi.useFakeTimers();
    const stop = scheduleMaintenance({ initialDelayMs: 1000, intervalMs: 5000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.sessionDeleteMany).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.sessionDeleteMany).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sessionDeleteMany).toHaveBeenCalledTimes(3);

    stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.sessionDeleteMany).toHaveBeenCalledTimes(3);
  });

  it('logs and keeps going when a run fails', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sessionDeleteMany.mockRejectedValue(new Error('db down'));
    const stop = scheduleMaintenance({ initialDelayMs: 10, intervalMs: 10 });

    await vi.advanceTimersByTimeAsync(25);
    expect(error).toHaveBeenCalledTimes(2);

    stop();
  });
});
