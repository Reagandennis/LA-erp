import { describe, expect, it } from 'vitest';

import { checkImport, planRosterImport, readBilletPositions, readPosition, readRosterSheet } from '../lib/shift-import';
import {
  DEFAULT_RULES,
  type CellLookup,
  type RosterCell,
  type RosterLine,
  awayCodeOf,
  cellOfWritten,
  ctoBalance,
  driverCode,
  dutyOf,
  generatedWritten,
  lastFullWorkWeek,
  leaveTypeOf,
  lineTotals,
  monthDates,
  payrollTotals,
  sanitizeRules,
  tagOf,
  validateRoster,
} from '../lib/shift-rules';

/**
 * The platform template v0.3 (December 2026): three positions on one grid.
 * The grid below is the template's own "Dec 2026" tab, so these tests hold the
 * rules to the roster they were written from.
 */

const rules = DEFAULT_RULES;
const DEC = '2026-12';
const HOLIDAYS = new Set(['2026-12-12', '2026-12-25', '2026-12-26', '2027-01-01']);

const GRID: Record<string, string> = {
  'TRC-1': 'X S OC X D D S S N N X D S X D D S S N N X OC OC X D D S S N N X',
  'TRC-2': 'D D S S N N LV LV LV LV LV LV LV LV LV LV LV LV LV LV D D S S N N X OC OC X D',
  'TRC-3': 'OC X D D S S N N X OC OC X D D S S N N X OC OC X D D S S N N X OC OC',
  'TRC-4': 'LV LV LV LV LV LV OC X D D S S N N X N OC X D D S S N N X OC OC X D D S',
  'TRC-5': 'N N X N OC X D D S S N N X S OC X D D S S N N X OC OC X D D S S N',
  'TRC-6': 'ETH ETH ETH ETH ETH ETH ETH ETH ETH ETH ETH ETH ETH LV LV LV LV LV LV LV D D D D X X X D D D D',
  'TRC-7': 'S PC N X X X PC PC PC PC D X X PC N X PC PC X X PC PC PC LV LV LV LV LV LV LV LV',
  'DRV-1': 'SD-D SD-D SD-D SD-D3 X X SD-D SD-D SD-D SD-D SD-D3 X X SD-N SD-N2 SD-N SD-N SD-N X X SD-N2 SD-N2 SD-N2 SD-N X X X SD-D SD-D SD-D SD-D',
  'DRV-2': 'SD-N2 SD-N SD-N SD-N X X SD-N SD-N2 SD-N SD-N SD-N X X SD-D SD-D SD-D SD-D SD-D3 X X SD-D SD-D SD-D SD-D X X X SD-N SD-N2 SD-N SD-N',
};

/** The people as the template's Read me sets them up. */
const LINES: RosterLine[] = [
  { id: 1, code: 'TRC-1', position: 'trc', cycleOffset: 6, startDate: null, endDate: null, active: true },
  { id: 2, code: 'TRC-2', position: 'trc', cycleOffset: 0, startDate: null, endDate: null, active: true },
  { id: 3, code: 'TRC-3', position: 'trc', cycleOffset: 8, startDate: null, endDate: null, active: true },
  { id: 4, code: 'TRC-4', position: 'trc', cycleOffset: 2, startDate: null, endDate: null, active: true },
  { id: 5, code: 'TRC-5', position: 'trc', cycleOffset: 4, startDate: null, endDate: null, active: true },
  { id: 6, code: 'TRC-6', position: 'pc', cycleOffset: null, startDate: null, endDate: null, active: true },
  { id: 7, code: 'TRC-7', position: 'pc', cycleOffset: null, startDate: null, endDate: null, active: true },
  { id: 8, code: 'DRV-1', position: 'driver', cycleOffset: 0, startDate: null, endDate: null, active: true },
  { id: 9, code: 'DRV-2', position: 'driver', cycleOffset: 1, startDate: null, endDate: null, active: true },
];

const dates = monthDates(DEC);
const line = (code: string) => LINES.find((l) => l.code === code) as RosterLine;

/** The template grid as saved records, with some cells replaced by written codes. */
function grid(overrides: Record<string, string> = {}): CellLookup {
  return (lineId, date) => {
    const who = LINES.find((l) => l.id === lineId);
    const index = dates.indexOf(date);
    if (!who || index < 0) return null;
    const written = overrides[`${who.code}|${date}`] ?? (GRID[who.code] as string).split(' ')[index];
    if (!written) return null;
    const cell = cellOfWritten(rules, written);
    const generated = generatedWritten(rules, who, date, HOLIDAYS);
    return { ...cell, generated: generated ? cellOfWritten(rules, generated).planned : cell.planned };
  };
}

const inDecember = (date: string) => date.startsWith(DEC);
const check = (overrides: Record<string, string> = {}, lines = LINES) => validateRoster(rules, lines, grid(overrides), '2026-12-01', '2026-12-31', inDecember, HOLIDAYS);
const fresh = (overrides: Record<string, string>) => {
  const before = new Set(check().map((v) => v.key));
  return check(overrides).filter((v) => !before.has(v.key));
};

describe('the standard codes', () => {
  it('are on every roster, with the template hours', () => {
    const hours = (code: string) => dutyOf(rules, cellOfWritten(rules, code), '2026-12-01')?.hours ?? 0;
    expect(['PC', 'SD-D', 'SD-D3', 'SD-N', 'SD-N2'].map(hours)).toEqual([8, 10, 10, 9, 10.5]);
    expect(['LV', 'SL', 'CTO', 'UL', 'ETH', 'OC', 'X'].map(hours)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(tagOf(rules, 'PC')).toBe('pc');
    expect(tagOf(rules, 'SD-N2')).toBe('driver_night');
    expect(tagOf(rules, 'D')).toBeNull();
  });

  it('cannot be redefined or removed by saved settings, only renamed and retimed', () => {
    const saved = sanitizeRules({ ...rules, extra: [{ code: 'ETH', name: 'ETH', as: 'W' }, { code: 'PC', name: 'Desk', as: 'W', start: '09:00', end: '18:00', hours: 8 }] });
    const eth = saved.extra.find((e) => e.code === 'ETH');
    expect(eth).toMatchObject({ as: 'LV', tag: 'deployed', name: 'Ethiopia relief' });
    expect(saved.extra.find((e) => e.code === 'PC')).toMatchObject({ as: 'W', tag: 'pc', name: 'Desk', start: '09:00', end: '18:00' });
    expect(saved.extra.some((e) => e.code === 'SD-D3')).toBe(true);
  });

  it('take a driver’s unpaid break off recorded times', () => {
    const cell: RosterCell = { ...cellOfWritten(rules, 'SD-D'), status: 'worked', start: '08:00', end: '20:00' };
    expect(dutyOf(rules, cell, '2026-12-01')?.hours).toBe(11);
  });

  it('count days away by the code HR uses', () => {
    const away = (code: string) => awayCodeOf(rules, cellOfWritten(rules, code).planned, cellOfWritten(rules, code).label);
    expect(['LV', 'SL', 'CTO', 'UL', 'ETH', 'X', 'D'].map(away)).toEqual(['LV', 'SL', 'CTO', 'UL', null, null, null]);
    expect(leaveTypeOf('other')).toBe('unpaid');
  });
});

describe('generation by position', () => {
  it('gives the TRCs the rotation at the template offsets', () => {
    // TRC-3 has no overrides in December: its row is the pattern.
    expect(dates.map((date) => generatedWritten(rules, line('TRC-3'), date, HOLIDAYS)).join(' ')).toBe(GRID['TRC-3']);
  });

  it('puts a Project Coordinator at their desk on working days only', () => {
    const row = dates.map((date) => generatedWritten(rules, line('TRC-7'), date, HOLIDAYS));
    expect(row[1]).toBe('PC'); // Wed 2 Dec
    expect(row[4]).toBe('X'); // Sat 5 Dec
    expect(row[24]).toBe('X'); // Christmas Day, a Friday
    expect(row.filter((code) => code === 'PC')).toHaveLength(22);
  });

  it('reproduces both drivers’ December exactly', () => {
    for (const code of ['DRV-1', 'DRV-2']) {
      expect(dates.map((date) => generatedWritten(rules, line(code), date, HOLIDAYS)).join(' ')).toBe(GRID[code]);
    }
  });

  it('finds the last full working week, and runs the driver blocks across months', () => {
    expect(lastFullWorkWeek('2026-12')).toEqual({ from: '2026-12-21', to: '2026-12-25' });
    expect(lastFullWorkWeek('2027-01')).toEqual({ from: '2027-01-25', to: '2027-01-29' });
    // 11 January 2027 starts the fourth block from 30 November: nights for the driver who started on days.
    expect(driverCode(rules, 0, '2027-01-11', HOLIDAYS)).toBe('SD-N');
    expect(driverCode(rules, 0, '2027-01-12', HOLIDAYS)).toBe('SD-N2');
    expect(driverCode(rules, 1, '2027-01-15', HOLIDAYS)).toBe('SD-D3');
    expect(driverCode(rules, 0, '2027-01-01', HOLIDAYS)).toBe('X');
  });
});

describe('validation of the template roster', () => {
  it('passes with nothing blocking', () => {
    const result = check();
    expect(result.filter((v) => v.severity === 'block')).toEqual([]);
    const count = (rule: string) => result.filter((v) => v.rule === rule).length;
    // Doubles are allowed and shown; days with no TRC on call name the fallback or its absence.
    expect({ doubles: count('coverage_double'), fallback: count('no_on_call'), none: count('no_fallback') }).toEqual({ doubles: 8, fallback: 5, none: 6 });
  });

  it('lets a desk day start late after a Swing cover, but not after a Night', () => {
    // TRC-7 covers Swing on 1 December and is at their desk on the 2nd: allowed, from 10:00.
    expect(check().filter((v) => v.rule === 'rest' && v.lineCode === 'TRC-7')).toEqual([]);
    // After a Night on the 3rd the template rosters X on the 4th; a desk day there breaks the rest rule.
    expect(fresh({ 'TRC-7|2026-12-04': 'PC' }).map((v) => v.rule)).toContain('rest');
  });

  it('blocks a console shift nobody is on, counting a Project Coordinator’s cover', () => {
    // TRC-7 covers the Swing on 1 December; without them it is a gap.
    expect(fresh({ 'TRC-7|2026-12-01': 'PC' }).map((v) => [v.rule, v.severity])).toContainEqual(['coverage_gap', 'block']);
  });

  it('needs one day and one night driver each working day', () => {
    const both = fresh({ 'DRV-2|2026-12-01': 'SD-D' });
    expect(both.map((v) => [v.rule, v.severity])).toContainEqual(['driver_coverage', 'block']);
    expect(both.find((v) => v.rule === 'driver_coverage')!.message).toMatch(/2 day drivers and no night driver/);
    // Coming off a night that ended at 06:00, a day shift at 08:00 also breaks the rest rule.
    expect(both.map((v) => v.rule)).toContain('rest');
    expect(fresh({ 'DRV-1|2026-12-01': 'LV' }).map((v) => v.rule)).toEqual(['driver_coverage']);
    // Weekends and public holidays need nobody.
    expect(check().filter((v) => v.rule === 'driver_coverage')).toEqual([]);
  });

  it('keeps desk and driver codes off weekends and public holidays', () => {
    expect(fresh({ 'TRC-7|2026-12-05': 'PC' }).map((v) => [v.rule, v.severity])).toContainEqual(['off_day_code', 'block']);
    const christmas = fresh({ 'DRV-1|2026-12-25': 'SD-N' });
    expect(christmas.map((v) => v.rule)).toContain('off_day_code');
    expect(christmas.find((v) => v.rule === 'off_day_code')!.message).toMatch(/a public holiday/);
  });

  it('keeps each code to its position', () => {
    expect(fresh({ 'TRC-3|2026-12-02': 'PC' }).map((v) => v.rule)).toContain('position_code');
    expect(fresh({ 'TRC-7|2026-12-02': 'SD-D' }).map((v) => v.rule)).toContain('position_code');
    expect(fresh({ 'DRV-1|2026-12-05': 'D' }).map((v) => v.rule)).toContain('position_code');
  });

  it('lets a Project Coordinator cover the console on weekdays only', () => {
    // Saturday 5 December: TRC-1 is on Day; a PC put on it as well needs agreement.
    expect(fresh({ 'TRC-7|2026-12-05': 'D' }).map((v) => [v.rule, v.severity])).toContainEqual(['pc_cover', 'block']);
    // Friday 11 December is on the template itself.
    expect(check().filter((v) => v.rule === 'pc_cover')).toEqual([]);
  });

  it('warns at the 48-hour target for TRCs only, and blocks everyone above 52', () => {
    // A driver's day week is 50 hours: no warning.
    expect(check().filter((v) => v.rule === 'weekly_target' && v.lineCode?.startsWith('DRV'))).toEqual([]);
    // A sixth day shift takes DRV-1 to 60 hours.
    const sixth = fresh({ 'DRV-1|2026-12-05': 'SD-D' });
    expect(sixth.map((v) => [v.rule, v.severity])).toContainEqual(['weekly_max', 'block']);
  });

  it('flags a TRC rostered to work a rest day', () => {
    // 11 December is a rest day in TRC-1's rotation.
    const worked = fresh({ 'TRC-1|2026-12-11': 'S' });
    expect(worked.map((v) => [v.rule, v.severity])).toContainEqual(['rest_day_worked', 'warn']);
  });

  it('names the fallback when no TRC is on call on a weekday', () => {
    const result = check();
    // Wed 2 Dec: TRC-7 at their desk. Fri 4 Dec: TRC-7 resting after a Night, TRC-6 in Ethiopia.
    expect(result.find((v) => v.date === '2026-12-02' && v.rule === 'no_on_call')?.message).toMatch(/Project Coordinator is the fallback/);
    expect(result.find((v) => v.date === '2026-12-04')?.rule).toBe('no_fallback');
  });
});

describe('totals and payroll by position', () => {
  const cells = (code: string) => dates.map((date) => ({ date, cell: grid()(line(code).id, date) }));

  it('counts days away under each code, every calendar day of the period', () => {
    expect(lineTotals(rules, cells('TRC-2'), HOLIDAYS).away).toEqual({ LV: 14, SL: 0, CTO: 0, UL: 0 });
    // Ethiopia relief is time away from this roster, not leave.
    expect(lineTotals(rules, cells('TRC-6'), HOLIDAYS).away.LV).toBe(7);
  });

  it('counts a driver’s paid hours and night shifts', () => {
    const totals = lineTotals(rules, cells('DRV-1'), HOLIDAYS);
    // 13 day shifts at 10 h; nights: 5 at 9 h and 4 late finishes at 10.5 h.
    expect(totals.shifts).toBe(22);
    expect(totals.hours).toBe(13 * 10 + 5 * 9 + 4 * 10.5);
    expect(totals.nights).toBe(9);
  });

  it('separates a Project Coordinator’s cover from a call-in, and counts unpaid leave', () => {
    const lookup: CellLookup = (lineId, date) => {
      if (lineId !== 7) return null;
      if (date === '2026-12-01') return { ...cellOfWritten(rules, 'PC'), worked: 'S', status: 'cover' };
      if (date === '2026-12-02') return cellOfWritten(rules, 'UL');
      return null;
    };
    const totals = payrollTotals(rules, line('TRC-7'), lookup, '2026-12-01', '2026-12-07', HOLIDAYS, '2026-12-08');
    expect(totals).toMatchObject({ workedHours: 8, coverHours: 8, callInHours: 0, unpaidDays: 1 });
  });
});

describe('compensatory time off', () => {
  it('takes the earliest day that had not lapsed, and lapses the rest', () => {
    const earned = [
      { date: '2026-09-01', days: 1, expiresOn: '2026-11-30' },
      { date: '2026-12-12', days: 1, expiresOn: '2027-03-12' },
      { date: '2026-12-25', days: 1, expiresOn: '2027-03-25' },
    ];
    // One day taken in October uses September's; nothing else is taken.
    expect(ctoBalance(earned, ['2026-10-10'], '2026-12-28')).toEqual({ earned: 3, taken: 1, lapsed: 0, balance: 2, expiringSoon: 0, nextExpiry: '2027-03-12' });
    // Untaken, September's has lapsed by December.
    expect(ctoBalance(earned, [], '2026-12-28')).toMatchObject({ lapsed: 1, balance: 2 });
    // Close to expiry it is flagged.
    expect(ctoBalance(earned, [], '2027-03-01')).toMatchObject({ balance: 2, expiringSoon: 2, nextExpiry: '2027-03-12' });
    // A day taken with nothing to draw on shows as negative.
    expect(ctoBalance([], ['2026-12-01'], '2026-12-28').balance).toBe(-1);
  });
});

describe('uploading the template', () => {
  const header = ['TRC', ...dates.map((date) => String(Number(date.slice(8))))];
  const rows = [header, ...Object.entries(GRID).map(([billet, codes]) => [billet, ...codes.split(' ')])];
  const data = [
    ['date', 'weekday', 'billet', 'position', 'shift_code'],
    ...['TRC-1', 'TRC-2', 'TRC-3', 'TRC-4', 'TRC-5'].map((billet) => ['2026-12-01', 'Tue', billet, 'Travel Risk Coordinator', 'D']),
    ['2026-12-01', 'Tue', 'TRC-6', 'Project Coordinator', 'ETH'],
    ['2026-12-01', 'Tue', 'TRC-7', 'Project Coordinator', 'S'],
    ['2026-12-01', 'Tue', 'DRV-1', 'Driver', 'SD-D'],
    ['2026-12-01', 'Tue', 'DRV-2', 'Driver', 'SD-N2'],
  ];

  it('reads every code on the grid without being taught any', () => {
    const reading = readRosterSheet(rows, DEC, rules);
    expect(reading.people.map((person) => person.label)).toEqual(Object.keys(GRID));
    expect(reading.unknown).toEqual([]);
    expect(reading.recognised).toBe(9 * 31);
  });

  it('reads each billet’s position from the Data tab', () => {
    const positions = readBilletPositions([{ name: 'Data', rows: data }]);
    expect(positions.get('trc6')).toBe('pc');
    expect(positions.get('drv2')).toBe('driver');
    expect(positions.get('trc1')).toBe('trc');
  });

  it('sets new people up as the template describes them', () => {
    const reading = readRosterSheet(rows, DEC, rules);
    const plan = planRosterImport({
      month: DEC,
      rules,
      reading,
      lines: [],
      existing: new Map(),
      holidays: HOLIDAYS,
      positions: readBilletPositions([{ name: 'Data', rows: data }]),
      options: { blankAsOff: false, mapping: {} },
    });
    expect(plan.people.map((person) => [person.label, person.position, person.cycleOffset])).toEqual([
      ['TRC-1', 'trc', 6],
      ['TRC-2', 'trc', 0],
      ['TRC-3', 'trc', 8],
      ['TRC-4', 'trc', 2],
      ['TRC-5', 'trc', 4],
      ['TRC-6', 'pc', null],
      ['TRC-7', 'pc', null],
      ['DRV-1', 'driver', 0],
      ['DRV-2', 'driver', 1],
    ]);
    // What the roster would have generated is kept beside each override.
    const trc2 = plan.people[1]!;
    expect(trc2.shifts.find((shift) => shift.date === '2026-12-07')).toMatchObject({ code: 'LV', generated: 'X' });

    const checks = checkImport({ month: DEC, rules, plan, lines: [], lookup: () => null, generatedMonths: [], holidays: HOLIDAYS });
    expect(checks.blocks).toEqual([]);
  });

  it('reads a position from the row alone when the workbook does not state it', () => {
    const shifts = (code: string) => (GRID[code] as string).split(' ').map((written, i) => ({ date: dates[i] as string, code: written }));
    expect(readPosition(rules, ['DRV-1'], shifts('DRV-1'), HOLIDAYS)).toEqual({ position: 'driver', cycleOffset: 0 });
    expect(readPosition(rules, ['TRC-7'], shifts('TRC-7'), HOLIDAYS)).toEqual({ position: 'pc', cycleOffset: null });
    // A fortnight of leave does not hide TRC-2's place in the rotation.
    expect(readPosition(rules, ['TRC-2'], shifts('TRC-2'), HOLIDAYS)).toEqual({ position: 'trc', cycleOffset: 0 });
  });
});
