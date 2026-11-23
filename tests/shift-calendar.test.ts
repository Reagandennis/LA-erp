import { describe, expect, it } from 'vitest';

import { type CalendarShift, type SentMap, buildShiftCalendar, diffShifts, isEmptyDiff, zonedToUtc } from '@/lib/shift-calendar';

const day = (date: string, code = 'D', start: string | null = '07:00', end: string | null = '15:00', name = 'Day'): CalendarShift => ({ date, code, name, start, end });
const all = () => true;

describe('zonedToUtc', () => {
  it('converts Nairobi wall-clock time to UTC', () => {
    expect(zonedToUtc('2026-12-01', '07:00', 'Africa/Nairobi').toISOString()).toBe('2026-12-01T04:00:00.000Z');
  });
  it('handles a zone with daylight saving', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToUtc('2026-12-01', '09:00', 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
  });
});

describe('diffShifts', () => {
  it('treats a first month as published', () => {
    const { diff, next } = diffShifts({}, [day('2026-12-01'), day('2026-12-02')], all, '2026-11-12');
    expect(diff.published.map((s) => s.date)).toEqual(['2026-12-01', '2026-12-02']);
    expect(diff.added).toHaveLength(0);
    expect(next['2026-12-01']?.seq).toBe(0);
  });

  it('reports a changed shift and bumps its sequence', () => {
    const sent: SentMap = { '2026-12-01': { ...day('2026-12-01'), seq: 0 } };
    const { diff, next } = diffShifts(sent, [day('2026-12-01', 'N', '19:00', '07:00', 'Night')], all, '2026-11-12');
    expect(diff.changed).toHaveLength(1);
    expect(next['2026-12-01']).toMatchObject({ code: 'N', seq: 1 });
  });

  it('cancels a removed shift, and brings it back with a higher sequence', () => {
    const sent: SentMap = { '2026-12-01': { ...day('2026-12-01'), seq: 0 }, '2026-12-02': { ...day('2026-12-02'), seq: 0 } };
    const first = diffShifts(sent, [day('2026-12-01')], all, '2026-11-12');
    expect(first.diff.removed.map((s) => s.date)).toEqual(['2026-12-02']);
    expect(first.next['2026-12-02']).toMatchObject({ cancelled: true, seq: 1 });

    const again = diffShifts(first.next, [day('2026-12-01'), day('2026-12-02')], all, '2026-11-12');
    expect(again.diff.added.map((s) => s.date)).toEqual(['2026-12-02']);
    expect(again.next['2026-12-02']).toMatchObject({ seq: 2 });
    expect(again.next['2026-12-02']?.cancelled).toBeUndefined();
  });

  it('a new day in a month already sent is an addition, not a publish', () => {
    const sent: SentMap = { '2026-12-01': { ...day('2026-12-01'), seq: 0 } };
    const { diff } = diffShifts(sent, [day('2026-12-01'), day('2026-12-05')], all, '2026-11-12');
    expect(diff.added.map((s) => s.date)).toEqual(['2026-12-05']);
    expect(diff.published).toHaveLength(0);
  });

  it('leaves days of an unpublished month alone', () => {
    const sent: SentMap = { '2027-01-03': { ...day('2027-01-03'), seq: 0 } };
    const { diff, next } = diffShifts(sent, [], (date) => date.startsWith('2026-12'), '2026-11-12');
    expect(isEmptyDiff(diff)).toBe(true);
    expect(next['2027-01-03']).toBeDefined();
  });

  it('drops past days and sends nothing when unchanged', () => {
    const sent: SentMap = { '2026-11-01': { ...day('2026-11-01'), seq: 0 }, '2026-12-01': { ...day('2026-12-01'), seq: 0 } };
    const { diff, next } = diffShifts(sent, [day('2026-12-01')], all, '2026-11-12');
    expect(isEmptyDiff(diff)).toBe(true);
    expect(Object.keys(next)).toEqual(['2026-12-01']);
  });
});

describe('buildShiftCalendar', () => {
  const options = { uidPrefix: '7', uidDomain: 'test', timeZone: 'Africa/Nairobi', calendarName: 'Shifts', personLabel: 'Mary (TRC-2)', now: new Date('2026-11-12T00:00:00Z') };

  it('writes timed, overnight, all-day and cancelled events with stable ids', () => {
    const ics = buildShiftCalendar(
      [
        { ...day('2026-12-01'), seq: 0 },
        { ...day('2026-12-02', 'N', '19:00', '07:00', 'Night'), seq: 1 },
        { ...day('2026-12-03', 'OC', null, null, 'On call'), seq: 0 },
        { ...day('2026-12-04'), seq: 2, cancelled: true },
      ],
      options,
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('METHOD:PUBLISH');
    expect(ics).toContain('UID:shift-7-2026-12-01@test');
    expect(ics).toContain('DTSTART:20261201T040000Z');
    expect(ics).toContain('DTEND:20261201T120000Z');
    // The night ends the next morning.
    expect(ics).toContain('DTSTART:20261202T160000Z');
    expect(ics).toContain('DTEND:20261203T040000Z');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261203');
    expect(ics).toContain('DTEND;VALUE=DATE:20261204');
    expect(ics).toMatch(/SEQUENCE:2\r\nDTSTART:20261204T040000Z[\s\S]*STATUS:CANCELLED/);
    expect(ics.split('\r\n').every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
  });
});
