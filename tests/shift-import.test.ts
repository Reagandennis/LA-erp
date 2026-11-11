import { describe, expect, it } from 'vitest';

import {
  type ExistingCell,
  type ImportLine,
  checkImport,
  matchLine,
  newLineCodes,
  parseDayHeading,
  parseShiftCode,
  personName,
  planRosterImport,
  readRosterSheet,
  readRosterWorkbook,
  rosterTemplate,
} from '../lib/shift-import';
import { DEFAULT_RULES, type RosterCell, type ShiftCode, generatedCode, monthDates } from '../lib/shift-rules';

const rules = DEFAULT_RULES;
const NOV = '2026-11';
const DEC = '2026-12';

const line = (id: number, offset: number | null, name: string, extra: Partial<ImportLine> = {}): ImportLine => ({
  id,
  code: `TRC-${id}`,
  name,
  displayName: name,
  email: null,
  cycleOffset: offset,
  startDate: null,
  endDate: null,
  active: true,
  ...extra,
});

const lines: ImportLine[] = [
  line(1, 0, 'Reagan Enoch', { email: 'reagan@example.com' }),
  line(2, 2, 'Brian Otieno'),
  line(3, 4, 'Mercy Wanjiru'),
  line(4, 6, 'Kevin Mwangi'),
  line(5, 8, 'Aisha Hassan'),
];

/** The rotation for a month as a sheet: Code, Name, then a column per day. */
function rotationSheet(month: string, who: ImportLine[] = lines): string[][] {
  const dates = monthDates(month);
  return [
    ['Code', 'Name', ...dates.map((d) => String(Number(d.slice(8))))],
    ...who.map((l) => [l.code, l.name, ...dates.map((d) => generatedCode(rules, l.cycleOffset ?? 0, d))]),
  ];
}

describe('shift codes as people write them', () => {
  it.each([
    ['D', 'D'], ['d', 'D'], ['Day', 'D'], ['AM', 'D'], ['Morning', 'D'],
    ['S', 'S'], ['swing', 'S'], ['Afternoon', 'S'], ['PM', 'S'],
    ['N', 'N'], ['NIGHT', 'N'], ['Night shift', 'N'],
    ['OC', 'OC'], ['O/C', 'OC'], ['On-Call', 'OC'], ['on call', 'OC'], ['Standby', 'OC'],
    ['X', 'X'], ['OFF', 'X'], ['Off', 'X'], ['Rest day', 'X'], ['RD', 'X'],
    ['LV', 'LV'], ['Leave', 'LV'], ['AL', 'LV'], ['Annual leave', 'LV'],
    ['07:00-15:00', 'D'], ['0700 - 1500', 'D'], ['3pm to 11pm', 'S'], ['23:00–07:00', 'N'],
  ])('%s is %s', (raw, code) => {
    expect(parseShiftCode(raw, rules)).toBe(code);
  });

  it('tells an empty cell from one it cannot read', () => {
    for (const blank of ['', '  ', '-', '—', 'N/A']) expect(parseShiftCode(blank, rules)).toBe('blank');
    for (const junk of ['T', 'Training', '8', '09:00-17:00', 'D/N']) expect(parseShiftCode(junk, rules)).toBeNull();
  });

  it('uses the names the roster gives its shifts', () => {
    const renamed = { ...rules, codes: { ...rules.codes, S: { ...rules.codes.S, name: 'Late Turn' }, D: { ...rules.codes.D, name: 'Early Turn' } } };
    expect(parseShiftCode('late turn', renamed)).toBe('S');
    expect(parseShiftCode('Early Turn', renamed)).toBe('D');
  });
});

describe('day headings', () => {
  it.each([
    ['1', '2026-11-01'], ['01', '2026-11-01'], ['30', '2026-11-30'], ['7.0', '2026-11-07'],
    ['Sun 1', '2026-11-01'], ['1st', '2026-11-01'], ['Mon, 2nd', '2026-11-02'],
    ['1-Nov', '2026-11-01'], ['Nov 1', '2026-11-01'], ['Sunday, November 1, 2026', '2026-11-01'], ['3 Nov 26', '2026-11-03'],
    ['2026-11-05', '2026-11-05'], ['2026-11-05 00:00:00', '2026-11-05'],
    // Day first where both fit; whichever lands in the month where only one does.
    ['05/11/2026', '2026-11-05'], ['11/05/2026', '2026-11-05'], ['11/12/2026', '2026-11-12'], ['13/11/26', '2026-11-13'], ['5/11', '2026-11-05'],
    ['46327', '2026-11-01'],
    ['1-Dec', '2026-12-01'], ['2026-10-31', '2026-10-31'],
  ])('%s is %s', (raw, date) => {
    expect(parseDayHeading(raw, NOV)).toBe(date);
  });

  it('is not fooled by other headings', () => {
    for (const raw of ['', 'Name', 'Total', 'November 2026', '31', '32', '0', 'Week 1', 'S', 'Mon', '2026', '1 shift']) {
      expect(parseDayHeading(raw, NOV), raw).toBeNull();
    }
    expect(parseDayHeading('31', DEC)).toBe('2026-12-31');
  });
});

describe('reading a roster sheet', () => {
  it('reads people down and days across', () => {
    const reading = readRosterSheet(rotationSheet(NOV), NOV, rules);
    expect(reading.turned).toBe(false);
    expect(reading.dates).toHaveLength(30);
    expect(reading.people.map((p) => p.label)).toEqual(lines.map((l) => `${l.code} · ${l.name}`));
    expect(reading.people[0]?.cells.slice(0, 10).map((c) => c.code)).toEqual(['D', 'D', 'S', 'S', 'N', 'N', 'X', 'OC', 'OC', 'X'].map((_, i) => generatedCode(rules, 0, `2026-11-${String(i + 1).padStart(2, '0')}`)));
    expect(reading.recognised).toBe(150);
  });

  it('finds the roster under a title, beside a row count, and above the totals', () => {
    const rows = [
      ['LADY ASKARI CONTROL ROOM'],
      ['Duty roster', '', 'November 2026'],
      [],
      ['No', 'Name', 'Role', 'Sun 1', 'Mon 2', 'Tue 3', 'Wed 4', 'Thu 5', 'Fri 6', 'Sat 7'],
      ['', '', '', 'S', 'M', 'T', 'W', 'T', 'F', 'S'],
      ['1', 'Mercy Wanjiru', 'Controller', 'Day', 'Day', 'Night', 'OFF', '', 'AL', 'd'],
      ['2', 'Kevin Mwangi', 'Controller', 'N', 'N', 'X', 'T', 'D', 'D', 'S'],
      ['', 'On duty', '', '2', '2', '1', '0', '1', '1', '2'],
      ['', 'Legend', '', 'D = Day', 'N = Night'],
    ];
    const reading = readRosterSheet(rows, NOV, rules);
    // "Controller" is beside everyone, so it names nobody.
    expect(reading.people.map((p) => [p.label, p.row, p.names])).toEqual([
      ['Mercy Wanjiru', 6, ['Mercy Wanjiru', 'Controller']],
      ['Kevin Mwangi', 7, ['Kevin Mwangi', 'Controller']],
    ]);
    expect(reading.people[0]?.cells.map((c) => c.code)).toEqual(['D', 'D', 'N', 'X', 'blank', 'LV', 'D']);
    // "T" is kept, to be reported against Kevin, rather than dropping his row.
    expect(reading.people[1]?.cells[3]).toEqual({ date: '2026-11-04', raw: 'T', code: null });
    expect(reading.dates).toEqual(monthDates(NOV).slice(0, 7));
  });

  it('reads a sheet split into weekly blocks, down to a short last one', () => {
    const block = (from: number, to: number, a: string[], b: string[]) => [
      ['Name', ...Array.from({ length: to - from + 1 }, (_, i) => String(from + i))],
      ['Mercy', ...a],
      ['Kevin', ...b],
      [],
    ];
    const rows = [
      ...block(1, 14, Array(14).fill('D'), Array(14).fill('N')),
      ...block(15, 28, Array(14).fill('N'), Array(14).fill('D')),
      ...block(29, 30, ['X', 'X'], ['OC', 'OC']),
      // A row of totals that happens to count upwards is not a new block: the row
      // under it is still read against the 29th and 30th, not the 1st and 2nd.
      ['Total', '1', '2'],
      ['Mercy', 'N', 'N'],
    ];
    const reading = readRosterSheet(rows, NOV, rules);
    expect(reading.dates).toHaveLength(30);
    expect(reading.people).toHaveLength(2);
    const mercy = reading.people[0]?.cells.map((c) => c.code).join('');
    expect(mercy).toBe('D'.repeat(14) + 'N'.repeat(14) + 'XX');
    expect(reading.conflicts).toEqual([
      'Mercy, 29 Nov: the file says both “X” and “N”. The first was used.',
      'Mercy, 30 Nov: the file says both “X” and “N”. The first was used.',
    ]);
  });

  it('turns a sheet round when the days run down the side', () => {
    const rows = [
      ['Date', 'Mercy Wanjiru', 'Kevin Mwangi'],
      ...monthDates(NOV).slice(0, 10).map((date, i) => [date, i % 2 ? 'D' : 'N', 'OFF']),
    ];
    const reading = readRosterSheet(rows, NOV, rules);
    expect(reading.turned).toBe(true);
    expect(reading.people.map((p) => p.label)).toEqual(['Mercy Wanjiru', 'Kevin Mwangi']);
    expect(reading.people[1]?.cells.every((c) => c.code === 'X')).toBe(true);
  });

  it('keeps the first of two answers for the same day and says so', () => {
    const rows = [
      ['Name', '1', '2', '3', '4', '5'],
      ['Mercy', 'D', 'D', '', 'D', 'D'],
      ['Mercy', 'N', 'D', 'S', 'D', 'D'],
    ];
    const reading = readRosterSheet(rows, NOV, rules);
    expect(reading.people).toHaveLength(1);
    expect(reading.people[0]?.cells.map((c) => c.code)).toEqual(['D', 'D', 'S', 'D', 'D']);
    expect(reading.conflicts).toEqual(['Mercy, 1 Nov: the file says both “D” and “N”. The first was used.']);
  });

  it('passes over rows that are not shifts and remembers what they held', () => {
    const rows = [
      ['Name', '1', '2', '3', '4', '5'],
      ['Mercy', 'M', 'M', 'E', 'E', 'N'],
    ];
    const reading = readRosterSheet(rows, NOV, rules);
    expect(reading.people).toHaveLength(0);
    expect(reading.ignored).toEqual([{ label: 'Mercy', samples: ['M', 'E'] }]);
  });

  it('says nothing about a row of totals', () => {
    const rows = [
      ['Name', '1', '2', '3', '4', '5'],
      ['Mercy', 'D', 'D', 'N', 'N', 'X'],
      ['On duty', '1', '1', '1', '1', '0'],
      ['Cover %', '33%', '33%', '33.5', '33', '0'],
    ];
    const reading = readRosterSheet(rows, NOV, rules);
    expect(reading.people).toHaveLength(1);
    expect(reading.ignored).toEqual([]);
  });
});

describe('choosing the sheet', () => {
  const october = [['Name', ...monthDates('2026-10').slice(0, 7)], ['Mercy', 'D', 'D', 'D', 'D', 'D', 'D', 'D']];

  it('prefers the sheet named for the month, then the fullest', () => {
    const sheets = [
      { name: 'Summary', rows: [['Notes']] },
      { name: 'Dec', rows: rotationSheet(NOV) },
      { name: 'Nov 2026', rows: rotationSheet(NOV, lines.slice(0, 2)) },
      { name: 'Draft', rows: rotationSheet(NOV, lines.slice(0, 3)) },
    ];
    const read = readRosterWorkbook(sheets, NOV, rules);
    expect(read.sheet).toBe('Nov 2026');
    expect(read.sheets).toEqual(['Dec', 'Nov 2026', 'Draft']);
    expect(readRosterWorkbook(sheets, NOV, rules, 'Draft').reading?.people).toHaveLength(3);
    expect(readRosterWorkbook(sheets.slice(0, 2).concat(sheets[3]!), NOV, rules).sheet).toBe('Dec');
  });

  it('says which month a file is for when it is not the one picked', () => {
    const read = readRosterWorkbook([{ name: 'Sheet1', rows: october }], NOV, rules);
    expect(read.reading).toBeNull();
    expect(read.error).toMatch(/roster for October 2026, not November 2026/);
    expect(readRosterWorkbook([{ name: 'Sheet1', rows: october }], '2026-10', rules).reading?.people).toHaveLength(1);
  });

  it('is not turned round by a column of row numbers', () => {
    // Read sideways, "No" 1 to 6 would pass for the first six days of any month.
    const dates = monthDates('2027-02');
    const sheet = (heading: string[]) => [
      ['No', 'Name', ...heading],
      ['', '', ...dates.map(() => 'M')],
      ...['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay'].map((name, i) => [String(i + 1), name, ...dates.map(() => 'D')]),
    ];
    const dated = readRosterWorkbook([{ name: 'Sheet1', rows: sheet(dates) }], '2027-03', rules);
    expect(dated.reading).toBeNull();
    expect(dated.error).toMatch(/roster for February 2027, not March 2027/);

    // With headings that name no month the sheet is read the right way up, for the month picked.
    const numbered = readRosterWorkbook([{ name: 'Sheet1', rows: sheet(dates.map((d) => String(Number(d.slice(8))))) }], '2027-03', rules);
    expect(numbered.reading?.turned).toBe(false);
    expect(numbered.reading?.people.map((p) => p.label)).toEqual(['Ann', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay']);
  });

  it('says what is wrong with codes it does not know, and with a file that holds no roster', () => {
    const odd = readRosterWorkbook([{ name: 'S', rows: [['Name', '1', '2', '3', '4', '5'], ['Mercy', 'M', 'M', 'E', 'E', 'E']] }], NOV, rules);
    expect(odd.error).toMatch(/not shift codes this roster uses \(for example “M”, “E”\)/);
    expect(odd.error).toMatch(/D for Day, S for Swing/);
    expect(readRosterWorkbook([{ name: 'S', rows: [['Invoice', 'Amount'], ['A-1', '300']] }], NOV, rules).error).toMatch(/No roster was found.*headed 1 to 30/);
  });
});

describe('matching a row to a roster line', () => {
  it('matches the code, the name in any order, the email, or a name only one person has', () => {
    expect(matchLine(['trc 3'], lines)?.id).toBe(3);
    expect(matchLine(['Wanjiru, Mercy'], lines)?.id).toBe(3);
    expect(matchLine(['REAGAN@example.com'], lines)?.id).toBe(1);
    expect(matchLine(['Controller', 'Kevin'], lines)?.id).toBe(4);
    expect(matchLine(['Aisha H.'], lines)).toBeNull();
    // First name and surname in their own columns.
    expect(matchLine(['Hassan', 'Aisha'], lines)?.id).toBe(5);
    expect(matchLine(['Someone Else'], lines)).toBeNull();
  });

  it('does not guess between two people who share a name, and prefers the code over a name', () => {
    const twins = [...lines, line(6, null, 'Mercy Achieng')];
    expect(matchLine(['Mercy'], twins)).toBeNull();
    expect(matchLine(['Mercy Wanjiru', 'TRC-5'], lines)?.id).toBe(5);
  });

  it('reaches an inactive line only when nobody active matches', () => {
    const former = [...lines, line(6, null, 'Mercy Wanjiru', { active: false })];
    expect(matchLine(['Mercy Wanjiru'], former)?.id).toBe(3);
    expect(matchLine(['TRC-6'], former)?.id).toBe(6);
  });
});

describe('new people', () => {
  it('are named by what is theirs alone when a role sits beside every name', () => {
    const rows = [['Name', 'Role', '1', '2', '3', '4', '5'], ['Jane', 'Shift Lead', 'D', 'D', 'D', 'D', 'D'], ['John', 'Shift Lead', 'N', 'N', 'N', 'N', 'N']];
    const people = readRosterSheet(rows, NOV, rules).people;
    expect(people.map((p) => personName(p.identity))).toEqual(['Jane', 'John']);
  });

  it('names them from the cell that reads like a name', () => {
    expect(personName(['EMP-9', 'Jane Doe', 'jane@example.com'])).toBe('Jane Doe');
    expect(personName(['Jane'])).toBe('Jane');
  });

  it('carries on the roster numbering, or keeps a code the file gives', () => {
    expect(newLineCodes(['TRC-1', 'TRC-2', 'TRC-5', 'SUP'], [['Jane Doe'], ['John Roe']])).toEqual(['TRC-6', 'TRC-7']);
    expect(newLineCodes(['TRC-1'], [['TRC-9', 'Jane Doe'], ['trc-9', 'Copy Cat'], ['TRC-1', 'Taken']])).toEqual(['TRC-9', 'TRC-2', 'TRC-3']);
    expect(newLineCodes([], [['Jane Doe']])).toEqual(['P-1']);
  });
});

describe('planning an upload', () => {
  const saved = (planned: ShiftCode, extra: Partial<ExistingCell> = {}): ExistingCell => ({
    id: 0,
    planned,
    generated: planned,
    locked: false,
    cell: { generated: planned, planned, worked: null, status: 'planned', hours: null, start: null, end: null },
    ...extra,
  });

  /** November as generated from the rotation, by `${lineId}|${date}`. */
  function generatedMonth(month = NOV): Map<string, ExistingCell> {
    const out = new Map<string, ExistingCell>();
    let id = 100;
    for (const l of lines) for (const date of monthDates(month)) out.set(`${l.id}|${date}`, saved(generatedCode(rules, l.cycleOffset ?? 0, date), { id: (id += 1) }));
    return out;
  }

  const plan = (rows: string[][], existing: Map<string, ExistingCell>, options: Partial<{ blankAsOff: boolean; mapping: Record<string, number | 'new' | 'skip'> }> = {}, who = lines) =>
    planRosterImport({ month: NOV, rules, reading: readRosterSheet(rows, NOV, rules), lines: who, existing, options: { blankAsOff: false, mapping: {}, ...options } });

  it('changes nothing when the file is the roster already', () => {
    const result = plan(rotationSheet(NOV), generatedMonth());
    expect(result.people.every((p) => p.matched && p.shifts.length === 0 && p.unchanged === 30)).toBe(true);
    expect(result.notes).toEqual([]);
  });

  it('creates every shift in a month that does not exist, remembering what the rotation gives', () => {
    const rows = [['Name', '1', '2', '3', '4', '5'], ['Mercy Wanjiru', 'N', 'N', 'N', 'OFF', 'OFF']];
    const [mercy] = plan(rows, new Map()).people;
    expect(mercy?.target).toBe(3);
    expect(mercy?.shifts).toEqual(
      ['N', 'N', 'N', 'X', 'X'].map((code, i) => ({ date: `2026-11-0${i + 1}`, code, recordId: null, generated: generatedCode(rules, 4, `2026-11-0${i + 1}`) })),
    );
  });

  it('updates only the days that differ, leaving blanks and recorded days alone', () => {
    const existing = generatedMonth();
    const first = existing.get('3|2026-11-01')!;
    const worked = existing.get('3|2026-11-02')!;
    existing.set('3|2026-11-02', { ...worked, locked: true });
    const other = (code: ShiftCode): ShiftCode => (code === 'X' ? 'D' : 'X');
    const rows = [
      ['Name', '1', '2', '3', '4', '5'],
      ['Mercy Wanjiru', other(first.planned), other(worked.planned), '', existing.get('3|2026-11-04')!.planned, 'Training'],
    ];
    const result = plan(rows, existing);
    const [mercy] = result.people;
    expect(mercy?.shifts).toEqual([{ date: '2026-11-01', code: other(first.planned), recordId: first.id, generated: first.generated }]);
    expect(mercy).toMatchObject({ unchanged: 1, blank: 1, locked: 1, unreadable: 1 });
    expect(result.notes).toHaveLength(2);
    expect(result.notes[0]).toMatch(/2 Nov: already recorded as worked, sick or called in/);
    expect(result.notes[1]).toBe('Mercy Wanjiru, 5 Nov: “Training” is not a shift code, so that day was left as it is.');
  });

  it('rosters blanks as Off when asked', () => {
    const rows = [['Name', '1', '2', '3', '4', '5'], ['Mercy Wanjiru', 'D', '', '-', 'D', '']];
    const [mercy] = plan(rows, new Map(), { blankAsOff: true }).people;
    expect(mercy?.shifts.map((s) => s.code)).toEqual(['D', 'X', 'X', 'D', 'X']);
    expect(mercy?.blank).toBe(0);
  });

  it('adds someone the roster does not know, unless told who they are or to skip them', () => {
    const rows = [['Name', '1', '2', '3', '4', '5'], ['Wanjiru M.', 'D', 'D', 'D', 'D', 'D'], ['Kevin Mwangi', 'N', 'N', 'N', 'N', 'N']];
    const fresh = plan(rows, new Map()).people[0];
    expect(fresh).toMatchObject({ target: 'new', matched: false, lineCode: null });
    expect(fresh?.shifts[0]).toEqual({ date: '2026-11-01', code: 'D', recordId: null, generated: 'D' });

    const told = plan(rows, new Map(), { mapping: { 'wanjiru m.': 3 } }).people[0];
    expect(told).toMatchObject({ target: 3, matched: false, lineCode: 'TRC-3', lineName: 'Mercy Wanjiru' });

    const skipped = plan(rows, new Map(), { mapping: { 'wanjiru m.': 'skip', 'kevin mwangi': 99 } }).people;
    expect(skipped[0]).toMatchObject({ target: 'skip', shifts: [] });
    // A line that is not there falls back to the match from the file.
    expect(skipped[1]?.target).toBe(4);
  });

  it('gives a line each day once when two rows are both that person', () => {
    const rows = [['Name', '1', '2', '3', '4', '5'], ['Mercy Wanjiru', 'D', 'D', '', 'D', 'D'], ['M. Wanjiru', 'N', 'N', 'N', 'N', 'N']];
    const result = plan(rows, new Map(), { mapping: { 'm. wanjiru': 3 } });
    expect(result.people[0]?.shifts.map((s) => s.code)).toEqual(['D', 'D', 'D', 'D']);
    expect(result.people[1]?.shifts).toEqual([{ date: '2026-11-03', code: 'N', recordId: null, generated: generatedCode(rules, 4, '2026-11-03') }]);
    expect(result.notes.filter((n) => /already has this day from another row/.test(n))).toHaveLength(4);
  });

  it('skips days outside the time someone is on the roster', () => {
    const joined = lines.map((l) => (l.id === 3 ? { ...l, startDate: '2026-11-04' } : l));
    const rows = [['Name', '1', '2', '3', '4', '5'], ['Mercy Wanjiru', 'D', 'D', 'D', 'D', 'D']];
    const result = plan(rows, new Map(), {}, joined);
    expect(result.people[0]).toMatchObject({ outside: 3 });
    expect(result.people[0]?.shifts.map((s) => s.date)).toEqual(['2026-11-04', '2026-11-05']);
    expect(result.notes).toEqual(["Mercy Wanjiru: 3 days are before TRC-3's start date or after their end date, and were skipped."]);
  });

  it('caps a long list of notes', () => {
    const rows = [['Name', ...monthDates(NOV).map((d) => d.slice(8))], ...lines.map((l) => [l.name, ...monthDates(NOV).map((_, i) => (i < 12 ? 'Q' : 'D'))])];
    const result = plan(rows, new Map());
    expect(result.notes).toHaveLength(40);
    expect(result.moreNotes).toBe(20);
  });

  describe('against the roster rules', () => {
    const lookupOf = (existing: Map<string, ExistingCell>) => (lineId: number, date: string): RosterCell | null => existing.get(`${lineId}|${date}`)?.cell ?? null;

    it('passes the rotation uploaded into an empty month', () => {
      const result = plan(rotationSheet(NOV), new Map());
      const checks = checkImport({ month: NOV, rules, plan: result, lines, lookup: () => null, generatedMonths: [] });
      expect(checks.blocks).toEqual([]);
      expect(checks.newBlocks).toEqual([]);
    });

    it('reports the gaps a partial roster leaves in a month that did not exist', () => {
      const result = plan(rotationSheet(NOV, lines.slice(0, 4)), new Map());
      const checks = checkImport({ month: NOV, rules, plan: result, lines, lookup: () => null, generatedMonths: [] });
      expect(checks.blocks.length).toBeGreaterThan(0);
      expect(checks.blocks.every((v) => v.rule === 'coverage_gap' || v.rule === 'no_on_call')).toBe(true);
      expect(checks.newBlocks).toHaveLength(checks.blocks.length);
    });

    it('counts only the problems the upload adds to a month that is already there', () => {
      const existing = generatedMonth();
      const day = '2026-11-10';
      const onDay = lines.find((l) => existing.get(`${l.id}|${day}`)?.planned === 'D')!;
      const rows = [['Name', '8', '9', '10', '11', '12'], [onDay.name, ...['08', '09', '10', '11', '12'].map((d) => (d === '10' ? 'OFF' : existing.get(`${onDay.id}|2026-11-${d}`)!.planned))]];
      const result = plan(rows, existing);
      expect(result.people[0]?.shifts).toHaveLength(1);
      const checks = checkImport({ month: NOV, rules, plan: result, lines, lookup: lookupOf(existing), generatedMonths: [NOV] });
      expect(checks.newBlocks.map((v) => v.key)).toEqual([`coverage_gap|${day}|D`]);
    });

    it('lets a new person cover, and shows approved leave as Leave', () => {
      const existing = generatedMonth();
      const day = '2026-11-10';
      const onDay = lines.find((l) => existing.get(`${l.id}|${day}`)?.planned === 'D')!;
      const rows = [['Name', '10'].concat(['11', '12', '13', '14']), [onDay.name, 'OFF', '', '', '', ''], ['Temp Cover', 'D', '', '', '', '']];
      const result = plan(rows, existing);
      expect(result.people[1]?.target).toBe('new');
      const covered = checkImport({ month: NOV, rules, plan: result, lines, lookup: lookupOf(existing), generatedMonths: [NOV] });
      expect(covered.newBlocks).toEqual([]);

      // The same shift, but the cover's day falls on leave already approved for them.
      const told = plan(rows, existing, { mapping: { 'temp cover': 5 } });
      const coverDay = told.people[1]!.shifts[0]!;
      const leave = checkImport({ month: NOV, rules, plan: told, lines, lookup: lookupOf(existing), generatedMonths: [NOV], onLeave: new Set([`5|${coverDay.date}`]) });
      expect(leave.newBlocks.map((v) => v.rule)).toContain('coverage_gap');
    });
  });
});

describe('the template', () => {
  it('is the month as the upload reads it back', () => {
    const table = rosterTemplate({ month: NOV, lines, codeAt: (lineId, date) => generatedCode(rules, lines.find((l) => l.id === lineId)!.cycleOffset ?? 0, date) });
    expect(table[0]?.slice(0, 4)).toEqual(['Code', 'Name', '1', '2']);
    expect(table[0]).toHaveLength(32);
    const reading = readRosterSheet(table, NOV, rules);
    expect(reading.recognised).toBe(150);
    expect(reading.people.map((p) => matchLine(p.names, lines)?.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('leaves the name out for a line that has none, and a cell empty where nothing is rostered', () => {
    const table = rosterTemplate({ month: NOV, lines: [{ id: 9, code: 'TRC-9', name: 'TRC-9' }], codeAt: () => null });
    expect(table[1]?.slice(0, 3)).toEqual(['TRC-9', '', '']);
  });
});
