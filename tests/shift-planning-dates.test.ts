import { describe, expect, it } from 'vitest';

import {
  addDays,
  dateKey,
  isoWeekday,
  leaveCoversDate,
  monthGrid,
  startOfWeek,
  hoursBetween,
  type Leave,
} from '../app/modules/shift-planning/planning-shared';

/** Local midday, so these assertions don't move with the runner's timezone. */
function at(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

describe('week and month geometry', () => {
  it('anchors the week to Monday, including from a Sunday', () => {
    // Sunday 2026-08-30 belongs to the week starting Monday 2026-08-24.
    expect(dateKey(startOfWeek(at(2026, 8, 30)))).toBe('2026-08-24');
    expect(dateKey(startOfWeek(at(2026, 8, 24)))).toBe('2026-08-24');
    expect(dateKey(startOfWeek(at(2026, 8, 26)))).toBe('2026-08-24');
  });

  it('reports ISO weekdays with Sunday as 7', () => {
    expect(isoWeekday(at(2026, 8, 24))).toBe(1); // Monday
    expect(isoWeekday(at(2026, 8, 30))).toBe(7); // Sunday
  });

  it('builds a 42-cell month grid padded from the preceding Monday', () => {
    const grid = monthGrid(at(2026, 8, 15));
    expect(grid).toHaveLength(42);
    expect(dateKey(grid[0]!)).toBe('2026-07-27'); // Monday before 1 Aug
    expect(isoWeekday(grid[0]!)).toBe(1);
    expect(isoWeekday(grid[41]!)).toBe(7);
  });

  it('adds days without drifting across a DST change', () => {
    // Dates are normalised to midday precisely so a 1-hour shift can't roll
    // the calendar over a day boundary.
    const start = at(2026, 3, 28);
    expect(dateKey(addDays(start, 1))).toBe('2026-03-29');
    expect(dateKey(addDays(start, 2))).toBe('2026-03-30');
  });
});

describe('month grid drives the month view', () => {
  it('always covers the whole month plus its padding weeks', () => {
    // Every month must render as 6 full weeks so the grid never reflows.
    for (const [y, m] of [
      [2026, 2],
      [2026, 8],
      [2027, 1],
    ] as const) {
      const grid = monthGrid(at(y, m, 15));
      expect(grid).toHaveLength(42);
      const keys = grid.map(dateKey);
      expect(keys).toContain(`${y}-${String(m).padStart(2, '0')}-01`);
    }
  });

  it('treats Saturday and Sunday as ordinary working days', async () => {
    // This operation runs seven days. The week is a plain Mon–Sun run with no
    // weekend carve-out, and the shared helpers deliberately no longer expose an
    // isWeekend predicate for a view to grey days out with.
    const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(at(2026, 8, 26)), i));
    expect(week.map(isoWeekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(dateKey(week[5]!)).toBe('2026-08-29'); // Saturday
    expect(dateKey(week[6]!)).toBe('2026-08-30'); // Sunday

    const shared = await import('../app/modules/shift-planning/planning-shared');
    expect('isWeekend' in shared).toBe(false);
  });
});

describe('leaveCoversDate', () => {
  const leave = {
    id: 'l1',
    userId: 1,
    userName: 'Ada',
    type: 'annual',
    startDate: '2026-08-10',
    endDate: '2026-08-14',
    status: 'approved',
    note: null,
    decidedByName: null,
  } as Leave;

  it('covers both endpoints inclusively', () => {
    expect(leaveCoversDate(leave, '2026-08-10')).toBe(true);
    expect(leaveCoversDate(leave, '2026-08-14')).toBe(true);
    expect(leaveCoversDate(leave, '2026-08-12')).toBe(true);
  });

  it('excludes the days either side', () => {
    expect(leaveCoversDate(leave, '2026-08-09')).toBe(false);
    expect(leaveCoversDate(leave, '2026-08-15')).toBe(false);
  });
});

describe('hoursBetween', () => {
  it('matches the server calculation, including overnight', () => {
    expect(hoursBetween('09:00', '17:00')).toBe(8);
    expect(hoursBetween('22:00', '06:00')).toBe(8);
  });

  it('returns null when a time is missing or malformed', () => {
    expect(hoursBetween(null, '17:00')).toBeNull();
    expect(hoursBetween('09:00', undefined)).toBeNull();
    expect(hoursBetween('nonsense', '17:00')).toBeNull();
  });
});
