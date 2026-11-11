/**
 * Reading an uploaded roster: a spreadsheet with one row per person and one
 * column per day, turned into the shifts to put on a month.
 *
 * Client-safe and free of Prisma, like lib/shift-rules.ts: the server plans
 * and saves through these functions, the upload dialog shares their types,
 * and the tests run them without a database.
 *
 * Real rosters are laid out many ways, so nothing here expects a fixed
 * template. The day columns are found by their headings (1, 2, 3… or dates),
 * wherever they start; a sheet split into weekly blocks is read block by
 * block; one with the days down the side is turned round first.
 */

import {
  CODE_KIND,
  SHIFT_CODES,
  type CellLookup,
  type RosterCell,
  type RosterLine,
  type ShiftCode,
  type ShiftRules,
  type Violation,
  generatedCode,
  isDateKey,
  lineOnRoster,
  monthDates,
  monthEnd,
  monthOf,
  monthStart,
  newViolations,
  validateRoster,
} from './shift-rules';
import type { MonthStatus } from './shift-types';

// --- Shift codes ---------------------------------------------------------------

/** What people write for each code besides the code itself and its configured name. */
const SYNONYMS: Record<ShiftCode, string[]> = {
  D: ['day', 'days', 'dayshift', 'am', 'morning', 'early'],
  S: ['swing', 'swingshift', 'afternoon', 'pm', 'evening', 'late'],
  N: ['night', 'nights', 'nightshift'],
  OC: ['oncall', 'call', 'standby', 'stby'],
  X: ['off', 'o', 'dayoff', 'offday', 'offduty', 'rest', 'restday', 'rd', 'r', 'do'],
  LV: ['leave', 'l', 'al', 'annualleave', 'onleave', 'lve', 'vacation', 'vac'],
};

/** Stands for an empty cell in a sheet that fills every box. */
const BLANK_MARKS = new Set(['', '-', '–', '—', '.', '·', '/', 'n/a', 'na']);

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** 'HH:MM' from "7", "07:00", "0700", "7.00" or "7am"; null when it is not a time. */
function clockTime(raw: string): string | null {
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(am|pm)?$/i.exec(raw.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const half = match[3]?.toLowerCase();
  if (half === 'pm' && hour < 12) hour += 12;
  if (half === 'am' && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * The shift a cell stands for: `'blank'` for an empty cell, `null` for text
 * that is not a shift. Understands the codes, the names the rules give them,
 * the common words ("Off", "Night", "On call"), and a shift's hours
 * ("07:00-15:00").
 */
export function parseShiftCode(raw: string, rules: ShiftRules): ShiftCode | 'blank' | null {
  const text = raw.trim();
  if (BLANK_MARKS.has(text.toLowerCase())) return 'blank';
  const key = squash(text);
  if (!key) return null;
  for (const code of SHIFT_CODES) if (key === code.toLowerCase()) return code;
  // The names this roster gives its shifts win over the general words.
  for (const code of SHIFT_CODES) if (key === squash(rules.codes[code].name)) return code;
  for (const code of SHIFT_CODES) if (SYNONYMS[code].includes(key)) return code;

  const span = /^(.+?)\s*(?:-|–|—|to|till|until)\s*(.+)$/i.exec(text);
  if (span) {
    const start = clockTime(span[1] ?? '');
    const end = clockTime(span[2] ?? '');
    if (start && end) {
      for (const code of SHIFT_CODES) {
        if (CODE_KIND[code] === 'console' && rules.codes[code].start === start && rules.codes[code].end === end) return code;
      }
    }
  }
  return null;
}

// --- Day headings --------------------------------------------------------------

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = new Set([
  'mon', 'monday', 'tue', 'tues', 'tuesday', 'wed', 'weds', 'wednesday', 'thu', 'thur', 'thurs', 'thursday',
  'fri', 'friday', 'sat', 'saturday', 'sun', 'sunday', 'm', 't', 'w', 'th', 'f', 's', 'su', 'sa', 'tu',
]);

function monthIndex(word: string): number {
  if (word === 'sept') return 8;
  return MONTH_NAMES.findIndex((name) => name === word || name.slice(0, 3) === word);
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function dateKey(year: number, month: number, day: number): string | null {
  const key = `${year}-${pad2(month)}-${pad2(day)}`;
  return isDateKey(key) ? key : null;
}

function fullYear(text: string): number {
  const n = Number(text);
  return text.length <= 2 ? 2000 + n : n;
}

/**
 * The date a column heading stands for, read for the month being filled:
 * "1", "01", "Sun 1", "1st", "1-Nov", "Nov 1, 2026", "01/11/2026",
 * "2026-11-01", or an Excel day count. A bare day number belongs to that
 * month; a date that could be read day-first or month-first is read whichever
 * way lands in it. Null when the cell is not a day heading.
 */
export function parseDayHeading(raw: string, month: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (iso) return dateKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  if (/^\d+(?:\.0+)?$/.test(text)) {
    const n = Math.round(Number(text));
    if (n >= 1 && n <= 31) return dateKey(year, monthNumber, n);
    // A date cell that lost its date format: Excel's day count (1955 to 2119).
    if (n >= 20_000 && n <= 80_000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
    return null;
  }

  const numeric = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const y = numeric[3] ? fullYear(numeric[3]) : year;
    const dayFirst = dateKey(y, b, a);
    const monthFirst = dateKey(y, a, b);
    if (dayFirst && monthOf(dayFirst) === month) return dayFirst;
    if (monthFirst && monthOf(monthFirst) === month) return monthFirst;
    return dayFirst ?? monthFirst;
  }

  // Words: weekday names are decoration, a month name fixes the month.
  const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  let namedMonth = -1;
  let day: number | null = null;
  let namedYear: number | null = null;
  for (const word of words) {
    const ordinal = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(word);
    if (ordinal && day === null) {
      day = Number(ordinal[1]);
    } else if (/^\d{4}$/.test(word)) {
      namedYear = Number(word);
    } else if (/^\d{2}$/.test(word) && day !== null && namedYear === null) {
      namedYear = 2000 + Number(word);
    } else if (WEEKDAYS.has(word)) {
      continue;
    } else if (monthIndex(word) >= 0 && namedMonth < 0) {
      namedMonth = monthIndex(word);
    } else {
      return null;
    }
  }
  if (day === null || day < 1 || day > 31) return null;
  return namedMonth >= 0 ? dateKey(namedYear ?? year, namedMonth + 1, day) : dateKey(year, monthNumber, day);
}

// --- Reading a sheet -----------------------------------------------------------

export interface FileCell {
  date: string;
  /** The cell as written, for reporting. */
  raw: string;
  code: ShiftCode | 'blank' | null;
}

/** One person's row (or rows, in a sheet split into blocks). */
export interface FilePerson {
  /** Stable identity within the file: everything written beside the days, normalised. */
  key: string;
  /** How the file names them, e.g. "TRC-3 · Mercy Wanjiru". */
  label: string;
  /** Every text cell beside the days: any of them may be the code, name or email. */
  names: string[];
  /** The cells that are theirs alone: a role or a team repeated down the column is left out. */
  identity: string[];
  /** 1-based row in the sheet, for pointing at it. */
  row: number;
  cells: FileCell[];
}

export interface SheetReading {
  people: FilePerson[];
  /** The month's dates the sheet has a column for. */
  dates: string[];
  /** Months other than the one asked for that the headings name. */
  otherMonths: string[];
  /** The days ran down the side and the people across the top. */
  turned: boolean;
  /** Cells holding a recognised shift. */
  recognised: number;
  /** Cells a person's two rows disagree on, as readable lines. */
  conflicts: string[];
  /** Rows beside the days that were passed over because most of their cells are not shifts. */
  ignored: Array<{ label: string; samples: string[] }>;
}

interface Block {
  /** Column → date, for this block's day columns. */
  columns: Map<number, string>;
  firstColumn: number;
}

const MIN_HEADING_DAYS = 5;

function increasing(values: string[]): boolean {
  return values.every((value, i) => i === 0 || value > (values[i - 1] as string));
}

/** The day columns a row heads, or null when the row is not a row of day headings. */
function headingBlock(row: string[], month: string, earlier: Block | null, seen: ReadonlySet<string>, others: Set<string>): Block | null {
  const found: Array<[number, string]> = [];
  const elsewhere: string[] = [];
  let unreadable = 0;
  row.forEach((cell, column) => {
    if (!cell) return;
    const date = parseDayHeading(cell, month);
    if (date && monthOf(date) === month) found.push([column, date]);
    else if (date) elsewhere.push(date);
    else unreadable += 1;
  });
  // A row of dates from another month entirely: remembered, so the error can say which.
  if (found.length === 0 && elsewhere.length >= MIN_HEADING_DAYS && increasing(elsewhere)) {
    for (const date of elsewhere) others.add(monthOf(date));
  }
  const dates = found.map(([, date]) => date);
  if (found.length === 0 || !increasing(dates)) return null;
  const firstColumn = (found[0] as [number, string])[0];
  if (found.length < MIN_HEADING_DAYS) {
    // A short row of numbers is only a heading as the last block of a sheet split into
    // weeks (the 29th to the 31st): lined up under the block above, and bringing new days.
    // Otherwise it is a row of totals.
    const lastBlock = earlier !== null && found.length >= 2 && unreadable <= 2 && firstColumn === earlier.firstColumn && dates.some((date) => !seen.has(date));
    if (!lastBlock) return null;
  }
  return { columns: new Map(found), firstColumn };
}

function transpose(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return Array.from({ length: width }, (_, column) => rows.map((row) => row[column] ?? ''));
}

const personKey = (names: string[]) => names.join(' | ').toLowerCase().replace(/\s+/g, ' ').trim();

function shortDay(date: string): string {
  return `${Number(date.slice(8))} ${(MONTH_NAMES[Number(date.slice(5, 7)) - 1] as string).slice(0, 3).replace(/^./, (c) => c.toUpperCase())}`;
}

function readUpright(rows: string[][], month: string, rules: ShiftRules): Omit<SheetReading, 'turned'> {
  const people = new Map<string, FilePerson & { byDate: Map<string, FileCell> }>();
  const dates = new Set<string>();
  const otherMonths = new Set<string>();
  const clashes: Array<{ key: string; date: string; first: string; second: string }> = [];
  const ignored: SheetReading['ignored'] = [];
  let block: Block | null = null;
  let recognised = 0;

  rows.forEach((row, index) => {
    const heading = headingBlock(row, month, block, dates, otherMonths);
    if (heading) {
      block = heading;
      for (const date of heading.columns.values()) dates.add(date);
      return;
    }
    if (!block) return;
    const current: Block = block;

    // Who the row is for: the text beside the days. A bare number there is a row count, and
    // a date or a weekday is a heading, never a person.
    const names = row.slice(0, current.firstColumn).filter((cell) => cell && !/^\d+$/.test(cell) && !WEEKDAYS.has(cell.toLowerCase()) && parseDayHeading(cell, month) === null);
    if (names.length === 0) return;

    const label = names.join(' · ');
    const cells: FileCell[] = [];
    const unknown: string[] = [];
    let known = 0;
    for (const [column, date] of current.columns) {
      const raw = row[column] ?? '';
      const code = parseShiftCode(raw, rules);
      if (code === null) unknown.push(raw);
      else if (code !== 'blank') known += 1;
      cells.push({ date, raw, code });
    }
    // Totals, weekday letters, a legend: not a person unless most of what is written is a shift.
    if (known === 0 || unknown.length > known) {
      // A row of counts is a totals row; anything else is worth telling the person about.
      const words = unknown.filter((raw) => !/^[\d.,\s%]+$/.test(raw));
      if (words.length >= 3) ignored.push({ label, samples: [...new Set(words)].slice(0, 4) });
      return;
    }

    const key = personKey(names);
    let person = people.get(key);
    if (!person) {
      person = { key, label, names, identity: names, row: index + 1, cells: [], byDate: new Map() };
      people.set(key, person);
    }
    for (const cell of cells) {
      const earlier = person.byDate.get(cell.date);
      if (!earlier || earlier.code === 'blank') {
        if (!earlier) person.cells.push(cell);
        else person.cells[person.cells.indexOf(earlier)] = cell;
        person.byDate.set(cell.date, cell);
        if (cell.code !== null && cell.code !== 'blank') recognised += 1;
      } else if (cell.code !== 'blank' && cell.code !== earlier.code) {
        clashes.push({ key, date: cell.date, first: earlier.raw, second: cell.raw });
      }
    }
  });

  // "Controller" beside every name says nothing about who a row is: people are named by what is theirs alone.
  const shared = new Map<string, number>();
  for (const person of people.values()) for (const name of new Set(person.names.map((n) => n.toLowerCase()))) shared.set(name, (shared.get(name) ?? 0) + 1);
  const labels = new Map<string, string>();
  const read = [...people.values()].map((person): FilePerson => {
    const own = person.names.filter((name) => shared.get(name.toLowerCase()) === 1);
    const identity = own.length > 0 ? own : person.names;
    labels.set(person.key, identity.join(' · '));
    return {
      key: person.key,
      label: identity.join(' · '),
      names: person.names,
      identity,
      row: person.row,
      cells: [...person.cells].sort((a, b) => a.date.localeCompare(b.date)),
    };
  });

  return {
    people: read,
    dates: [...dates].sort(),
    otherMonths: [...otherMonths].sort(),
    recognised,
    conflicts: clashes.map((clash) => `${labels.get(clash.key)}, ${shortDay(clash.date)}: the file says both “${clash.first}” and “${clash.second}”. The first was used.`),
    ignored,
  };
}

/** Reads one sheet for a month. `people` is empty when it holds no roster for that month. */
export function readRosterSheet(rows: string[][], month: string, rules: ShiftRules): SheetReading {
  const upright = readUpright(rows, month, rules);
  // A row of another month's dates settles it: this is that month's roster, the right way up.
  if (upright.people.length > 0 || upright.otherMonths.length > 0) return { ...upright, turned: false };
  const turned = readUpright(transpose(rows), month, rules);
  if (turned.people.length > 0) return { ...turned, turned: true };
  return {
    ...upright,
    otherMonths: [...new Set([...upright.otherMonths, ...turned.otherMonths])].sort(),
    ignored: upright.ignored.length > 0 ? upright.ignored : turned.ignored,
    turned: false,
  };
}

export interface NamedSheet {
  name: string;
  hidden?: boolean;
  rows: string[][];
}

export interface WorkbookReading {
  /** The sheet that was read; null when no sheet holds a roster for the month. */
  sheet: string | null;
  /** Every sheet holding a roster for the month, for choosing between them. */
  sheets: string[];
  reading: SheetReading | null;
  /** Why nothing could be read, worded for the person. */
  error: string | null;
}

export function monthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${(MONTH_NAMES[m - 1] as string).replace(/^./, (c) => c.toUpperCase())} ${year}`;
}

/** True when a sheet's tab is named for the month ("November", "Nov 2026", "2026-11"). */
function namedFor(sheetName: string, month: string): boolean {
  const name = sheetName.toLowerCase();
  const [year, m] = month.split('-').map(Number) as [number, number];
  const monthName = MONTH_NAMES[m - 1] as string;
  if (name.includes(month)) return true;
  if (!name.includes(monthName.slice(0, 3))) return false;
  const otherYear = /\b(20\d{2})\b/.exec(name);
  return !otherYear || Number(otherYear[1]) === year;
}

/**
 * Picks the sheet to read: the one asked for, else the one named for the
 * month, else the one with the most shifts on it.
 */
export function readRosterWorkbook(sheets: NamedSheet[], month: string, rules: ShiftRules, wanted?: string | null): WorkbookReading {
  const readings = sheets.map((sheet) => ({ sheet, reading: readRosterSheet(sheet.rows, month, rules) }));
  const usable = readings.filter((r) => r.reading.people.length > 0);
  const names = usable.map((r) => r.sheet.name);

  if (usable.length === 0) {
    const others = [...new Set(readings.flatMap((r) => r.reading.otherMonths))];
    const unread = readings.flatMap((r) => r.reading.ignored);
    const samples = [...new Set(unread.flatMap((row) => row.samples))].slice(0, 5);
    const error =
      others.length > 0
        ? `This file looks like the roster for ${others.map(monthLabel).join(' and ')}, not ${monthLabel(month)}. Pick that month, or upload the ${monthLabel(month)} file.`
        : unread.length > 0
          ? `The day columns were found, but the cells are not shift codes this roster uses (for example ${samples.map((sample) => `“${sample}”`).join(', ')}). Use ${SHIFT_CODES.map((code) => `${code} for ${rules.codes[code].name}`).join(', ')}.`
          : `No roster was found in this file. It needs one row per person and one column per day of the month (headed 1 to ${Number(monthEnd(month).slice(8))}, or with dates), with a shift code in each cell.`;
    return { sheet: null, sheets: [], reading: null, error };
  }

  const score = (r: (typeof usable)[number]) => (namedFor(r.sheet.name, month) ? 1_000_000 : 0) + (r.sheet.hidden ? 0 : 100_000) + r.reading.recognised;
  const chosen = usable.find((r) => r.sheet.name === wanted) ?? [...usable].sort((a, b) => score(b) - score(a))[0];
  if (!chosen) return { sheet: null, sheets: names, reading: null, error: 'No roster was found in this file.' };
  return { sheet: chosen.sheet.name, sheets: names, reading: chosen.reading, error: null };
}

// --- Matching people -----------------------------------------------------------

/** A roster line as the matcher sees it. */
export interface ImportLine extends RosterLine {
  /** The linked account's name, else the display name, else the code. */
  name: string;
  displayName: string | null;
  email: string | null;
}

const words = (value: string) => value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const sortedWords = (value: string) => words(value).sort().join(' ');

/**
 * The roster line a file row is for, or null. Tried in order: the roster code,
 * the full name or email (in any word order), then a first or last name that
 * only one person on the roster has.
 */
export function matchLine(names: string[], lines: ImportLine[]): ImportLine | null {
  const live = lines.filter((line) => line.active);
  // First name and surname may sit in separate columns.
  const whole = names.length > 1 ? [...names, names.join(' ')] : names;
  for (const pool of [live, lines]) {
    for (const name of names) {
      const key = squash(name);
      if (!key) continue;
      const byCode = pool.find((line) => squash(line.code) === key);
      if (byCode) return byCode;
    }
    for (const name of whole) {
      const key = sortedWords(name);
      if (!key) continue;
      const byName = pool.find((line) => [line.name, line.displayName, line.email].some((value) => value && sortedWords(value) === key));
      if (byName) return byName;
    }
    for (const name of names) {
      const parts = words(name);
      if (parts.length !== 1 || (parts[0] as string).length < 3) continue;
      const sharing = pool.filter((line) => [line.name, line.displayName].some((value) => value && words(value).includes(parts[0] as string)));
      if (sharing.length === 1) return sharing[0] as ImportLine;
    }
  }
  return null;
}

/** The name to give someone the file adds: the cell that reads like a person's name. */
export function personName(names: string[]): string {
  const plain = names.filter((name) => !name.includes('@'));
  return (plain.find((name) => /\S\s+\S/.test(name)) ?? plain[0] ?? names[0] ?? '').slice(0, 80);
}

const CODE_LIKE = /^[A-Za-z]{1,10}[-_ ]?\d{1,4}$/;

/**
 * Roster codes for people the file adds. A cell that reads like a code
 * ("TRC-9") is kept; otherwise the numbering in use carries on ("TRC-6" after
 * "TRC-5").
 */
export function newLineCodes(existing: string[], people: string[][]): string[] {
  const used = new Set(existing.map((code) => code.toLowerCase()));
  const prefixes = new Map<string, number>();
  let highest = 0;
  for (const code of existing) {
    const match = /^(.*?)(\d+)$/.exec(code);
    if (!match) continue;
    prefixes.set(match[1] as string, (prefixes.get(match[1] as string) ?? 0) + 1);
  }
  const prefix = [...prefixes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'P-';
  for (const code of existing) {
    const match = /^(.*?)(\d+)$/.exec(code);
    if (match && match[1] === prefix) highest = Math.max(highest, Number(match[2]));
  }
  return people.map((names) => {
    const written = names.find((name) => CODE_LIKE.test(name) && name.length <= 20 && !used.has(name.toLowerCase()));
    let code = written;
    while (!code || used.has(code.toLowerCase())) {
      highest += 1;
      code = `${prefix}${highest}`;
    }
    used.add(code.toLowerCase());
    return code;
  });
}

// --- Planning ------------------------------------------------------------------

/** Where a file row goes: a roster line, a new person, or nowhere. */
export type ImportTarget = number | 'new' | 'skip';

export interface ImportOptions {
  /** An empty cell rosters the person Off, instead of leaving the day as it is. */
  blankAsOff: boolean;
  /** Choices made in the preview, by `FilePerson.key`; anyone absent is matched automatically. */
  mapping: Record<string, ImportTarget>;
}

/** A saved record, as far as planning needs it. */
export interface ExistingCell {
  id: number;
  planned: ShiftCode;
  generated: ShiftCode;
  /** Worked, sick, no-show or called in: the plan is history and is left alone. */
  locked: boolean;
  cell: RosterCell;
}

export interface PlannedShift {
  date: string;
  code: ShiftCode;
  /** The record to change; null to create one. */
  recordId: number | null;
  /** What the rotation gives that day, for a new record. */
  generated: ShiftCode;
}

export interface PlannedPerson {
  key: string;
  label: string;
  row: number;
  target: ImportTarget;
  /** True when the match was found from the file, not chosen in the preview. */
  matched: boolean;
  /** The line's code and name when the target is a line. */
  lineCode: string | null;
  lineName: string | null;
  /** The line it matched has been made inactive. */
  inactive: boolean;
  shifts: PlannedShift[];
  /** Days already rostered as the file has them. */
  unchanged: number;
  /** Empty cells left as they are. */
  blank: number;
  /** Days with recorded actuals that the file disagrees with. */
  locked: number;
  /** Days before the person's start date or after their end date. */
  outside: number;
  /** Cells that are not a shift code. */
  unreadable: number;
}

export interface ImportPlan {
  people: PlannedPerson[];
  /** Readable lines about cells and rows that were not used, capped. */
  notes: string[];
  /** Notes beyond the cap. */
  moreNotes: number;
}

const MAX_NOTES = 40;

export function planRosterImport(input: {
  month: string;
  rules: ShiftRules;
  reading: SheetReading;
  lines: ImportLine[];
  /** Saved records of the month, by `${lineId}|${date}`. */
  existing: ReadonlyMap<string, ExistingCell>;
  options: ImportOptions;
}): ImportPlan {
  const { rules, reading, lines, existing, options } = input;
  const lineById = new Map(lines.map((line) => [line.id, line]));
  const notes: string[] = [
    ...reading.ignored.map((row) => `The row “${row.label}” was not read: its cells (${row.samples.map((sample) => `“${sample}”`).join(', ')}) are not shift codes.`),
    ...reading.conflicts,
  ];
  /** Days a line has already been given by an earlier row of the file. */
  const taken = new Set<string>();

  const people = reading.people.map((person): PlannedPerson => {
    const chosen = options.mapping[person.key];
    const auto = matchLine(person.names, lines);
    let target: ImportTarget = chosen ?? auto?.id ?? 'new';
    if (typeof target === 'number' && !lineById.has(target)) target = auto?.id ?? 'new';
    const line = typeof target === 'number' ? (lineById.get(target) as ImportLine) : null;

    const planned: PlannedPerson = {
      key: person.key,
      label: person.label,
      row: person.row,
      target,
      matched: chosen === undefined && auto !== null,
      lineCode: line?.code ?? null,
      lineName: line?.name ?? null,
      inactive: line ? !line.active : false,
      shifts: [],
      unchanged: 0,
      blank: 0,
      locked: 0,
      outside: 0,
      unreadable: 0,
    };
    if (target === 'skip') return planned;

    for (const cell of person.cells) {
      if (cell.code === null) {
        planned.unreadable += 1;
        notes.push(`${person.label}, ${shortDay(cell.date)}: “${cell.raw}” is not a shift code, so that day was left as it is.`);
        continue;
      }
      let code: ShiftCode;
      if (cell.code === 'blank') {
        if (!options.blankAsOff) {
          planned.blank += 1;
          continue;
        }
        code = 'X';
      } else {
        code = cell.code;
      }

      if (!line) {
        planned.shifts.push({ date: cell.date, code, recordId: null, generated: code });
        continue;
      }
      const key = `${line.id}|${cell.date}`;
      if (taken.has(key)) {
        notes.push(`${person.label}, ${shortDay(cell.date)}: ${line.code} already has this day from another row of the file.`);
        continue;
      }
      const saved = existing.get(key);
      if (!saved && !lineOnRoster({ ...line, active: true }, cell.date)) {
        planned.outside += 1;
        continue;
      }
      if (saved?.planned === code) {
        planned.unchanged += 1;
      } else if (saved?.locked) {
        planned.locked += 1;
        notes.push(`${person.label}, ${shortDay(cell.date)}: already recorded as worked, sick or called in on ${rules.codes[saved.planned].name}, so “${cell.raw || 'blank'}” was not applied.`);
      } else {
        planned.shifts.push({
          date: cell.date,
          code,
          recordId: saved?.id ?? null,
          generated: saved?.generated ?? (line.cycleOffset !== null ? generatedCode(rules, line.cycleOffset, cell.date) : code),
        });
      }
      taken.add(key);
    }
    if (planned.outside > 0 && line) {
      notes.push(`${person.label}: ${planned.outside} day${planned.outside === 1 ? ' is' : 's are'} before ${line.code}'s start date or after their end date, and ${planned.outside === 1 ? 'was' : 'were'} skipped.`);
    }
    return planned;
  });

  return { people, notes: notes.slice(0, MAX_NOTES), moreNotes: Math.max(0, notes.length - MAX_NOTES) };
}

// --- What the rules make of the result ----------------------------------------

export interface ImportChecks {
  /** Every blocking problem and warning the month would have afterwards. */
  blocks: Violation[];
  warnings: Violation[];
  /** The blocking problems the upload itself introduces. */
  newBlocks: Violation[];
}

/**
 * Runs the roster rules over the month as it would be after the upload. New
 * people have no id yet, so they stand in under negative ones.
 */
export function checkImport(input: {
  month: string;
  rules: ShiftRules;
  plan: ImportPlan;
  lines: ImportLine[];
  /** Saved records for the month and the rule windows either side. */
  lookup: CellLookup;
  /** Months that already have records. */
  generatedMonths: string[];
  /** `${lineId}|${date}` of rostered shifts that approved leave will turn into Leave. */
  onLeave?: ReadonlySet<string>;
}): ImportChecks {
  const { month, rules, plan, lines, lookup } = input;
  const from = monthStart(month);
  const to = monthEnd(month);
  const before = new Set(input.generatedMonths);
  const after = new Set([...input.generatedMonths, month]);

  const overlay = new Map<string, RosterCell>();
  const everyone: RosterLine[] = [...lines];
  let stand = 0;
  for (const person of plan.people) {
    if (person.target === 'skip') continue;
    let lineId: number;
    if (person.target === 'new') {
      stand -= 1;
      lineId = stand;
      everyone.push({ id: lineId, code: person.label, cycleOffset: null, startDate: null, endDate: null, active: true });
    } else {
      lineId = person.target;
    }
    for (const shift of person.shifts) {
      const key = `${lineId}|${shift.date}`;
      const code = input.onLeave?.has(key) && CODE_KIND[shift.code] === 'console' ? 'LV' : shift.code;
      const saved = lookup(lineId, shift.date);
      overlay.set(key, {
        generated: saved?.generated ?? shift.generated,
        planned: code,
        worked: null,
        status: code === 'LV' ? 'leave' : 'planned',
        hours: null,
        start: null,
        end: null,
      });
    }
  }

  const was = validateRoster(rules, lines, lookup, from, to, (date) => before.has(monthOf(date)));
  const now = validateRoster(rules, everyone, (lineId, date) => overlay.get(`${lineId}|${date}`) ?? lookup(lineId, date), from, to, (date) => after.has(monthOf(date)));
  return {
    blocks: now.filter((v) => v.severity === 'block'),
    warnings: now.filter((v) => v.severity === 'warn'),
    newBlocks: newViolations(was, now).filter((v) => v.severity === 'block'),
  };
}

// --- What the dialog is shown --------------------------------------------------

export interface ImportPersonView {
  key: string;
  label: string;
  row: number;
  target: ImportTarget;
  matched: boolean;
  lineCode: string | null;
  lineName: string | null;
  inactive: boolean;
  /** For a new person: the login account they will be linked to, when one has their name. */
  account: string | null;
  /** Shifts the upload will put on the roster. */
  set: number;
  unchanged: number;
  blank: number;
  locked: number;
  outside: number;
  unreadable: number;
}

export interface ImportPreview {
  month: string;
  monthStatus: MonthStatus;
  fileName: string;
  sheet: string;
  /** Other sheets of the workbook that also hold a roster for the month. */
  sheets: string[];
  /** Day columns found, of the days in the month. */
  days: number;
  daysInMonth: number;
  /** The days ran down the side of the sheet. */
  turned: boolean;
  people: ImportPersonView[];
  totals: { set: number; unchanged: number; blank: number; locked: number; outside: number; unreadable: number; newPeople: number };
  /** People on the roster the file does not mention; their month is left alone. */
  notInFile: string[];
  /** Rostered shifts that fall on approved leave and will show as Leave. */
  onLeave: number;
  notes: string[];
  moreNotes: number;
  blocks: Violation[];
  warnings: Violation[];
  moreBlocks: number;
  moreWarnings: number;
  /** A published month is changing in a way that breaks a rule: a reason is needed. */
  needsReason: boolean;
  newBlocks: number;
}

/** What comes back from an upload: the preview, and whether it was saved. */
export interface ImportResult {
  applied: boolean;
  preview: ImportPreview;
  /** One line saying what was done, when it was. */
  summary: string | null;
}

/** The roster as a table to download, edit in Excel and upload again. */
export function rosterTemplate(input: {
  month: string;
  lines: Array<Pick<ImportLine, 'id' | 'code' | 'name'>>;
  codeAt: (lineId: number, date: string) => ShiftCode | null;
}): string[][] {
  const dates = monthDates(input.month);
  return [
    ['Code', 'Name', ...dates.map((date) => String(Number(date.slice(8))))],
    ...input.lines.map((line) => [line.code, line.name === line.code ? '' : line.name, ...dates.map((date) => input.codeAt(line.id, date) ?? '')]),
  ];
}
