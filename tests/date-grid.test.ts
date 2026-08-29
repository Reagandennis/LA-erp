import { describe, expect, it } from 'vitest';

import {
  addDays,
  clampRange,
  dateKey,
  dateKeyFromIso,
  dayDiff,
  dayFromIso,
  isoFromDateKey,
  parseDateKey,
} from '../lib/date-grid';

/** Local midday, so these assertions don't move with the runner's timezone. */
function at(y: number, m: number, d: number, h = 12): Date {
  return new Date(y, m - 1, d, h, 0, 0, 0);
}

describe('parseDateKey', () => {
  it('reads a bare key as a local day, not UTC midnight', () => {
    const parsed = parseDateKey('2026-08-28');
    expect(parsed).not.toBeNull();
    expect(parsed!.getFullYear()).toBe(2026);
    expect(parsed!.getMonth()).toBe(7);
    expect(parsed!.getDate()).toBe(28);
  });

  it('accepts the date half of a full ISO string', () => {
    expect(dateKey(parseDateKey('2026-08-28T00:00:00.000Z')!)).toBe('2026-08-28');
  });

  it('rejects impossible and malformed dates rather than rolling them over', () => {
    expect(parseDateKey('2026-02-31')).toBeNull();
    expect(parseDateKey('2026-8-1')).toBeNull();
    expect(parseDateKey('28/08/2026')).toBeNull();
    expect(parseDateKey('')).toBeNull();
    expect(parseDateKey(null)).toBeNull();
  });
});

describe('stored-instant round trip', () => {
  // The regression that put bars a column off: a date written with
  // `new Date("2026-08-28").toISOString()` is UTC midnight, so reading the
  // first ten characters back gives a different day in most of the world.
  it('returns the same key it was given, in any timezone', () => {
    for (const key of ['2026-01-01', '2026-06-15', '2026-08-28', '2026-12-31']) {
      expect(dateKeyFromIso(isoFromDateKey(key))).toBe(key);
    }
  });

  it('reads the local day out of a timestamp that carries a time', () => {
    const evening = at(2026, 8, 28, 23).toISOString();
    expect(dateKeyFromIso(evening)).toBe('2026-08-28');
  });

  it('treats a bare key and a full timestamp for the same local day alike', () => {
    const iso = isoFromDateKey('2026-08-28')!;
    expect(dateKey(dayFromIso(iso)!)).toBe(dateKey(dayFromIso('2026-08-28')!));
  });

  it('is null-safe at every entry point', () => {
    expect(dayFromIso(null)).toBeNull();
    expect(dateKeyFromIso(undefined)).toBeNull();
    expect(isoFromDateKey('nonsense')).toBeNull();
  });
});

describe('dayDiff', () => {
  it('counts whole days across a spring-forward boundary', () => {
    // US DST begins 2026-03-08; that day is only 23 hours long.
    expect(dayDiff(at(2026, 3, 7), at(2026, 3, 9))).toBe(2);
  });

  it('counts whole days across a fall-back boundary', () => {
    // US DST ends 2026-11-01; that day is 25 hours long.
    expect(dayDiff(at(2026, 10, 31), at(2026, 11, 2))).toBe(2);
  });

  it('is signed and zero for the same day', () => {
    expect(dayDiff(at(2026, 8, 28), at(2026, 8, 28))).toBe(0);
    expect(dayDiff(at(2026, 8, 28), at(2026, 8, 20))).toBe(-8);
  });

  it('ignores the time of day on either side', () => {
    const early = new Date(2026, 7, 28, 0, 5);
    const late = new Date(2026, 7, 29, 23, 55);
    expect(dayDiff(early, late)).toBe(1);
  });
});

describe('addDays', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(dateKey(addDays(at(2026, 2, 28), 1))).toBe('2026-03-01'); // 2026 is not a leap year
    expect(dateKey(addDays(at(2028, 2, 28), 1))).toBe('2028-02-29'); // 2028 is
    expect(dateKey(addDays(at(2026, 12, 31), 1))).toBe('2027-01-01');
    expect(dateKey(addDays(at(2026, 1, 1), -1))).toBe('2025-12-31');
  });
});

describe('date keys sort lexicographically', () => {
  // The Gantt and the overdue check both lean on this.
  it('orders as dates do', () => {
    expect('2026-09-01' > '2026-08-31').toBe(true);
    expect('2026-01-02' > '2026-01-10').toBe(false);
  });
});

describe('clampRange', () => {
  it('leaves a window that already fits alone', () => {
    const range = clampRange(at(2026, 8, 1), at(2026, 8, 10), 90);
    expect(range.days).toBe(10);
    expect(range.overflowDays).toBe(0);
    expect(dateKey(range.end)).toBe('2026-08-10');
  });

  it('caps a decades-long span and reports the overflow exactly', () => {
    const range = clampRange(at(2026, 1, 1), at(2066, 1, 1), 90);
    expect(range.days).toBe(90);
    expect(dateKey(range.end)).toBe('2026-03-31');
    expect(range.overflowDays).toBe(dayDiff(at(2026, 1, 1), at(2066, 1, 1)) + 1 - 90);
  });

  it('never returns fewer than one column, even for an inverted range', () => {
    // This is what stands between the bar maths and a division by zero.
    const range = clampRange(at(2026, 8, 10), at(2026, 8, 1), 90);
    expect(range.days).toBeGreaterThanOrEqual(1);
  });
});
