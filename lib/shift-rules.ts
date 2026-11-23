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

export const RECORD_STATUSES = ['planned', 'worked', 'sick', 'leave', 'swapped', 'call-in', 'cover', 'no-show'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export function isRecordStatus(value: unknown): value is RecordStatus {
  return typeof value === 'string' && (RECORD_STATUSES as readonly string[]).includes(value);
}

/** What happened is on record: the plan for that day is history and is left alone. */
export const ACTUAL_STATUSES: readonly RecordStatus[] = ['worked', 'sick', 'no-show', 'call-in', 'cover'];

/** Confirmed as worked: to plan, by a call-in, or by a Project Coordinator covering the console. */
export function isWorkedStatus(status: RecordStatus): boolean {
  return status === 'worked' || status === 'call-in' || status === 'cover';
}

/** Rostered but not there: the plan stands, the shift was not worked. */
export function isAbsent(status: RecordStatus): boolean {
  return status === 'sick' || status === 'no-show';
}

export const CALL_IN_TRIGGERS = ['absence', 'task_load', 'incident', 'event', 'leave_cover'] as const;
export type CallInTrigger = (typeof CALL_IN_TRIGGERS)[number];

export const TRIGGER_LABEL: Record<CallInTrigger, string> = {
  absence: 'Absence',
  task_load: 'Task load',
  incident: 'Incident',
  event: 'Event',
  leave_cover: 'Leave cover',
};

/**
 * Which step of the cover order filled a vacant shift: the TRC on their first
 * on-call day, then a Project Coordinator (weekdays), then the TRC on their
 * second on-call day, then an off-duty TRC at overtime.
 */
export const COVER_SOURCES = ['first_oc', 'pc', 'second_oc', 'overtime'] as const;
export type CoverSource = (typeof COVER_SOURCES)[number];

export const SOURCE_LABEL: Record<CoverSource, string> = {
  first_oc: 'First on-call day',
  pc: 'Project Coordinator',
  second_oc: 'Second on-call day',
  overtime: 'Off-duty, overtime',
};

/** Leave is recorded by the code it puts on the roster; the entitlement arithmetic is HR's. */
export const LEAVE_TYPES = ['annual', 'sick', 'cto', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_CODE: Record<LeaveType, string> = { annual: 'LV', sick: 'SL', cto: 'CTO', unpaid: 'UL' };

export const LEAVE_LABEL: Record<LeaveType, string> = {
  annual: 'Annual leave',
  sick: 'Sick leave',
  cto: 'Compensatory time off',
  unpaid: 'Unpaid leave',
};

/** The codes HR counts days away by. */
export const AWAY_CODES = ['LV', 'SL', 'CTO', 'UL'] as const;
export type AwayCode = (typeof AWAY_CODES)[number];

export function leaveTypeOf(value: unknown): LeaveType {
  if ((LEAVE_TYPES as readonly unknown[]).includes(value)) return value as LeaveType;
  // Leave saved before the types followed the roster codes.
  return value === 'other' ? 'unpaid' : 'annual';
}

/**
 * The three positions on the roster. Travel Risk Coordinators run the 24/7
 * console rotation; Project Coordinators keep a weekday desk and are the
 * fallback and the second step of the cover order; drivers alternate two weeks
 * of days with two weeks of nights.
 */
export const POSITIONS = ['trc', 'pc', 'driver'] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABEL: Record<Position, string> = {
  trc: 'Travel Risk Coordinator',
  pc: 'Project Coordinator',
  driver: 'Driver',
};

export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && (POSITIONS as readonly string[]).includes(value);
}

// --- Configuration -----------------------------------------------------------

export interface ShiftCodeDef {
  name: string;
  /** 'HH:MM', console codes only. An end at or before the start is the next day. */
  start: string | null;
  end: string | null;
  /** Paid hours. */
  hours: number;
  /** Unpaid break inside the span, taken off when actual times are recorded. */
  breakHours?: number;
}

/**
 * What a code of the roster's own means to the rules beyond the built-in code
 * it counts as: the Project Coordinator's desk day, a driver's day or night,
 * and the kinds of day away HR counts.
 */
export const CODE_TAGS = ['pc', 'driver_day', 'driver_night', 'sick', 'cto', 'unpaid', 'deployed'] as const;
export type CodeTag = (typeof CODE_TAGS)[number];

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
  /** Set on the standard codes below; null on a code a roster made up for itself. */
  tag?: CodeTag | null;
  /** Unpaid break inside the span, in hours. */
  breakHours?: number | null;
}

/**
 * The codes every roster has beside the built-in ones (platform template
 * v0.3). Their names, times and hours are configuration; what they count as
 * and what they mean to the rules is fixed.
 */
export const STANDARD_CODES: readonly ExtraCode[] = [
  { code: 'PC', name: 'Project Coordinator desk day', as: 'W', start: '08:00', end: '17:00', hours: 8, tag: 'pc', breakHours: null },
  { code: 'SD-D', name: 'Driver day, Mon–Thu', as: 'W', start: '08:00', end: '19:00', hours: 10, tag: 'driver_day', breakHours: 1 },
  { code: 'SD-D3', name: 'Driver day, Friday', as: 'W', start: '09:00', end: '20:00', hours: 10, tag: 'driver_day', breakHours: 1 },
  { code: 'SD-N', name: 'Driver night', as: 'W', start: '20:00', end: '06:00', hours: 9, tag: 'driver_night', breakHours: 1 },
  { code: 'SD-N2', name: 'Driver night, late finish', as: 'W', start: '20:00', end: '07:30', hours: 10.5, tag: 'driver_night', breakHours: 1 },
  { code: 'SL', name: 'Sick leave', as: 'LV', start: null, end: null, hours: null, tag: 'sick', breakHours: null },
  { code: 'CTO', name: 'Compensatory time off', as: 'LV', start: null, end: null, hours: null, tag: 'cto', breakHours: null },
  { code: 'UL', name: 'Unpaid leave', as: 'LV', start: null, end: null, hours: null, tag: 'unpaid', breakHours: null },
  { code: 'ETH', name: 'Ethiopia relief', as: 'LV', start: null, end: null, hours: null, tag: 'deployed', breakHours: null },
];

export const MAX_EXTRA_CODES = 40;
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
  /**
   * A Monday on which the drivers' two-week blocks start: a driver with offset
   * 0 is on days for the fortnight from here, on nights for the next, and so on.
   */
  driverAnchor: string;
  /** Sick leave in any 12 months: days on full pay, then days on half pay. */
  sickFullDays: number;
  sickHalfDays: number;
  /** A compensatory day lapses this many days after it is earned. */
  ctoExpiryDays: number;
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
    LV: { name: 'Annual leave', start: null, end: null, hours: 0 },
  },
  extra: [...STANDARD_CODES],
  targetHours7d: 48,
  maxHours7d: 52,
  maxHours14d: 116,
  minRestHours: 11,
  maxConsecutiveDuties: 6,
  leaveCapDays: 14,
  responseMinutes: 60,
  publishLeadDays: 14,
  weekStart: 1,
  driverAnchor: '2026-11-30',
  sickFullDays: 7,
  sickHalfDays: 7,
  ctoExpiryDays: 90,
};

// --- The roster's own codes --------------------------------------------------

/** The roster's own code that `written` is, or null for a built-in code or one nobody knows. */
export function extraOf(rules: ShiftRules, written: string | null | undefined): ExtraCode | null {
  if (!written) return null;
  return rules.extra.find((extra) => extra.code === written) ?? null;
}

/** What a written code means to the rules beyond its built-in code; null for most. */
export function tagOf(rules: ShiftRules, written: string | null | undefined): CodeTag | null {
  return extraOf(rules, written)?.tag ?? null;
}

/** The code HR counts a day away under, for a cell planned as leave; null for ETH and the like. */
export function awayCodeOf(rules: ShiftRules, planned: ShiftCode, label: string | null | undefined): AwayCode | null {
  if (planned !== 'LV') return null;
  const tag = tagOf(rules, label);
  if (tag === 'sick') return 'SL';
  if (tag === 'cto') return 'CTO';
  if (tag === 'unpaid') return 'UL';
  // A leave code a roster made up for itself ("A/L") is annual leave.
  return tag === null ? 'LV' : null;
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
  const breakHours = extra.breakHours ?? 0;
  return {
    name: extra.name,
    start,
    end,
    hours: extra.hours ?? (extra.start && extra.end ? Math.max(0, spanHours(extra.start, extra.end) - breakHours) : base.hours),
    ...(breakHours > 0 ? { breakHours } : {}),
  };
}

/** The codes a roster made up for itself, without the standard ones every roster has. */
export function ownCodes(rules: ShiftRules): ExtraCode[] {
  return rules.extra.filter((extra) => !extra.tag);
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
  /** The billet: "TRC-1", "DRV-2". */
  code: string;
  /** Absent on rosters read before positions existed: a Travel Risk Coordinator. */
  position?: Position;
  /**
   * A TRC's zero-based cycle day at the rotation start; null keeps them out of
   * the rotation. A driver's block offset: 0 starts the anchor fortnight on
   * days, 1 on nights. Not used for a Project Coordinator.
   */
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

export function positionOf(line: Pick<RosterLine, 'position'>): Position {
  return line.position ?? 'trc';
}

/** Monday to Friday and not a public holiday. */
export function isWorkday(date: string, holidays?: ReadonlySet<string>): boolean {
  return isoWeekday(date) <= 5 && !holidays?.has(date);
}

/**
 * The last Monday-to-Friday week that lies wholly inside the month of `date`:
 * the drivers' late-finish week (21–25 December in 2026).
 */
export function lastFullWorkWeek(month: string): { from: string; to: string } {
  const end = monthEnd(month);
  // The last Friday of the month, then back to its Monday.
  const friday = addDays(end, -mod(isoWeekday(end) - 5, 7));
  return { from: addDays(friday, -4), to: friday };
}

/** The standard code carrying `tag`, as this roster writes it; null when it has been removed. */
function codeTagged(rules: ShiftRules, tag: CodeTag, prefer?: string): string | null {
  const tagged = rules.extra.filter((extra) => extra.tag === tag);
  return (tagged.find((extra) => extra.code === prefer) ?? tagged[0])?.code ?? null;
}

/**
 * A driver's code on a date. Blocks of 14 days run from the anchor Monday; a
 * driver is on days in the even blocks (offset 0) or the odd ones (offset 1),
 * and on nights in the others. Weekends and public holidays are off.
 * Day: SD-D, or SD-D3 on a Friday. Night: SD-N, or SD-N2 on a Tuesday and on
 * Monday to Wednesday of the month's last full week.
 */
export function driverCode(rules: ShiftRules, offset: number, date: string, holidays?: ReadonlySet<string>): string {
  if (!isWorkday(date, holidays)) return 'X';
  const block = Math.floor(diffDays(date, rules.driverAnchor) / 14) + offset;
  const weekday = isoWeekday(date);
  if (mod(block, 2) === 0) return codeTagged(rules, 'driver_day', weekday === 5 ? 'SD-D3' : 'SD-D') ?? 'W';
  const lastWeek = lastFullWorkWeek(monthOf(date));
  const late = weekday === 2 || (weekday <= 3 && date >= lastWeek.from && date <= lastWeek.to);
  return codeTagged(rules, 'driver_night', late ? 'SD-N2' : 'SD-N') ?? 'W';
}

/**
 * What the roster generates for a line on a date, as written ("D", "PC",
 * "SD-N2"); null for someone the roster does not generate for (a TRC outside
 * the rotation).
 *   TRC: the rotation pattern.
 *   Project Coordinator: PC on a weekday that is not a public holiday, else X.
 *   Driver: see `driverCode`.
 */
export function generatedWritten(rules: ShiftRules, line: RosterLine, date: string, holidays?: ReadonlySet<string>): string | null {
  const position = positionOf(line);
  if (position === 'pc') return isWorkday(date, holidays) ? (codeTagged(rules, 'pc', 'PC') ?? 'W') : 'X';
  if (position === 'driver') return driverCode(rules, line.cycleOffset ?? 0, date, holidays);
  return line.cycleOffset === null ? null : generatedCode(rules, line.cycleOffset, date);
}

/** True when the roster can generate this line's days: everyone but a TRC outside the rotation. */
export function generates(line: RosterLine): boolean {
  return positionOf(line) !== 'trc' || line.cycleOffset !== null;
}

/** A written code as an unsaved cell. */
export function cellOfWritten(rules: ShiftRules, written: string): RosterCell {
  const base = baseOf(rules, written) ?? 'X';
  return {
    generated: base,
    planned: base,
    worked: null,
    status: base === 'LV' ? 'leave' : 'planned',
    hours: null,
    start: null,
    end: null,
    label: extraOf(rules, written)?.code ?? null,
  };
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
  holidays?: ReadonlySet<string>,
): RosterCell | null {
  const saved = lookup(line.id, date);
  if (saved) return saved;
  if (generated?.(date)) return null;
  if (!lineOnRoster(line, date)) return null;
  const written = generatedWritten(rules, line, date, holidays);
  return written === null ? null : cellOfWritten(rules, written);
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
  // Recorded times are the span on site; a driver's unpaid break comes off it.
  const hours = cell.hours ?? (cell.start && cell.end ? Math.max(0, spanHours(cell.start, cell.end) - (def.breakHours ?? 0)) : def.hours);
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
  | 'no_fallback'
  | 'driver_coverage'
  | 'off_day_code'
  | 'position_code'
  | 'pc_cover'
  | 'rest'
  | 'weekly_max'
  | 'weekly_target'
  | 'fortnight'
  | 'weekly_rest'
  | 'consecutive'
  | 'rest_day_worked';

export type Severity = 'block' | 'warn';

export const RULE_LABEL: Record<RuleId, string> = {
  coverage_gap: 'Coverage gap',
  coverage_double: 'Double cover',
  no_on_call: 'No TRC on call',
  no_fallback: 'No on call, no fallback',
  driver_coverage: 'Driver coverage',
  off_day_code: 'Weekend or holiday',
  position_code: 'Code for another position',
  pc_cover: 'Project Coordinator cover',
  rest: 'Rest between duties',
  weekly_max: 'Weekly hours limit',
  weekly_target: 'Weekly hours target',
  fortnight: 'Two-week hours',
  weekly_rest: 'Weekly rest day',
  consecutive: 'Consecutive duties',
  rest_day_worked: 'Rest day worked',
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

/** True while the cell stands as planned: not absent, and not turned into another shift by a call-in. */
function standsAs(cell: RosterCell, tag: CodeTag, rules: ShiftRules): boolean {
  return !isAbsent(cell.status) && cell.worked === null && tagOf(rules, cell.label) === tag;
}

/**
 * Every rule, for dates `from`..`to` inclusive. Windows reach back before
 * `from` through `lookup` (and what the roster generates, where nothing is
 * saved yet). `holidays` are the public holidays: without them the weekday
 * rules treat every Monday to Friday as a working day.
 *
 * Blocks: a console shift nobody is on; less than the minimum rest; no day off
 * in seven; over the weekly limit; drivers not one on days and one on nights;
 * a desk or driver code on a weekend or holiday; a code that belongs to
 * another position; a Project Coordinator covering the console on a weekend or
 * holiday. Everything else warns.
 */
export function validateRoster(
  rules: ShiftRules,
  lines: RosterLine[],
  lookup: CellLookup,
  from: string,
  to: string,
  generated?: GeneratedCheck,
  holidays?: ReadonlySet<string>,
): Violation[] {
  const out: Violation[] = [];
  const dates = datesBetween(from, to);
  const needed = CONSOLE_CODES.filter((code) => rules.pattern.includes(code));
  const expectsOnCall = rules.pattern.includes('OC');
  const resolve = (line: RosterLine, date: string) => resolveCell(rules, line, date, lookup, generated, holidays);
  const general = (rule: RuleId, severity: Severity, date: string, message: string, suffix = '') =>
    out.push({ key: `${rule}|${date}${suffix}`, rule, severity, date, lineId: null, lineCode: null, message });
  const personal = (rule: RuleId, severity: Severity, line: RosterLine, date: string, message: string) =>
    out.push({ key: `${rule}|${line.id}|${date}`, rule, severity, date, lineId: line.id, lineCode: line.code, message });

  for (const date of dates) {
    const day = lines
      .map((line) => ({ line, position: positionOf(line), cell: resolve(line, date) }))
      .filter((entry): entry is { line: RosterLine; position: Position; cell: RosterCell } => entry.cell !== null);
    if (day.length === 0) continue;
    const workday = isWorkday(date, holidays);
    const offDay = holidays?.has(date) ? 'a public holiday' : 'a weekend';

    // The console: exactly one person on each shift, from the TRCs and the Project Coordinators.
    const console = day.filter((entry) => entry.position !== 'driver').map((entry) => entry.cell);
    if (console.length > 0) {
      for (const code of needed) {
        const planned = console.filter((c) => c.planned === code && !isAbsent(c.status)).length;
        const calledIn = console.filter((c) => c.worked === code && c.planned !== code).length;
        const name = `${rules.codes[code].name} (${code})`;
        if (planned + calledIn === 0) {
          general('coverage_gap', 'block', date, `No one on ${name} on ${shortDate(date)}.`, `|${code}`);
        } else if (planned + calledIn >= 2) {
          // Allowed, and shown as a double: worth a look, never a reason to stop.
          general('coverage_double', 'warn', date, `${planned + calledIn} people on ${name} on ${shortDate(date)}; there should be one.`, `|${code}`);
        }
      }
    }

    // On call: a TRC in reserve; on a weekday a Project Coordinator at their desk is the fallback.
    const trcs = day.filter((entry) => entry.position === 'trc');
    if (expectsOnCall && trcs.length > 0 && !trcs.some((entry) => entry.cell.planned === 'OC')) {
      const fallback = workday && day.some((entry) => entry.position === 'pc' && standsAs(entry.cell, 'pc', rules));
      if (fallback) general('no_on_call', 'warn', date, `No TRC on call on ${shortDate(date)}; a Project Coordinator is the fallback.`);
      else general('no_fallback', 'warn', date, `No TRC on call and no fallback on ${shortDate(date)}.`);
    }

    // Drivers: one on days and one on nights each working day.
    const drivers = day.filter((entry) => entry.position === 'driver');
    if (drivers.length > 0 && workday) {
      const days = drivers.filter((entry) => standsAs(entry.cell, 'driver_day', rules)).length;
      const nights = drivers.filter((entry) => standsAs(entry.cell, 'driver_night', rules)).length;
      if (days !== 1 || nights !== 1) {
        const have = (count: number, what: string) => (count === 0 ? `no ${what} driver` : count === 1 ? `one ${what} driver` : `${count} ${what} drivers`);
        general('driver_coverage', 'block', date, `${shortDate(date)} has ${have(days, 'day')} and ${have(nights, 'night')}; it needs one of each.`);
      }
    }

    for (const { line, position, cell } of day) {
      if (isAbsent(cell.status)) continue;
      const tag = cell.worked === null ? tagOf(rules, cell.label) : null;
      const code = cell.worked ?? cell.planned;
      const written = cell.label ?? cell.planned;

      // A code belongs to its position.
      if (tag === 'pc' && position !== 'pc') {
        personal('position_code', 'block', line, date, `${line.code} has ${written} on ${shortDate(date)}; the desk day is for Project Coordinators.`);
      } else if ((tag === 'driver_day' || tag === 'driver_night') && position !== 'driver') {
        personal('position_code', 'block', line, date, `${line.code} has ${written} on ${shortDate(date)}; that is a driver's shift.`);
      } else if (position === 'driver' && (isConsole(code) || code === 'OC')) {
        personal('position_code', 'block', line, date, `${line.code} is a driver and cannot be on ${rules.codes[code].name} on ${shortDate(date)}.`);
      }

      // Desk days and driver shifts are weekday work: off on weekends and public holidays.
      if (!workday && (tag === 'pc' || tag === 'driver_day' || tag === 'driver_night')) {
        personal('off_day_code', 'block', line, date, `${line.code} has ${written} on ${shortDate(date)}, ${offDay}; it must be Off or leave.`);
      }

      // A Project Coordinator covers the console in place of a weekday desk day.
      if (position === 'pc' && isConsole(code) && !workday) {
        personal('pc_cover', 'block', line, date, `${line.code} is on ${rules.codes[code].name} on ${shortDate(date)}, ${offDay}; a Project Coordinator covers weekdays only, unless agreed.`);
      }

      // A TRC's rest day is protected: working it is overtime and earns a day in lieu.
      if (position === 'trc' && cell.generated === 'X' && cell.worked === null && isWorking(cell.planned)) {
        personal(
          'rest_day_worked',
          'warn',
          line,
          date,
          `${line.code} is rostered to work a rest day on ${shortDate(date)}: paid as overtime (1.5x, 2x on a public holiday) and earns a compensatory day.`,
        );
      }
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
      const cell = resolve(line, date);
      cells.push(cell);
      duties.push(dutyOf(rules, cell, date));
    }
    if (!duties.some(Boolean) && !cells.some(Boolean)) continue;
    // The 48-hour target is the TRCs'; a driver's day week is planned at 50.
    const hasTarget = positionOf(line) === 'trc';

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
        const cell = cells[i] as RosterCell;
        // A desk day after a cover starts late rather than early: a Swing ending 23:00 puts the
        // next desk day at 10:00. It only fails when no desk day is left (after a Night).
        if (previous && cell.worked === null && !cell.start && tagOf(rules, cell.label) === 'pc') {
          const earliest = previous.end + rules.minRestHours * 60;
          if (duty.start < earliest && earliest < duty.end) duty.start = earliest;
        }
        if (inRange && previous) {
          const rest = (duty.start - previous.end) / 60;
          if (rest < rules.minRestHours) {
            const name = codeDef(rules, duty.code, cell.worked ? null : cell.label).name;
            personal('rest', 'block', line, date, `${line.code} has ${formatHours(Math.max(0, rest))} h rest before ${name} on ${shortDate(date)}; the minimum is ${rules.minRestHours} h.`);
          }
        }
        previous = duty;

        // A window peaks on a day that is worked, so only those ends are reported.
        if (inRange) {
          const week = hoursOver(i, 7);
          if (week > rules.maxHours7d) {
            personal('weekly_max', 'block', line, date, `${line.code} reaches ${formatHours(week)} h in the 7 days to ${shortDate(date)}; the limit is ${rules.maxHours7d} h.`);
          } else if (hasTarget && week > rules.targetHours7d) {
            personal('weekly_target', 'warn', line, date, `${line.code} reaches ${formatHours(week)} h in the 7 days to ${shortDate(date)}; the target is ${rules.targetHours7d} h.`);
          }

          const fortnight = hoursOver(i, 14);
          if (fortnight > rules.maxHours14d) {
            personal('fortnight', 'warn', line, date, `${line.code} reaches ${formatHours(fortnight)} h in the 14 days to ${shortDate(date)}; the cap is ${rules.maxHours14d} h.`);
          }

          if (run > rules.maxConsecutiveDuties) {
            personal('consecutive', 'warn', line, date, `${line.code} is on duty ${run} days running by ${shortDate(date)}; more than ${rules.maxConsecutiveDuties} needs a look.`);
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
          personal('weekly_rest', 'block', line, date, `${line.code} has no full day off in the 7 days to ${shortDate(date)}.`);
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
  /** Calendar days away under each code HR counts. */
  away: Record<AwayCode, number>;
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
    away: { LV: 0, SL: 0, CTO: 0, UL: 0 },
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
    const away = awayCodeOf(rules, cell.planned, cell.label);
    if (away) totals.away[away] += 1;
    const duty = dutyOf(rules, cell, date);
    if (!duty) continue;
    totals.shifts += 1;
    totals.hours += duty.hours;
    if (duty.calledIn) totals.callIns += 1;
    // A night is a console Night or a driver's night shift.
    if (duty.code === 'N' || (cell.worked === null && tagOf(rules, cell.label) === 'driver_night')) totals.nights += 1;
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
  /** Worked by a Project Coordinator covering the console in place of a desk day. */
  coverHours: number;
  /** Above the weekly limit: paid at 1.5x. */
  overtimeHours: number;
  /** Worked on a public holiday: paid at 2x. */
  holidayHours: number;
  /** Worked on a rostered rest day: overtime at 1.5x, and a compensatory day earned. */
  restDayHours: number;
  /** Days of unpaid leave, for payroll to deduct. */
  unpaidDays: number;
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
    coverHours: 0,
    overtimeHours: 0,
    holidayHours: 0,
    restDayHours: 0,
    unpaidDays: 0,
    unconfirmed: 0,
    sickDays: 0,
    noShows: 0,
  };
  const workedOn = (date: string): number => {
    const cell = lookup(line.id, date);
    if (!cell || !isWorkedStatus(cell.status)) return 0;
    return dutyOf(rules, cell, date)?.hours ?? 0;
  };

  for (const date of datesBetween(from, to)) {
    const cell = lookup(line.id, date);
    if (!cell) continue;
    if (isWorking(cell.planned)) totals.plannedHours += codeDef(rules, cell.planned, cell.label).hours;
    if (cell.status === 'sick') totals.sickDays += 1;
    if (cell.status === 'no-show') totals.noShows += 1;
    if (awayCodeOf(rules, cell.planned, cell.label) === 'UL') totals.unpaidDays += 1;
    if (cell.status === 'planned' && isWorking(cell.planned) && date < today) totals.unconfirmed += 1;

    const hours = workedOn(date);
    if (hours === 0) continue;
    totals.workedHours += hours;
    if (cell.status === 'call-in') totals.callInHours += hours;
    if (cell.status === 'cover') totals.coverHours += hours;
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

// --- Compensatory time off ---------------------------------------------------

export interface CtoEarned {
  /** The date the day was earned. */
  date: string;
  days: number;
  /** The last date it can be taken; null never lapses. */
  expiresOn: string | null;
}

export interface CtoBalance {
  earned: number;
  taken: number;
  /** Earned, not taken, and past its expiry. */
  lapsed: number;
  /** What can still be taken today. */
  balance: number;
  /** Of the balance, what lapses within `soonDays`. */
  expiringSoon: number;
  /** The earliest expiry among days still available. */
  nextExpiry: string | null;
}

/**
 * The compensatory-time balance. Each day taken uses the earliest-earned day
 * that had not lapsed on the date it was taken; a day taken with nothing to
 * draw on shows as a negative balance for HR to settle.
 */
export function ctoBalance(earned: CtoEarned[], takenDates: string[], today: string, soonDays = 30): CtoBalance {
  const pool = [...earned].sort((a, b) => a.date.localeCompare(b.date)).map((entry) => ({ ...entry, left: entry.days }));
  let unmatched = 0;
  for (const date of [...takenDates].sort()) {
    let need = 1;
    for (const entry of pool) {
      if (need <= 0) break;
      if (entry.left <= 0 || (entry.expiresOn !== null && entry.expiresOn < date)) continue;
      const used = Math.min(entry.left, need);
      entry.left -= used;
      need -= used;
    }
    unmatched += need;
  }
  const soon = addDays(today, soonDays);
  const live = pool.filter((entry) => entry.left > 0 && (entry.expiresOn === null || entry.expiresOn >= today));
  const sum = (entries: Array<{ left: number }>) => Math.round(entries.reduce((total, entry) => total + entry.left, 0) * 100) / 100;
  const expiries = live.map((entry) => entry.expiresOn).filter((date): date is string => date !== null).sort();
  return {
    earned: Math.round(earned.reduce((total, entry) => total + entry.days, 0) * 100) / 100,
    taken: takenDates.length,
    lapsed: sum(pool.filter((entry) => entry.left > 0 && entry.expiresOn !== null && entry.expiresOn < today)),
    balance: Math.round((sum(live) - unmatched) * 100) / 100,
    expiringSoon: sum(live.filter((entry) => entry.expiresOn !== null && entry.expiresOn <= soon)),
    nextExpiry: expiries[0] ?? null,
  };
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
  if (extraList.length > MAX_EXTRA_CODES) throw new Error(`A roster can have up to ${MAX_EXTRA_CODES - STANDARD_CODES.length} codes of its own.`);
  const taken = new Set<string>(SHIFT_CODES.map((code) => code.toLowerCase()));
  const extra = extraList.map((item): ExtraCode => {
    const entry = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const code = String(entry.code ?? '').trim();
    if (!isCodeLike(code)) throw new Error(`“${code || 'A code'}” cannot be a roster code: use a short word of up to ${EXTRA_CODE_LENGTH} letters, digits or dashes.`);
    if (taken.has(code.toLowerCase())) throw new Error(`The code ${code} is already in use.`);
    taken.add(code.toLowerCase());
    if (!isShiftCode(entry.as)) throw new Error(`Say what ${code} counts as.`);
    const name = String(entry.name ?? '').trim().slice(0, 30) || code;
    if (!isWorking(entry.as)) return { code, name, as: entry.as, start: null, end: null, hours: null, tag: null, breakHours: null };
    const start = entry.start || null;
    const end = entry.end || null;
    if (Boolean(start) !== Boolean(end)) throw new Error(`${code} needs both a start and a finish time, or neither.`);
    if ((start && !isTimeOfDay(start)) || (end && !isTimeOfDay(end))) throw new Error(`${code} needs times as HH:MM.`);
    const hours = entry.hours === undefined || entry.hours === null || entry.hours === '' ? null : Number(entry.hours);
    if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24)) throw new Error(`${code} hours must be between 0 and 24.`);
    const breakHours = entry.breakHours === undefined || entry.breakHours === null || entry.breakHours === '' ? null : Number(entry.breakHours);
    if (breakHours !== null && (!Number.isFinite(breakHours) || breakHours < 0 || breakHours > 4)) throw new Error(`${code} break must be between 0 and 4 hours.`);
    return { code, name, as: entry.as, start: start as string | null, end: end as string | null, hours, tag: null, breakHours: breakHours || null };
  });

  // The standard codes are always there and always mean the same; a roster only sets their names and hours.
  const standardNames = new Set(STANDARD_CODES.map((standard) => standard.code.toLowerCase()));
  const own = extra.filter((entry) => !standardNames.has(entry.code.toLowerCase()));
  const standard = STANDARD_CODES.map((fixed): ExtraCode => {
    const saved = extra.find((entry) => entry.code.toLowerCase() === fixed.code.toLowerCase());
    if (!saved) return { ...fixed };
    if (!isWorking(fixed.as)) return { ...fixed, name: saved.name === saved.code ? fixed.name : saved.name };
    // Saved as something else (a code a roster had made up before it became standard): the standard times stand.
    const kept = saved.as === fixed.as;
    return {
      ...fixed,
      name: saved.name === saved.code ? fixed.name : saved.name,
      start: (kept && saved.start) || fixed.start,
      end: (kept && saved.end) || fixed.end,
      hours: (kept && saved.hours) || fixed.hours,
      breakHours: kept && saved.breakHours !== null && saved.breakHours !== undefined ? saved.breakHours : (fixed.breakHours ?? null),
    };
  });
  const allExtra = [...standard, ...own];

  const driverAnchor = pick('driverAnchor') ?? base.driverAnchor;
  if (!isDateKey(driverAnchor)) throw new Error('The driver anchor must be a date.');
  if (isoWeekday(driverAnchor) !== 1) throw new Error('The driver anchor must be a Monday: the drivers change over at the start of a week.');

  const rules: ShiftRules = {
    timeZone,
    rotationStart,
    pattern,
    codes,
    extra: allExtra,
    targetHours7d: intBetween(pick('targetHours7d'), 1, 168, 'Weekly target'),
    maxHours7d: intBetween(pick('maxHours7d'), 1, 168, 'Weekly limit'),
    maxHours14d: intBetween(pick('maxHours14d'), 1, 336, 'Two-week cap'),
    minRestHours: intBetween(pick('minRestHours'), 0, 48, 'Minimum rest'),
    maxConsecutiveDuties: intBetween(pick('maxConsecutiveDuties'), 1, 31, 'Consecutive duties'),
    leaveCapDays: intBetween(pick('leaveCapDays'), 0, 365, 'Leave cap'),
    responseMinutes: intBetween(pick('responseMinutes'), 1, 1440, 'Response time'),
    publishLeadDays: intBetween(pick('publishLeadDays'), 0, 90, 'Publish lead'),
    weekStart: intBetween(pick('weekStart'), 1, 7, 'Week start'),
    driverAnchor,
    sickFullDays: intBetween(pick('sickFullDays') ?? base.sickFullDays, 0, 365, 'Sick days on full pay'),
    sickHalfDays: intBetween(pick('sickHalfDays') ?? base.sickHalfDays, 0, 365, 'Sick days on half pay'),
    ctoExpiryDays: intBetween(pick('ctoExpiryDays') ?? base.ctoExpiryDays, 1, 730, 'CTO expiry'),
  };
  if (rules.targetHours7d > rules.maxHours7d) throw new Error('The weekly target cannot be above the weekly limit.');
  return rules;
}
