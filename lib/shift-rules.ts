/**
 * Shift roster rules: the rotation, the duty maths and every validation.
 *
 * Deliberately NOT `server-only`, and free of Prisma: the server saves through
 * these functions, the admin grid runs the same ones live while a scheduler
 * drafts changes, and the tests exercise them without a database.
 *
 * Dates are 'YYYY-MM-DD' strings and times 'HH:MM' wall-clock in the roster's
 * time zone. A night shift is dated on the day it starts and its hours are
 * booked to that date.
 */

import { APP_LOCALE } from './locale';

// --- Codes -------------------------------------------------------------------

export const SHIFT_CODES = ['D', 'S', 'N', 'W', 'OC', 'X', 'LV'] as const;
export type ShiftCode = (typeof SHIFT_CODES)[number];

/**
 * What a code means to the rules; the names and times are configuration.
 * `duty` is a working day away from the console (an office day, a detail,
 * training): its hours count, but it covers no console shift.
 */
export type ShiftKind = 'console' | 'duty' | 'on_call' | 'off' | 'leave';

export const CODE_KIND: Record<ShiftCode, ShiftKind> = {
  D: 'console',
  S: 'console',
  N: 'console',
  W: 'duty',
  OC: 'on_call',
  X: 'off',
  LV: 'leave',
};

export const CONSOLE_CODES: readonly ShiftCode[] = ['D', 'S', 'N'];

export function isShiftCode(value: unknown): value is ShiftCode {
  return typeof value === 'string' && (SHIFT_CODES as readonly string[]).includes(value);
}

export function isConsole(code: ShiftCode): boolean {
  return CODE_KIND[code] === 'console';
}

/** A day of work: a console shift or another duty. Its hours count and it needs rest around it. */
export function isWorking(code: ShiftCode): boolean {
  return CODE_KIND[code] === 'console' || CODE_KIND[code] === 'duty';
}

export const RECORD_STATUSES = ['planned', 'worked', 'sick', 'leave', 'swapped', 'call-in', 'no-show'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export function isRecordStatus(value: unknown): value is RecordStatus {
  return typeof value === 'string' && (RECORD_STATUSES as readonly string[]).includes(value);
}

/** Rostered but not there: the plan stands, the shift was not worked. */
export function isAbsent(status: RecordStatus): boolean {
  return status === 'sick' || status === 'no-show';
}

export const CALL_IN_TRIGGERS = ['absence', 'task_load', 'incident', 'event'] as const;
export type CallInTrigger = (typeof CALL_IN_TRIGGERS)[number];

export const TRIGGER_LABEL: Record<CallInTrigger, string> = {
  absence: 'Absence',
  task_load: 'Task load',
  incident: 'Incident',
  event: 'Event',
};

export const LEAVE_TYPES = ['annual', 'sick', 'other'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LINE_ROLES = ['line', 'hybrid', 'fallback'] as const;
export type LineRole = (typeof LINE_ROLES)[number];

// --- Configuration -----------------------------------------------------------

export interface ShiftCodeDef {
  name: string;
  /** 'HH:MM', console codes only. An end at or before the start is the next day. */
  start: string | null;
  end: string | null;
  hours: number;
}

/**
 * A code of the roster's own, written on it as-is ("SOC-D", "INT"). The rules
 * treat it as the built-in code it counts as; it may keep its own hours.
 */
export interface ExtraCode {
  /** As it is written on the roster. */
  code: string;
  name: string;
  /** The built-in code it counts as. */
  as: ShiftCode;
  /** Its own times and hours, for a working code; null takes them from the code it counts as. */
  start: string | null;
  end: string | null;
  hours: number | null;
}

export const MAX_EXTRA_CODES = 30;
export const EXTRA_CODE_LENGTH = 8;

/** What a roster's own code may look like: a short word, e.g. "SOC-D", "WT", "A/L". */
export function isCodeLike(value: string): boolean {
  return value.length <= EXTRA_CODE_LENGTH && /^[A-Za-z][A-Za-z0-9+/_-]*$/.test(value);
}

export interface ShiftRules {
  timeZone: string;
  /** The date on which a line with offset 0 is on cycle day 1. */
  rotationStart: string;
  pattern: ShiftCode[];
  codes: Record<ShiftCode, ShiftCodeDef>;
  /** The roster's own codes, beside the built-in ones. */
  extra: ExtraCode[];
  targetHours7d: number;
  maxHours7d: number;
  maxHours14d: number;
  minRestHours: number;
  maxConsecutiveDuties: number;
  leaveCapDays: number;
  responseMinutes: number;
  publishLeadDays: number;
  /** ISO weekday the payroll week starts on: 1 = Monday … 7 = Sunday. */
  weekStart: number;
}

/** The December 2026 framework sample: 8-hour shifts on a 10-day rotation. */
export const DEFAULT_RULES: ShiftRules = {
  timeZone: 'Africa/Nairobi',
  rotationStart: '2026-12-01',
  pattern: ['D', 'D', 'S', 'S', 'N', 'N', 'X', 'OC', 'OC', 'X'],
  codes: {
    D: { name: 'Day', start: '07:00', end: '15:00', hours: 8 },
    S: { name: 'Swing', start: '15:00', end: '23:00', hours: 8 },
    N: { name: 'Night', start: '23:00', end: '07:00', hours: 8 },
    W: { name: 'Duty', start: '08:00', end: '17:00', hours: 8 },
    OC: { name: 'On call', start: null, end: null, hours: 0 },
    X: { name: 'Off', start: null, end: null, hours: 0 },
    LV: { name: 'Leave', start: null, end: null, hours: 0 },
  },
  extra: [],
  targetHours7d: 48,
  maxHours7d: 52,
  maxHours14d: 116,
  minRestHours: 11,
  maxConsecutiveDuties: 6,
  leaveCapDays: 14,
  responseMinutes: 60,
  publishLeadDays: 14,
  weekStart: 1,
};

// --- The roster's own codes --------------------------------------------------

/** The roster's own code that `written` is, or null for a built-in code or one nobody knows. */
export function extraOf(rules: ShiftRules, written: string | null | undefined): ExtraCode | null {
  if (!written) return null;
  return rules.extra.find((extra) => extra.code === written) ?? null;
}

/** The built-in code a written code counts as; null when the roster does not know it. */
export function baseOf(rules: ShiftRules, written: unknown): ShiftCode | null {
  if (isShiftCode(written)) return written;
  return typeof written === 'string' ? (extraOf(rules, written)?.as ?? null) : null;
}

/** True for anything that may be written on the roster: a built-in code or one of its own. */
export function isRosterCode(rules: ShiftRules, value: unknown): value is string {
  return baseOf(rules, value) !== null;
}

/**
 * Name, times and hours for a shift: the built-in code's, or those of the
 * roster's own code it is written as. A label that does not belong to `code`
 * (a draft has moved the day on) is ignored.
 */
export function codeDef(rules: ShiftRules, code: ShiftCode, label?: string | null): ShiftCodeDef {
  const base = rules.codes[code];
  const extra = extraOf(rules, label);
  if (!extra || extra.as !== code) return base;
  if (!isWorking(code)) return { name: extra.name, start: null, end: null, hours: 0 };
  const start = extra.start ?? base.start;
  const end = extra.end ?? base.end;
  return { name: extra.name, start, end, hours: extra.hours ?? (extra.start && extra.end ? spanHours(extra.start, extra.end) : base.hours) };
}

/** Every code that can be written on the roster, built-in first. */
export function rosterCodes(rules: ShiftRules): Array<{ code: string; base: ShiftCode; name: string }> {
  return [
    ...SHIFT_CODES.map((code) => ({ code: code as string, base: code, name: rules.codes[code].name })),
    ...rules.extra.map((extra) => ({ code: extra.code, base: extra.as, name: extra.name })),
  ];
}

/** As written in the database: every code whose built-in code passes `test`. */
export function writtenCodes(rules: ShiftRules, test: (base: ShiftCode) => boolean): string[] {
  return rosterCodes(rules).filter((entry) => test(entry.base)).map((entry) => entry.code);
}

// --- Dates and times ---------------------------------------------------------

const DAY_MS = 86_400_000;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** 24-hour 'HH:MM'. */
export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Whole days since the epoch; the unit every window below counts in. */
export function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

export function dateOfDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return dateOfDay(dayNumber(date) + days);
}

/** `a - b` in days. */
export function diffDays(a: string, b: string): number {
  return dayNumber(a) - dayNumber(b);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
}

export function addMonths(month: string, count: number): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, m - 1 + count, 1)).toISOString().slice(0, 7);
}

/** Every date from `from` to `to`, inclusive. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let day = dayNumber(from), last = dayNumber(to); day <= last; day += 1) out.push(dateOfDay(day));
  return out;
}

export function monthDates(month: string): string[] {
  return datesBetween(monthStart(month), monthEnd(month));
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Hours between two 'HH:MM' times, treating an end at or before the start as the next day. */
export function spanHours(start: string, end: string): number {
  let minutes = minutesOf(end) - minutesOf(start);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
}

/** The roster's wall clock at `nowMs`: today's date key and minutes since midnight. */
export function zonedNow(timeZone: string, nowMs: number): { date: string; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(nowMs));
  } catch {
    const iso = new Date(nowMs).toISOString();
    return { date: iso.slice(0, 10), minutes: minutesOf(iso.slice(11, 16)) };
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: (Number(get('hour')) % 24) * 60 + Number(get('minute')),
  };
}

// --- The incoming shift ------------------------------------------------------

/** A handover written this long after a shift change still goes to the shift that just came on. */
export const HANDOVER_GRACE_MINUTES = 120;

export interface IncomingShift {
  /** The roster date the shift starts on. */
  date: string;
  code: ShiftCode;
  /** "Day", "Swing", "Night". */
  name: string;
  /** 'HH:MM' on the roster's clock. */
  start: string;
}

/**
 * The console shift a handover written now is for: the next one to start, or
 * the one that started within the last HANDOVER_GRACE_MINUTES, since the
 * outgoing shift often writes up just after the change. Null when no console
 * shift has a start time.
 */
export function incomingShift(rules: ShiftRules, nowMs: number): IncomingShift | null {
  const now = zonedNow(rules.timeZone, nowMs);
  const cutoff = dayNumber(now.date) * 1440 + now.minutes - HANDOVER_GRACE_MINUTES;
  let best: (IncomingShift & { at: number }) | null = null;
  for (const offset of [-1, 0, 1]) {
    const date = addDays(now.date, offset);
    for (const code of CONSOLE_CODES) {
      const def = rules.codes[code];
      if (!def?.start) continue;
      const at = dayNumber(date) * 1440 + minutesOf(def.start);
      if (at < cutoff || (best && best.at <= at)) continue;
      best = { date, code, name: def.name, start: def.start, at };
    }
  }
  return best ? { date: best.date, code: best.code, name: best.name, start: best.start } : null;
}

// --- Rotation ----------------------------------------------------------------

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}

/** Zero-based position in the pattern for a line on a date. */
export function cycleIndex(rules: ShiftRules, offset: number, date: string): number {
  return mod(diffDays(date, rules.rotationStart) + offset, rules.pattern.length);
}

/**
 * code(line, date) = pattern[((date − rotation_start) + offset) mod length].
 * Continuous across month boundaries: a new month carries on, it never restarts.
 */
export function generatedCode(rules: ShiftRules, offset: number, date: string): ShiftCode {
  return rules.pattern[cycleIndex(rules, offset, date)] ?? 'X';
}

/** Which whole cycle a date falls in, counted from the rotation start. */
export function cycleNumber(rules: ShiftRules, date: string): number {
  return Math.floor(diffDays(date, rules.rotationStart) / rules.pattern.length);
}

export function cycleRange(rules: ShiftRules, date: string): { from: string; to: string } {
  const from = addDays(rules.rotationStart, cycleNumber(rules, date) * rules.pattern.length);
  return { from, to: addDays(from, rules.pattern.length - 1) };
}

// --- Lines and cells ---------------------------------------------------------

export interface RosterLine {
  id: number;
  code: string;
  /** Null keeps the line out of the generated rotation. */
  cycleOffset: number | null;
  startDate: string | null;
  endDate: string | null;
  active: boolean;
}

export function lineOnRoster(line: RosterLine, date: string): boolean {
  if (!line.active) return false;
  if (line.startDate && date < line.startDate) return false;
  if (line.endDate && date > line.endDate) return false;
  return true;
}

/** One line on one date, as the rules see it. */
export interface RosterCell {
  generated: ShiftCode;
  planned: ShiftCode;
  /** Set by a call-in: the shift actually covered. */
  worked: ShiftCode | null;
  status: RecordStatus;
  /** Actual hours and times, when recorded. */
  hours: number | null;
  start: string | null;
  end: string | null;
  /** The roster's own code the plan is written as ("SOC-D"), when it is one. */
  label?: string | null;
}

/** Saved records only; null where nothing is stored for that line and date. */
export type CellLookup = (lineId: number, date: string) => RosterCell | null;

export function patternCell(rules: ShiftRules, offset: number, date: string): RosterCell {
  const code = generatedCode(rules, offset, date);
  return { generated: code, planned: code, worked: null, status: 'planned', hours: null, start: null, end: null };
}

/** True for dates inside a month whose records exist; see `resolveCell`. */
export type GeneratedCheck = (date: string) => boolean;

/**
 * The saved record, or what the rotation will produce where none exists yet.
 * The fallback lets a window that reaches into an ungenerated month still be
 * checked: the rotation is continuous, so the answer is already known. Inside
 * a generated month there is no fallback: no record means not rostered.
 */
export function resolveCell(
  rules: ShiftRules,
  line: RosterLine,
  date: string,
  lookup: CellLookup,
  generated?: GeneratedCheck,
): RosterCell | null {
  const saved = lookup(line.id, date);
  if (saved) return saved;
  if (generated?.(date)) return null;
  if (line.cycleOffset === null || !lineOnRoster(line, date)) return null;
  return patternCell(rules, line.cycleOffset, date);
}

// --- Duties ------------------------------------------------------------------

/** A stretch of work, in minutes on one continuous timeline. */
export interface Duty {
  code: ShiftCode;
  date: string;
  start: number;
  end: number;
  hours: number;
  calledIn: boolean;
}

/** The work a cell represents, or null for on call, rest, leave and absence. */
export function dutyOf(rules: ShiftRules, cell: RosterCell | null, date: string): Duty | null {
  if (!cell || isAbsent(cell.status)) return null;
  const code = cell.worked ?? cell.planned;
  if (!isWorking(code)) return null;
  // A call-in is worked as the built-in shift it covered, whatever the day was written as.
  const def = codeDef(rules, code, cell.worked ? null : cell.label);
  const startTime = cell.start ?? def.start ?? '00:00';
  const endTime = cell.end ?? def.end ?? startTime;
  const startMinutes = minutesOf(startTime);
  let endMinutes = minutesOf(endTime);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const base = dayNumber(date) * 24 * 60;
  const hours = cell.hours ?? (cell.start && cell.end ? spanHours(cell.start, cell.end) : def.hours);
  return {
    code,
    date,
    start: base + startMinutes,
    end: base + endMinutes,
    hours,
    calledIn: cell.worked !== null && cell.worked !== cell.planned,
  };
}

/** A full day off: rostered rest or leave, and not called in. */
export function isRestDay(cell: RosterCell | null): boolean {
  if (!cell) return true;
  if (cell.worked !== null) return false;
  const kind = CODE_KIND[cell.planned];
  return kind === 'off' || kind === 'leave';
}

// --- Validation --------------------------------------------------------------

export type RuleId =
  | 'coverage_gap'
  | 'coverage_double'
  | 'no_on_call'
  | 'rest'
  | 'weekly_max'
  | 'weekly_target'
  | 'fortnight'
  | 'weekly_rest'
  | 'consecutive';

export type Severity = 'block' | 'warn';

export const RULE_LABEL: Record<RuleId, string> = {
  coverage_gap: 'Coverage gap',
  coverage_double: 'Double cover',
  no_on_call: 'No one on call',
  rest: 'Rest between duties',
  weekly_max: 'Weekly hours limit',
  weekly_target: 'Weekly hours target',
  fortnight: 'Two-week hours',
  weekly_rest: 'Weekly rest day',
  consecutive: 'Consecutive duties',
};

export interface Violation {
  /** Stable identity, so a save can tell a new problem from one already there. */
  key: string;
  rule: RuleId;
  severity: Severity;
  date: string;
  lineId: number | null;
  lineCode: string | null;
  message: string;
}

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(APP_LOCALE, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/**
 * Every rule, for dates `from`..`to` inclusive. Windows reach back before
 * `from` through `lookup` (and the rotation, where nothing is saved yet).
 */
export function validateRoster(
  rules: ShiftRules,
  lines: RosterLine[],
  lookup: CellLookup,
  from: string,
  to: string,
  generated?: GeneratedCheck,
): Violation[] {
  const out: Violation[] = [];
  const dates = datesBetween(from, to);
  const needed = CONSOLE_CODES.filter((code) => rules.pattern.includes(code));
  const expectsOnCall = rules.pattern.includes('OC');

  // Coverage: exactly one person on each console shift, and someone on call.
  for (const date of dates) {
    const cells = lines
      .map((line) => resolveCell(rules, line, date, lookup, generated))
      .filter((cell): cell is RosterCell => cell !== null);
    if (cells.length === 0) continue;

    for (const code of needed) {
      const planned = cells.filter((c) => c.planned === code && !isAbsent(c.status)).length;
      const calledIn = cells.filter((c) => c.worked === code && c.planned !== code).length;
      const name = `${rules.codes[code].name} (${code})`;
      if (planned + calledIn === 0) {
        out.push({
          key: `coverage_gap|${date}|${code}`,
          rule: 'coverage_gap',
          severity: 'block',
          date,
          lineId: null,
          lineCode: null,
          message: `No one on ${name} on ${shortDate(date)}.`,
        });
      } else if (planned >= 2) {
        out.push({
          key: `coverage_double|${date}|${code}`,
          rule: 'coverage_double',
          severity: 'block',
          date,
          lineId: null,
          lineCode: null,
          message: `${planned} people on ${name} on ${shortDate(date)}; there should be one.`,
        });
      }
    }

    if (expectsOnCall && !cells.some((c) => c.planned === 'OC')) {
      out.push({
        key: `no_on_call|${date}`,
        rule: 'no_on_call',
        severity: 'warn',
        date,
        lineId: null,
        lineCode: null,
        message: `No one on call on ${shortDate(date)}.`,
      });
    }
  }

  // Per person: rest, hours and days off. Thirteen days back covers the widest window.
  const LOOKBACK = 13;
  const firstDay = dayNumber(from) - LOOKBACK;
  const span = dates.length + LOOKBACK;

  for (const line of lines) {
    const cells: Array<RosterCell | null> = [];
    const duties: Array<Duty | null> = [];
    for (let i = 0; i < span; i += 1) {
      const date = dateOfDay(firstDay + i);
      const cell = resolveCell(rules, line, date, lookup, generated);
      cells.push(cell);
      duties.push(dutyOf(rules, cell, date));
    }
    if (!duties.some(Boolean) && !cells.some(Boolean)) continue;

    const hoursOver = (endIndex: number, days: number) => {
      let total = 0;
      for (let i = Math.max(0, endIndex - days + 1); i <= endIndex; i += 1) total += duties[i]?.hours ?? 0;
      return total;
    };

    let previous: Duty | null = null;
    let run = 0;
    for (let i = 0; i < span; i += 1) {
      const date = dateOfDay(firstDay + i);
      const inRange = i >= LOOKBACK;
      const duty = duties[i] ?? null;
      run = duty ? run + 1 : 0;

      if (duty) {
        if (inRange && previous) {
          const rest = (duty.start - previous.end) / 60;
          if (rest < rules.minRestHours) {
            out.push({
              key: `rest|${line.id}|${date}`,
              rule: 'rest',
              severity: 'block',
              date,
              lineId: line.id,
              lineCode: line.code,
              message: `${line.code} has ${formatHours(Math.max(0, rest))} h rest before ${rules.codes[duty.code].name} on ${shortDate(date)}; the minimum is ${rules.minRestHours} h.`,
            });
          }
        }
        previous = duty;

        // A window peaks on a day that is worked, so only those ends are reported.
        if (inRange) {
          const week = hoursOver(i, 7);
          if (week > rules.maxHours7d) {
            out.push({
              key: `weekly_max|${line.id}|${date}`,
              rule: 'weekly_max',
              severity: 'block',
              date,
              lineId: line.id,
              lineCode: line.code,
              message: `${line.code} reaches ${formatHours(week)} h in the 7 days to ${shortDate(date)}; the limit is ${rules.maxHours7d} h.`,
            });
          } else if (week > rules.targetHours7d) {
            out.push({
              key: `weekly_target|${line.id}|${date}`,
              rule: 'weekly_target',
              severity: 'warn',
              date,
              lineId: line.id,
              lineCode: line.code,
              message: `${line.code} reaches ${formatHours(week)} h in the 7 days to ${shortDate(date)}; the target is ${rules.targetHours7d} h.`,
            });
          }

          const fortnight = hoursOver(i, 14);
          if (fortnight > rules.maxHours14d) {
            out.push({
              key: `fortnight|${line.id}|${date}`,
              rule: 'fortnight',
              severity: 'warn',
              date,
              lineId: line.id,
              lineCode: line.code,
              message: `${line.code} reaches ${formatHours(fortnight)} h in the 14 days to ${shortDate(date)}; the cap is ${rules.maxHours14d} h.`,
            });
          }

          if (run > rules.maxConsecutiveDuties) {
            out.push({
              key: `consecutive|${line.id}|${date}`,
              rule: 'consecutive',
              severity: 'warn',
              date,
              lineId: line.id,
              lineCode: line.code,
              message: `${line.code} is on duty ${run} days running by ${shortDate(date)}; more than ${rules.maxConsecutiveDuties} needs a look.`,
            });
          }
        }
      }

      // One full day off in every seven. Needs a whole window of known days.
      if (inRange && i >= 6) {
        let rested = false;
        for (let j = i - 6; j <= i; j += 1) {
          if (isRestDay(cells[j] ?? null)) {
            rested = true;
            break;
          }
        }
        if (!rested) {
          out.push({
            key: `weekly_rest|${line.id}|${date}`,
            rule: 'weekly_rest',
            severity: 'block',
            date,
            lineId: line.id,
            lineCode: line.code,
            message: `${line.code} has no full day off in the 7 days to ${shortDate(date)}.`,
          });
        }
      }
    }
  }

  return out;
}

/** Problems in `after` that were not already in `before`. */
export function newViolations(before: Violation[], after: Violation[]): Violation[] {
  const known = new Set(before.map((v) => v.key));
  return after.filter((v) => !known.has(v.key));
}

// --- Totals ------------------------------------------------------------------

export interface LineTotals {
  codes: Record<ShiftCode, number>;
  /** Days of work on the roster (console shifts and other duties), including call-ins. */
  shifts: number;
  hours: number;
  callIns: number;
  nights: number;
  weekendShifts: number;
  holidayShifts: number;
}

export function emptyTotals(): LineTotals {
  return {
    codes: { D: 0, S: 0, N: 0, W: 0, OC: 0, X: 0, LV: 0 },
    shifts: 0,
    hours: 0,
    callIns: 0,
    nights: 0,
    weekendShifts: 0,
    holidayShifts: 0,
  };
}

/** The per-person row under the roster: a count of each code, shifts and hours. */
export function lineTotals(
  rules: ShiftRules,
  cells: Array<{ date: string; cell: RosterCell | null }>,
  holidays: ReadonlySet<string>,
): LineTotals {
  const totals = emptyTotals();
  for (const { date, cell } of cells) {
    if (!cell) continue;
    totals.codes[cell.planned] += 1;
    const duty = dutyOf(rules, cell, date);
    if (!duty) continue;
    totals.shifts += 1;
    totals.hours += duty.hours;
    if (duty.calledIn) totals.callIns += 1;
    if (duty.code === 'N') totals.nights += 1;
    if (isoWeekday(date) >= 6) totals.weekendShifts += 1;
    if (holidays.has(date)) totals.holidayShifts += 1;
  }
  return totals;
}

// --- Payroll -----------------------------------------------------------------

export interface PayrollTotals {
  plannedHours: number;
  /** Confirmed as worked, call-ins included. */
  workedHours: number;
  callInHours: number;
  /** Above the weekly limit: paid at 1.5x. */
  overtimeHours: number;
  /** Worked on a public holiday: paid at 2x. */
  holidayHours: number;
  /** Worked on a rostered rest day: paid at 2x. */
  restDayHours: number;
  /** Past shifts nobody has confirmed as worked yet. */
  unconfirmed: number;
  sickDays: number;
  noShows: number;
}

/** The first day of the payroll week containing `date`. */
export function weekStartOf(rules: ShiftRules, date: string): string {
  return addDays(date, -mod(isoWeekday(date) - rules.weekStart, 7));
}

/**
 * Hours for payroll over `from`..`to`. These are flags, never blocks: overtime
 * and premium days are paid, not prevented. A week's overtime is counted in the
 * period that contains the week's last day.
 */
export function payrollTotals(
  rules: ShiftRules,
  line: RosterLine,
  lookup: CellLookup,
  from: string,
  to: string,
  holidays: ReadonlySet<string>,
  today: string,
): PayrollTotals {
  const totals: PayrollTotals = {
    plannedHours: 0,
    workedHours: 0,
    callInHours: 0,
    overtimeHours: 0,
    holidayHours: 0,
    restDayHours: 0,
    unconfirmed: 0,
    sickDays: 0,
    noShows: 0,
  };
  const workedOn = (date: string): number => {
    const cell = lookup(line.id, date);
    if (!cell || (cell.status !== 'worked' && cell.status !== 'call-in')) return 0;
    return dutyOf(rules, cell, date)?.hours ?? 0;
  };

  for (const date of datesBetween(from, to)) {
    const cell = lookup(line.id, date);
    if (!cell) continue;
    if (isWorking(cell.planned)) totals.plannedHours += codeDef(rules, cell.planned, cell.label).hours;
    if (cell.status === 'sick') totals.sickDays += 1;
    if (cell.status === 'no-show') totals.noShows += 1;
    if (cell.status === 'planned' && isWorking(cell.planned) && date < today) totals.unconfirmed += 1;

    const hours = workedOn(date);
    if (hours === 0) continue;
    totals.workedHours += hours;
    if (cell.status === 'call-in') totals.callInHours += hours;
    if (holidays.has(date)) totals.holidayHours += hours;
    if (CODE_KIND[cell.planned] === 'off') totals.restDayHours += hours;
  }

  // Overtime is counted per payroll week, whole weeks only.
  for (let start = weekStartOf(rules, from); start <= to; start = addDays(start, 7)) {
    const end = addDays(start, 6);
    if (end < from || end > to) continue;
    let week = 0;
    for (const date of datesBetween(start, end)) week += workedOn(date);
    totals.overtimeHours += Math.max(0, week - rules.maxHours7d);
  }
  return totals;
}

// --- Leave -------------------------------------------------------------------

/**
 * Days accrued so far in `asOf`'s calendar year: a twelfth of the entitlement
 * for each completed month of service in that year.
 */
export function leaveAccrued(entitlementDays: number, startDate: string | null, asOf: string): number {
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const from = startDate && startDate > yearStart ? startDate : yearStart;
  if (from > asOf) return 0;
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = asOf.split('-').map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.round(Math.max(0, months) * (entitlementDays / 12) * 100) / 100;
}

// --- Now and next ------------------------------------------------------------

/** The duty in progress at `nowMinutes` (absolute), and the next one to start. */
export function currentAndNext(
  duties: Duty[],
  nowMinutes: number,
): { current: Duty | null; next: Duty | null } {
  const sorted = [...duties].sort((a, b) => a.start - b.start);
  return {
    current: sorted.find((d) => d.start <= nowMinutes && nowMinutes < d.end) ?? null,
    next: sorted.find((d) => d.start > nowMinutes) ?? null,
  };
}

/** Absolute minutes for the roster's wall clock, matching `Duty.start`. */
export function absoluteMinutes(date: string, minutes: number): number {
  return dayNumber(date) * 24 * 60 + minutes;
}

export function timeOfAbsolute(minutes: number): { date: string; time: string } {
  const day = Math.floor(minutes / (24 * 60));
  const rest = minutes - day * 24 * 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: dateOfDay(day), time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

// --- Configuration input -----------------------------------------------------

function intBetween(value: unknown, min: number, max: number, label: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Checks rules coming from a form or the database; throws with a readable reason. */
export function sanitizeRules(input: unknown, base: ShiftRules = DEFAULT_RULES): ShiftRules {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pick = <K extends keyof ShiftRules>(key: K): unknown => (key in raw ? raw[key] : base[key]);

  const rotationStart = pick('rotationStart');
  if (!isDateKey(rotationStart)) throw new Error('Rotation start must be a date.');

  const patternRaw = pick('pattern');
  if (!Array.isArray(patternRaw) || patternRaw.length < 2 || patternRaw.length > 56) {
    throw new Error('The pattern needs between 2 and 56 cycle days.');
  }
  const pattern = patternRaw.map((code) => {
    if (!isShiftCode(code) || code === 'LV' || code === 'W') throw new Error('The pattern may only use D, S, N, OC and X.');
    return code;
  });

  const timeZone = String(pick('timeZone') ?? '');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    throw new Error('Unknown time zone.');
  }

  const codesRaw = (pick('codes') && typeof pick('codes') === 'object' ? pick('codes') : {}) as Record<string, unknown>;
  const codes = {} as Record<ShiftCode, ShiftCodeDef>;
  for (const code of SHIFT_CODES) {
    const fallback = base.codes[code];
    const entry = (codesRaw[code] && typeof codesRaw[code] === 'object' ? codesRaw[code] : {}) as Record<string, unknown>;
    const name = String(entry.name ?? fallback.name).trim().slice(0, 30) || fallback.name;
    if (isWorking(code)) {
      const start = entry.start ?? fallback.start;
      const end = entry.end ?? fallback.end;
      if (!isTimeOfDay(start) || !isTimeOfDay(end)) throw new Error(`${name} needs a start and end time.`);
      const hours = entry.hours === undefined || entry.hours === null || entry.hours === '' ? spanHours(start, end) : Number(entry.hours);
      if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error(`${name} hours must be between 0 and 24.`);
      codes[code] = { name, start, end, hours };
    } else {
      codes[code] = { name, start: null, end: null, hours: 0 };
    }
  }

  const extraRaw = pick('extra');
  if (extraRaw !== undefined && extraRaw !== null && !Array.isArray(extraRaw)) throw new Error('The roster codes are not valid.');
  const extraList = (extraRaw ?? []) as unknown[];
  if (extraList.length > MAX_EXTRA_CODES) throw new Error(`A roster can have up to ${MAX_EXTRA_CODES} codes of its own.`);
  const taken = new Set<string>(SHIFT_CODES.map((code) => code.toLowerCase()));
  const extra = extraList.map((item): ExtraCode => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const code = String(entry.code ?? '').trim();
    if (!isCodeLike(code)) throw new Error(`“${code || 'A code'}” cannot be a roster code: use a short word of up to ${EXTRA_CODE_LENGTH} letters, digits or dashes.`);
    if (taken.has(code.toLowerCase())) throw new Error(`The code ${code} is already in use.`);
    taken.add(code.toLowerCase());
    if (!isShiftCode(entry.as)) throw new Error(`Say what ${code} counts as.`);
    const name = String(entry.name ?? '').trim().slice(0, 30) || code;
    if (!isWorking(entry.as)) return { code, name, as: entry.as, start: null, end: null, hours: null };
    const start = entry.start || null;
    const end = entry.end || null;
    if (Boolean(start) !== Boolean(end)) throw new Error(`${code} needs both a start and a finish time, or neither.`);
    if ((start && !isTimeOfDay(start)) || (end && !isTimeOfDay(end))) throw new Error(`${code} needs times as HH:MM.`);
    const hours = entry.hours === undefined || entry.hours === null || entry.hours === '' ? null : Number(entry.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) throw new Error(`${code} hours must be between 0 and 24.`);
    return { code, name, as: entry.as, start: start as string | null, end: end as string | null, hours };
  });

  const rules: ShiftRules = {
    timeZone,
    rotationStart,
    pattern,
    codes,
    extra,
    targetHours7d: intBetween(pick('targetHours7d'), 1, 168, 'Weekly target'),
    maxHours7d: intBetween(pick('maxHours7d'), 1, 168, 'Weekly limit'),
    maxHours14d: intBetween(pick('maxHours14d'), 1, 336, 'Two-week cap'),
    minRestHours: intBetween(pick('minRestHours'), 0, 48, 'Minimum rest'),
    maxConsecutiveDuties: intBetween(pick('maxConsecutiveDuties'), 1, 31, 'Consecutive duties'),
    leaveCapDays: intBetween(pick('leaveCapDays'), 0, 365, 'Leave cap'),
    responseMinutes: intBetween(pick('responseMinutes'), 1, 1440, 'Response time'),
    publishLeadDays: intBetween(pick('publishLeadDays'), 0, 90, 'Publish lead'),
    weekStart: intBetween(pick('weekStart'), 1, 7, 'Week start'),
  };
  if (rules.targetHours7d > rules.maxHours7d) throw new Error('The weekly target cannot be above the weekly limit.');
  return rules;
}
