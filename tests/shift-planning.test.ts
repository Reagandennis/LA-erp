import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: {} }));

import { isColour, isDateKey, isLeaveType, isTimeOfDay, spanHoursBetween } from '../lib/shift-planning';

describe('spanHoursBetween', () => {
  it('measures an ordinary daytime shift', () => {
    expect(spanHoursBetween('09:00', '17:00')).toBe(8);
    expect(spanHoursBetween('08:30', '12:00')).toBe(3.5);
  });

  it('handles a shift that crosses midnight', () => {
    // A night shift legitimately ends before it starts; treating that as a
    // negative span would show "-16 hr" on the board.
    expect(spanHoursBetween('22:00', '06:00')).toBe(8);
    expect(spanHoursBetween('19:00', '01:00')).toBe(6);
  });

  it('treats an identical start and end as a full day, not zero', () => {
    expect(spanHoursBetween('09:00', '09:00')).toBe(24);
  });
});

describe('validators', () => {
  it('accepts only YYYY-MM-DD date keys', () => {
    expect(isDateKey('2026-08-26')).toBe(true);
    expect(isDateKey('2026-8-26')).toBe(false);
    expect(isDateKey('26/08/2026')).toBe(false);
    expect(isDateKey(20260826)).toBe(false);
  });

  it('accepts only 24-hour HH:MM times', () => {
    expect(isTimeOfDay('00:00')).toBe(true);
    expect(isTimeOfDay('23:59')).toBe(true);
    expect(isTimeOfDay('24:00')).toBe(false);
    expect(isTimeOfDay('9:00')).toBe(false);
    expect(isTimeOfDay('09:60')).toBe(false);
  });

  it('accepts only known leave types and palette keys', () => {
    expect(isLeaveType('annual')).toBe(true);
    expect(isLeaveType('sabbatical')).toBe(false);
    expect(isColour('emerald')).toBe(true);
    expect(isColour('#ff0000')).toBe(false);
  });
});
