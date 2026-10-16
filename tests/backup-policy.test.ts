import { describe, expect, it } from 'vitest';

import {
  applyRetention,
  isDue,
  isFirstOfMonth,
  lastScheduledAt,
  nextScheduledAt,
  snapshotName,
  type Snapshot,
} from '../lib/backup/policy';

const TZ = 'Africa/Nairobi'; // UTC+3, no DST

describe('backup schedule', () => {
  it('finds the latest run time in the configured zone', () => {
    // 01:30 in Nairobi is before today's 02:00 → yesterday's slot.
    expect(lastScheduledAt(new Date('2026-10-15T22:30:00Z'), '02:00', TZ).toISOString()).toBe('2026-10-14T23:00:00.000Z');
    // 02:30 in Nairobi → today's slot.
    expect(lastScheduledAt(new Date('2026-10-15T23:30:00Z'), '02:00', TZ).toISOString()).toBe('2026-10-15T23:00:00.000Z');
    expect(nextScheduledAt(new Date('2026-10-15T23:30:00Z'), '02:00', TZ).toISOString()).toBe('2026-10-16T23:00:00.000Z');
  });

  it('follows daylight saving where a zone has it', () => {
    // London: 02:00 is 01:00Z in summer and 02:00Z in winter.
    expect(lastScheduledAt(new Date('2026-07-01T12:00:00Z'), '02:00', 'Europe/London').toISOString()).toBe('2026-07-01T01:00:00.000Z');
    expect(lastScheduledAt(new Date('2026-12-01T12:00:00Z'), '02:00', 'Europe/London').toISOString()).toBe('2026-12-01T02:00:00.000Z');
  });

  it('is due once per slot, and catches up a slot missed while the server was down', () => {
    const now = new Date('2026-10-16T08:00:00Z');
    const slot = lastScheduledAt(now, '02:00', TZ);
    expect(isDue(now, '02:00', TZ, null)).toBe(true);
    expect(isDue(now, '02:00', TZ, new Date(slot.getTime() + 60_000))).toBe(false);
    // Last run was the day before: the server was down at 02:00 today.
    expect(isDue(now, '02:00', TZ, new Date(slot.getTime() - 24 * 3600_000))).toBe(true);
  });

  it('names snapshot folders so they sort by time', () => {
    expect(snapshotName(new Date('2026-10-15T23:00:00Z'), TZ, 'schedule')).toBe('2026-10-16 02.00 (scheduled)');
    expect(snapshotName(new Date('2026-10-16T06:05:00Z'), TZ, 'manual')).toBe('2026-10-16 09.05 (manual)');
  });
});

describe('backup retention', () => {
  /** One snapshot per day at 02:00 Nairobi, for `days` days ending 2026-10-16. */
  function daily(days: number, extra: Partial<Snapshot>[] = []): Snapshot[] {
    const end = Date.parse('2026-10-15T23:00:00Z');
    const list = Array.from({ length: days }, (_, i) => ({ id: days - i, startedAt: new Date(end - i * 86400_000), pinned: false }));
    return [...list, ...extra.map((e, i) => ({ id: 1000 + i, startedAt: new Date(end), pinned: false, ...e }))];
  }
  const rule = { keepDaily: 7, keepWeekly: 4, keepMonthly: 3, timeZone: TZ };

  it('keeps the last N days, the first of each recent week and month, and prunes the rest', () => {
    const snapshots = daily(120);
    const { keep, prune } = applyRetention(snapshots, rule);

    const daysKept = [...keep].filter(([, why]) => why.includes('daily')).length;
    const weeksKept = [...keep].filter(([, why]) => why.includes('weekly')).length;
    const monthsKept = [...keep].filter(([, why]) => why.includes('monthly')).length;
    expect([daysKept, weeksKept, monthsKept]).toEqual([7, 4, 3]);
    expect(keep.size + prune.length).toBe(120);
    expect(keep.size).toBeLessThanOrEqual(7 + 4 + 3);

    // Monthly keepers are each month's first snapshot: Oct 1, Sep 1, Aug 1 (local).
    const monthly = snapshots.filter((s) => keep.get(s.id)?.includes('monthly')).map((s) => snapshotName(s.startedAt, TZ, 'schedule').slice(0, 10));
    expect(monthly.sort()).toEqual(['2026-08-01', '2026-09-01', '2026-10-01']);
  });

  it('keeps only the newest of several snapshots on the same day', () => {
    const snapshots = [
      { id: 1, startedAt: new Date('2026-10-16T05:00:00Z'), pinned: false },
      { id: 2, startedAt: new Date('2026-10-16T09:00:00Z'), pinned: false },
    ];
    const { keep } = applyRetention(snapshots, { keepDaily: 1, keepWeekly: 0, keepMonthly: 0, timeZone: TZ });
    expect(keep.get(2)).toContain('daily');
    expect(keep.get(1)).toBeUndefined();
  });

  it('never prunes a pinned snapshot, or the newest one whatever the settings', () => {
    const snapshots = daily(30).map((s) => (s.id === 3 ? { ...s, pinned: true } : s));
    const { keep, prune } = applyRetention(snapshots, { keepDaily: 0, keepWeekly: 0, keepMonthly: 0, timeZone: TZ });
    expect(keep.get(3)).toEqual(['pinned']);
    expect(keep.get(30)).toEqual(['latest']);
    expect(prune).not.toContain(3);
    expect(prune).not.toContain(30);
    expect(prune).toHaveLength(28);
  });

  it('knows a month’s first snapshot the moment it is taken, so it can be locked', () => {
    const oct1 = { id: 10, startedAt: new Date('2026-09-30T23:00:00Z'), pinned: false }; // 02:00 Oct 1 local
    const sep30 = { id: 9, startedAt: new Date('2026-09-29T23:00:00Z'), pinned: false };
    const oct2 = { id: 11, startedAt: new Date('2026-10-01T23:00:00Z'), pinned: false };
    expect(isFirstOfMonth(oct1, [sep30], TZ)).toBe(true);
    expect(isFirstOfMonth(oct2, [sep30, oct1], TZ)).toBe(false);
  });
});
