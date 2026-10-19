import { describe, expect, it } from 'vitest';

import { isValidTimeZone, offsetLabel, utcToZoned, weekdayOf, zonedToUtcIso } from '../lib/zoned-time';

describe('zonedToUtcIso', () => {
  it('reads the time in the given zone, not the machine running it', () => {
    expect(zonedToUtcIso('2026-10-20', '14:30', 'Africa/Nairobi')).toBe('2026-10-20T11:30:00.000Z');
    expect(zonedToUtcIso('2026-10-20', '14:30', 'UTC')).toBe('2026-10-20T14:30:00.000Z');
  });

  it('uses the offset in force on that date across DST', () => {
    expect(zonedToUtcIso('2026-07-01', '09:00', 'Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtcIso('2026-12-01', '09:00', 'Europe/London')).toBe('2026-12-01T09:00:00.000Z');
    expect(zonedToUtcIso('2026-07-01', '09:00', 'America/New_York')).toBe('2026-07-01T13:00:00.000Z');
  });

  it('handles half-hour zones', () => {
    expect(zonedToUtcIso('2026-10-20', '10:00', 'Asia/Kolkata')).toBe('2026-10-20T04:30:00.000Z');
  });

  it('refuses malformed input rather than guessing', () => {
    expect(zonedToUtcIso('20/10/2026', '10:00', 'UTC')).toBeNull();
    expect(zonedToUtcIso('2026-10-20', '10am', 'UTC')).toBeNull();
    expect(zonedToUtcIso('2026-10-20', '10:00', 'Mars/Olympus')).toBeNull();
  });
});

describe('utcToZoned', () => {
  it('round-trips with zonedToUtcIso', () => {
    const iso = zonedToUtcIso('2026-03-29', '23:45', 'Europe/London')!;
    expect(utcToZoned(iso, 'Europe/London')).toEqual({ date: '2026-03-29', time: '23:45' });
  });

  it('crosses midnight into the zone’s own date', () => {
    expect(utcToZoned('2026-10-20T22:30:00.000Z', 'Africa/Nairobi')).toEqual({ date: '2026-10-21', time: '01:30' });
  });

  it('is empty for nothing to show', () => {
    expect(utcToZoned(null, 'UTC')).toEqual({ date: '', time: '' });
    expect(utcToZoned('2026-10-20T10:00:00Z', 'Nowhere/Land')).toEqual({ date: '', time: '' });
  });
});

describe('offsetLabel / weekdayOf / isValidTimeZone', () => {
  it('labels offsets the way a person reads them', () => {
    const october = Date.UTC(2026, 9, 20);
    expect(offsetLabel('Africa/Nairobi', october)).toBe('GMT+3');
    expect(offsetLabel('Asia/Kolkata', october)).toBe('GMT+5:30');
    expect(offsetLabel('UTC', october)).toBe('GMT');
    expect(offsetLabel('America/New_York', october)).toBe('GMT-4');
  });

  it('names the weekday of a calendar date', () => {
    expect(weekdayOf('2026-10-19', 'en-US')).toBe('Monday');
    expect(weekdayOf('', 'en-US')).toBe('');
  });

  it('knows a real zone from a typo', () => {
    expect(isValidTimeZone('Africa/Nairobi')).toBe(true);
    expect(isValidTimeZone('Africa/Nairob')).toBe(false);
  });
});
