import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RULES,
  type CellLookup,
  type RosterCell,
  type RosterLine,
  type ShiftCode,
  type ShiftRules,
  addDays,
  baseOf,
  codeDef,
  isRosterCode,
  rosterCodes,
  writtenCodes,
  isWorking,
  currentAndNext,
  absoluteMinutes,
  cycleRange,
  dutyOf,
  generatedCode,
  leaveAccrued,
  lineTotals,
  monthDates,
  newViolations,
  patternCell,
  payrollTotals,
  sanitizeRules,
  validateRoster,
  zonedNow,
} from '../lib/shift-rules';
import { type RecordView, buildLookup, indexRecords, recordKey } from '../lib/shift-types';

const rules = DEFAULT_RULES;

/** The December 2026 sample roster, one string of codes per person. */
const SAMPLE: Record<string, string> = {
  'TRC-1': 'D D S S N N X OC OC X D D S S N N X OC OC X D D S S N N X OC OC X D',
  'TRC-2': 'S S N N X OC OC X D D S S N N X OC OC X D D S S N N X OC OC X D D S',
  'TRC-3': 'N N X OC OC X D D S S N N X OC OC X D D S S N N X OC OC X D D S S N',
  'TRC-4': 'X OC OC X D D S S N N X OC OC X D D S S N N X OC OC X D D S S N N X',
  'TRC-5': 'OC X D D S S N N X OC OC X D D S S N N X OC OC X D D S S N N X OC OC',
};

const lines: RosterLine[] = [0, 2, 4, 6, 8].map((offset, i) => ({
  id: i + 1,
  code: `TRC-${i + 1}`,
  cycleOffset: offset,
  startDate: null,
  endDate: null,
  active: true,
}));

const december = monthDates('2026-12');

/** A lookup over the rotation with a few cells replaced. */
function withOverrides(overrides: Record<string, Partial<RosterCell>> = {}): CellLookup {
  return (lineId, date) => {
    const line = lines.find((l) => l.id === lineId)!;
    const base = patternCell(rules, line.cycleOffset!, date);
    const patch = overrides[`${line.code}|${date}`];
    return patch ? { ...base, ...patch } : base;
  };
}

describe('rotation', () => {
  it('reproduces the December 2026 sample with no manual changes', () => {
    for (const line of lines) {
      const produced = december.map((date) => generatedCode(rules, line.cycleOffset!, date)).join(' ');
      expect(produced, line.code).toBe(SAMPLE[line.code]);
    }
  });

  it('runs continuously across a month boundary instead of restarting', () => {
    // 31 Dec is cycle day 1 for TRC-1 (D); 1 Jan must carry on to day 2 (D), then S.
    expect(generatedCode(rules, 0, '2026-12-31')).toBe('D');
    expect(generatedCode(rules, 0, '2027-01-01')).toBe('D');
    expect(generatedCode(rules, 0, '2027-01-02')).toBe('S');
    // And backwards, before the rotation start.
    expect(generatedCode(rules, 0, '2026-11-30')).toBe('X');
  });

  it('puts exactly one person on call every day', () => {
    for (const date of december) {
      const onCall = lines.filter((l) => generatedCode(rules, l.cycleOffset!, date) === 'OC');
      expect(onCall, date).toHaveLength(1);
    }
  });

  it('knows which cycle a date belongs to', () => {
    expect(cycleRange(rules, '2026-12-15')).toEqual({ from: '2026-12-11', to: '2026-12-20' });
  });
});

describe('totals', () => {
  it('matches the per-person totals on the sample sheet', () => {
    const holidays = new Set(['2026-12-12', '2026-12-25', '2026-12-26']);
    const expected: Record<string, [number, number, number, number, number, number, number]> = {
      // D, S, N, OC, X, shifts, hours
      'TRC-1': [7, 6, 6, 6, 6, 19, 152],
      'TRC-2': [6, 7, 6, 6, 6, 19, 152],
      'TRC-3': [6, 6, 7, 6, 6, 19, 152],
      'TRC-4': [6, 6, 6, 6, 7, 18, 144],
      'TRC-5': [6, 6, 6, 7, 6, 18, 144],
    };
    for (const line of lines) {
      const totals = lineTotals(
        rules,
        december.map((date) => ({ date, cell: patternCell(rules, line.cycleOffset!, date) })),
        holidays,
      );
      const { D, S, N, OC, X } = totals.codes;
      expect([D, S, N, OC, X, totals.shifts, totals.hours], line.code).toEqual(expected[line.code]);
    }
  });
});

describe('validation', () => {
  it('passes the generated rotation clean', () => {
    expect(validateRoster(rules, lines, withOverrides(), '2026-12-01', '2026-12-31')).toEqual([]);
  });

  it('blocks a coverage gap and a double', () => {
    // TRC-1 takes leave on a Day shift and nobody covers.
    const gap = validateRoster(rules, lines, withOverrides({ 'TRC-1|2026-12-01': { planned: 'LV' } }), '2026-12-01', '2026-12-01');
    expect(gap.map((v) => v.rule)).toEqual(['coverage_gap']);
    expect(gap[0]!.severity).toBe('block');

    // TRC-4 (off) is put on Day as well.
    const double = validateRoster(rules, lines, withOverrides({ 'TRC-4|2026-12-01': { planned: 'D' } }), '2026-12-01', '2026-12-01');
    expect(double.map((v) => v.rule)).toContain('coverage_double');
  });

  it('accepts leave once the on-call person covers the shift, and warns that nobody is on call', () => {
    const lookup = withOverrides({
      'TRC-1|2026-12-01': { planned: 'LV' },
      'TRC-5|2026-12-01': { planned: 'D' },
    });
    const result = validateRoster(rules, lines, lookup, '2026-12-01', '2026-12-01');
    expect(result.filter((v) => v.severity === 'block')).toEqual([]);
    expect(result.map((v) => v.rule)).toEqual(['no_on_call']);
  });

  it('treats a sick person as a gap until someone is called in', () => {
    const sick = { 'TRC-1|2026-12-01': { status: 'sick' as const } };
    expect(validateRoster(rules, lines, withOverrides(sick), '2026-12-01', '2026-12-01').map((v) => v.rule)).toEqual(['coverage_gap']);

    const covered = { ...sick, 'TRC-5|2026-12-01': { worked: 'D' as ShiftCode, status: 'call-in' as const } };
    expect(validateRoster(rules, lines, withOverrides(covered), '2026-12-01', '2026-12-01')).toEqual([]);
  });

  it('blocks a duty that starts inside the minimum rest', () => {
    // TRC-3 finishes Night at 07:00 on 3 Dec, then is put on Day at 07:00 that morning.
    const lookup = withOverrides({ 'TRC-3|2026-12-03': { planned: 'D' } });
    const rest = validateRoster(rules, lines, lookup, '2026-12-03', '2026-12-03').filter((v) => v.rule === 'rest');
    expect(rest).toHaveLength(1);
    expect(rest[0]!.lineCode).toBe('TRC-3');
    expect(rest[0]!.severity).toBe('block');
  });

  it('warns above the weekly target and blocks above the weekly limit', () => {
    // TRC-1 works its six shifts (48 h); a 4-hour call-in on the rest day makes 52 h in seven days.
    const short = withOverrides({ 'TRC-1|2026-12-07': { worked: 'D', status: 'call-in', hours: 4 } });
    const rulesFired = validateRoster(rules, [lines[0]!], short, '2026-12-07', '2026-12-07').map((v) => v.rule);
    expect(rulesFired).toContain('weekly_target');
    expect(rulesFired).not.toContain('weekly_max');

    // A 12-hour call-in takes the same window past 52 h.
    const long = withOverrides({ 'TRC-1|2026-12-07': { worked: 'D', status: 'call-in', hours: 12 } });
    const blocked = validateRoster(rules, [lines[0]!], long, '2026-12-07', '2026-12-07');
    expect(blocked.find((v) => v.rule === 'weekly_max')?.severity).toBe('block');
  });

  it('blocks seven days without a full day off, and warns on a seventh duty running', () => {
    const lookup = withOverrides({ 'TRC-1|2026-12-07': { planned: 'D' } });
    const result = validateRoster(rules, [lines[0]!], lookup, '2026-12-01', '2026-12-10');
    expect(result.some((v) => v.rule === 'consecutive' && v.date === '2026-12-07')).toBe(true);
    // 1–7 Dec is now seven duties; 8 and 9 Dec are on call, which is not a day off.
    expect(result.filter((v) => v.rule === 'weekly_rest').map((v) => v.date)).toEqual(['2026-12-07', '2026-12-08', '2026-12-09']);
  });

  it('tells a new problem from one that was already there', () => {
    const before = validateRoster(rules, lines, withOverrides({ 'TRC-1|2026-12-01': { planned: 'LV' } }), '2026-12-01', '2026-12-02');
    const after = validateRoster(
      rules,
      lines,
      withOverrides({ 'TRC-1|2026-12-01': { planned: 'LV' }, 'TRC-1|2026-12-02': { planned: 'LV' } }),
      '2026-12-01',
      '2026-12-02',
    );
    expect(newViolations(before, after).map((v) => v.key)).toEqual(['coverage_gap|2026-12-02|D']);
  });
});

describe('duties', () => {
  it('dates a night shift on the day it starts and runs it into the next morning', () => {
    const duty = dutyOf(rules, patternCell(rules, 4, '2026-12-01'), '2026-12-01')!;
    expect(duty.code).toBe('N');
    expect(duty.hours).toBe(8);
    expect(duty.end - duty.start).toBe(8 * 60);
    expect(duty.end).toBe(absoluteMinutes('2026-12-02', 7 * 60));
  });

  it('counts on call as no duty until a call-in is recorded', () => {
    const onCall = patternCell(rules, 8, '2026-12-01');
    expect(dutyOf(rules, onCall, '2026-12-01')).toBeNull();
    expect(dutyOf(rules, { ...onCall, worked: 'S', status: 'call-in' }, '2026-12-01')?.calledIn).toBe(true);
  });

  it('finds the duty in progress and the next one', () => {
    const duties = ['2026-12-01', '2026-12-02', '2026-12-03'].map((date) => dutyOf(rules, patternCell(rules, 0, date), date)!);
    const at = (date: string, time: number) => currentAndNext(duties, absoluteMinutes(date, time));
    expect(at('2026-12-01', 8 * 60).current?.date).toBe('2026-12-01');
    expect(at('2026-12-01', 16 * 60).current).toBeNull();
    expect(at('2026-12-01', 16 * 60).next?.date).toBe('2026-12-02');
  });
});

describe('payroll flags', () => {
  const holidays = new Set(['2026-12-12']);

  it('flags public-holiday hours at 2x and leaves unconfirmed shifts out of worked hours', () => {
    // TRC-1 is on Day on 11 and 12 Dec; only the 12th is confirmed.
    const lookup = withOverrides({ 'TRC-1|2026-12-12': { status: 'worked' } });
    const totals = payrollTotals(rules, lines[0]!, lookup, '2026-12-07', '2026-12-13', holidays, '2026-12-20');
    expect(totals.workedHours).toBe(8);
    expect(totals.holidayHours).toBe(8);
    expect(totals.unconfirmed).toBe(2); // 11 Dec (Day) and 13 Dec (Swing)
  });

  it('flags a rest-day call-in at 2x and hours above the weekly limit as overtime', () => {
    const worked: Record<string, Partial<RosterCell>> = {};
    for (const date of ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']) {
      worked[`TRC-1|${date}`] = { status: 'worked' };
    }
    // Called in on the rest day (Mon 7 Dec starts a new payroll week, so move the test week to Tue–Mon).
    worked['TRC-1|2026-12-07'] = { worked: 'D', status: 'call-in' };
    const tuesdayWeeks = { ...rules, weekStart: 2 };
    const totals = payrollTotals(tuesdayWeeks, lines[0]!, withOverrides(worked), '2026-12-01', '2026-12-07', holidays, '2026-12-20');
    expect(totals.workedHours).toBe(56);
    expect(totals.callInHours).toBe(8);
    expect(totals.restDayHours).toBe(8);
    expect(totals.overtimeHours).toBe(4);
  });
});

describe('leave accrual', () => {
  it('accrues a twelfth of the entitlement per completed month', () => {
    expect(leaveAccrued(21, null, '2026-12-31')).toBe(19.25);
    expect(leaveAccrued(21, '2026-07-15', '2026-12-14')).toBe(7);
    expect(leaveAccrued(21, '2027-02-01', '2026-12-31')).toBe(0);
  });
});

describe('configuration', () => {
  it('accepts the defaults and rejects a pattern with leave in it', () => {
    expect(sanitizeRules(DEFAULT_RULES)).toEqual(DEFAULT_RULES);
    expect(() => sanitizeRules({ ...DEFAULT_RULES, pattern: ['D', 'LV'] })).toThrow(/pattern/i);
    expect(() => sanitizeRules({ ...DEFAULT_RULES, targetHours7d: 60 })).toThrow(/target/i);
  });

  it('reads the roster clock in its own time zone', () => {
    // 22:30 UTC on 30 Nov is 01:30 on 1 Dec in Nairobi.
    expect(zonedNow('Africa/Nairobi', Date.UTC(2026, 10, 30, 22, 30))).toEqual({ date: '2026-12-01', minutes: 90 });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('drafting on a blank day', () => {
  const line: RosterLine = { id: 1, code: 'P1', cycleOffset: null, startDate: null, endDate: null, active: true };
  const saved: RecordView = { id: 9, lineId: 1, date: '2026-12-01', generatedCode: 'D', plannedCode: 'D', workedCode: null, status: 'planned', actualStart: null, actualEnd: null, hoursWorked: null, reasonCode: null, note: null, leaveId: null, callIn: null };
  const records = indexRecords([saved]);

  it('reads nothing where nothing is saved, until a draft rosters the day', () => {
    expect(buildLookup(records)(1, '2026-12-02')).toBeNull();
    // A patch that does not say what is rostered cannot stand for a whole day.
    expect(buildLookup(records, new Map([[recordKey(1, '2026-12-02'), { status: 'worked' as const }]]))(1, '2026-12-02')).toBeNull();
    const drafted = buildLookup(records, new Map([[recordKey(1, '2026-12-02'), { planned: 'N' as const, label: null }]]));
    expect(drafted(1, '2026-12-02')).toEqual({ generated: 'N', planned: 'N', worked: null, status: 'planned', hours: null, start: null, end: null, label: null });
    expect(drafted(1, '2026-12-01')).toMatchObject({ planned: 'D' });
  });

  it('is checked like any other change: a night straight before the day shift breaks the rest rule', () => {
    const day = '2026-11-30';
    const check = (code: ShiftCode) =>
      validateRoster(rules, [line], buildLookup(records, new Map([[recordKey(1, day), { planned: code }]])), day, '2026-12-01', () => true).filter((v) => v.rule === 'rest');
    expect(check('N').map((v) => v.key)).toEqual(['rest|1|2026-12-01']);
    expect(check('X')).toEqual([]);
  });
});

describe("the roster's own codes", () => {
  const own: ShiftRules = {
    ...rules,
    extra: [
      { code: 'SOC-D', name: 'SOC Day', as: 'D', start: '06:00', end: '18:00', hours: null },
      { code: 'SOC-N', name: 'SOC Night', as: 'N', start: null, end: null, hours: 12 },
      { code: 'INT', name: 'Intel desk', as: 'W', start: null, end: null, hours: null },
      { code: 'UP', name: 'Unpaid leave', as: 'LV', start: null, end: null, hours: null },
    ],
  };
  const cell = (planned: ShiftCode, label: string | null = null, extra: Partial<RosterCell> = {}): RosterCell => ({
    generated: planned,
    planned,
    worked: null,
    status: 'planned',
    hours: null,
    start: null,
    end: null,
    label,
    ...extra,
  });

  it('count as the built-in code they stand for', () => {
    expect(['D', 'SOC-D', 'INT', 'UP', 'soc-d', 'ZZ', null].map((code) => baseOf(own, code))).toEqual(['D', 'D', 'W', 'LV', null, null, null]);
    expect(isRosterCode(own, 'SOC-N')).toBe(true);
    expect(isRosterCode(rules, 'SOC-N')).toBe(false);
    expect(rosterCodes(own).map((entry) => entry.code)).toEqual(['D', 'S', 'N', 'W', 'OC', 'X', 'LV', 'SOC-D', 'SOC-N', 'INT', 'UP']);
    // What a database filter for "a day of work" has to list.
    expect(writtenCodes(own, isWorking)).toEqual(['D', 'S', 'N', 'W', 'SOC-D', 'SOC-N', 'INT']);
  });

  it('keep their own name, times and hours, and borrow the rest', () => {
    expect(codeDef(own, 'D', 'SOC-D')).toEqual({ name: 'SOC Day', start: '06:00', end: '18:00', hours: 12 });
    expect(codeDef(own, 'N', 'SOC-N')).toEqual({ name: 'SOC Night', start: '23:00', end: '07:00', hours: 12 });
    expect(codeDef(own, 'W', 'INT')).toEqual({ name: 'Intel desk', start: '08:00', end: '17:00', hours: 8 });
    expect(codeDef(own, 'LV', 'UP')).toEqual({ name: 'Unpaid leave', start: null, end: null, hours: 0 });
    expect(codeDef(own, 'D')).toEqual(rules.codes.D);
    // A label left behind by a draft that has moved the day on is not this shift's.
    expect(codeDef(own, 'N', 'SOC-D')).toEqual(rules.codes.N);
  });

  it('work the hours they are written for; a call-in works the shift it covered', () => {
    expect(dutyOf(own, cell('D', 'SOC-D'), '2026-12-01')).toMatchObject({ code: 'D', hours: 12, start: absoluteMinutes('2026-12-01', 6 * 60), end: absoluteMinutes('2026-12-01', 18 * 60) });
    expect(dutyOf(own, cell('W', 'INT'), '2026-12-01')).toMatchObject({ code: 'W', hours: 8 });
    expect(dutyOf(own, cell('LV', 'UP'), '2026-12-01')).toBeNull();
    expect(dutyOf(own, cell('X', null, { worked: 'D', status: 'call-in' }), '2026-12-01')).toMatchObject({ hours: 8 });
  });

  it('cover a console shift only when they stand for one', () => {
    const everyone: RosterLine[] = [1, 2, 3, 4].map((id) => ({ id, code: `P${id}`, cycleOffset: null, startDate: null, endDate: null, active: true }));
    const day = '2026-12-01';
    const roster = (codes: Array<[ShiftCode, string | null]>): CellLookup => (lineId, date) => {
      const entry = codes[lineId - 1];
      return date === day && entry ? cell(entry[0], entry[1]) : null;
    };
    const gaps = (codes: Array<[ShiftCode, string | null]>) =>
      validateRoster(own, everyone, roster(codes), day, day, () => true).filter((v) => v.rule === 'coverage_gap').map((v) => v.key);
    expect(gaps([['D', 'SOC-D'], ['S', null], ['N', 'SOC-N'], ['OC', null]])).toEqual([]);
    expect(gaps([['W', 'INT'], ['S', null], ['N', 'SOC-N'], ['OC', null]])).toEqual([`coverage_gap|${day}|D`]);
  });

  it('count a working day towards hours and rest, and leave towards neither', () => {
    const line: RosterLine = { id: 1, code: 'P1', cycleOffset: null, startDate: null, endDate: null, active: true };
    const from = '2026-12-01';
    const week = (code: ShiftCode, label: string): CellLookup => (_id, date) => (date >= from && date <= addDays(from, 6) ? cell(code, label) : null);
    const rulesHit = (lookup: CellLookup) => [...new Set(validateRoster(own, [line], lookup, from, addDays(from, 6), () => true).filter((v) => v.lineId === 1).map((v) => v.rule))].sort();
    // Seven twelve-hour days: over the weekly limit, with no day off.
    expect(rulesHit(week('D', 'SOC-D'))).toEqual(expect.arrayContaining(['weekly_max', 'weekly_rest']));
    expect(rulesHit(week('W', 'INT'))).toEqual(expect.arrayContaining(['weekly_rest', 'weekly_max']));
    expect(rulesHit(week('LV', 'UP'))).toEqual([]);
    const totals = lineTotals(own, [{ date: from, cell: cell('D', 'SOC-D') }, { date: addDays(from, 1), cell: cell('W', 'INT') }, { date: addDays(from, 2), cell: cell('LV', 'UP') }], new Set());
    expect(totals).toMatchObject({ shifts: 2, hours: 20, codes: { D: 1, W: 1, LV: 1 } });
  });

  it('are checked when the rules are saved', () => {
    const save = (extra: unknown) => sanitizeRules({ ...rules, extra });
    expect(save([{ code: ' WT ', as: 'W' }]).extra).toEqual([{ code: 'WT', name: 'WT', as: 'W', start: null, end: null, hours: null }]);
    expect(save([{ code: 'UP', name: ' Unpaid ', as: 'LV', start: '08:00', end: '17:00', hours: 9 }]).extra).toEqual([{ code: 'UP', name: 'Unpaid', as: 'LV', start: null, end: null, hours: null }]);
    expect(save(undefined).extra).toEqual([]);
    expect(() => save([{ code: 'd', as: 'D' }])).toThrow(/already in use/);
    expect(() => save([{ code: 'WT', as: 'W' }, { code: 'wt', as: 'X' }])).toThrow(/already in use/);
    expect(() => save([{ code: 'two words', as: 'W' }])).toThrow(/cannot be a roster code/);
    expect(() => save([{ code: 'WT', as: 'Q' }])).toThrow(/Say what WT counts as/);
    expect(() => save([{ code: 'WT', as: 'W', start: '08:00' }])).toThrow(/both a start and a finish/);
    expect(() => save([{ code: 'WT', as: 'W', hours: 30 }])).toThrow(/between 0 and 24/);
    expect(() => save('WT')).toThrow(/not valid/);
    // The built-in working day has times like a console shift; the pattern still takes neither it nor leave.
    expect(sanitizeRules(rules).codes.W).toEqual({ name: 'Duty', start: '08:00', end: '17:00', hours: 8 });
    expect(() => sanitizeRules({ ...rules, pattern: ['D', 'W'] })).toThrow(/may only use D, S, N, OC and X/);
  });
});
