/**
 * Shapes the shift-planning APIs return, and the small helpers both sides
 * need to read them. Client-safe: types and pure functions only.
 */

import type {
  AwayCode,
  CallInTrigger,
  CellLookup,
  CoverSource,
  CtoBalance,
  LeaveType,
  LineTotals,
  PayrollTotals,
  Position,
  RecordStatus,
  RosterCell,
  RosterLine,
  ShiftCode,
  ShiftRules,
  Violation,
} from './shift-rules';

/** The records the shift pages show; they refetch when any of these change (see lib/live-sources.ts). */
export const SHIFT_SOURCES = ['Shift', 'PublicHoliday'] as const;

export interface LineView extends RosterLine {
  userId: number | null;
  /** The linked account's name, else the display name, else the code. */
  name: string;
  email: string | null;
  displayName: string | null;
  position: Position;
  contractHoursPerWeek: number;
  leaveEntitlementDays: number;
  leaveOpeningBalance: number;
  sortOrder: number;
}

export interface CallInView {
  id: number;
  trigger: CallInTrigger;
  /** Which step of the cover order this was; null on call-ins saved before it was recorded. */
  source: CoverSource | null;
  calledAt: string;
  acknowledgedAt: string | null;
  arrivedAt: string | null;
  releasedAt: string | null;
  responseMinutes: number | null;
  /** True when the person was called in from a rest day, with approval. */
  escalation: boolean;
  note: string | null;
}

export interface RecordView {
  id: number;
  lineId: number;
  date: string;
  generatedCode: ShiftCode;
  /** The built-in code the plan counts as. */
  plannedCode: ShiftCode;
  /** The roster's own code the plan is written as ("SOC-D"), when it is one. */
  label?: string | null;
  workedCode: ShiftCode | null;
  status: RecordStatus;
  actualStart: string | null;
  actualEnd: string | null;
  hoursWorked: number | null;
  reasonCode: string | null;
  note: string | null;
  leaveId: number | null;
  callIn: CallInView | null;
}

export function cellOfRecord(record: RecordView): RosterCell {
  return {
    generated: record.generatedCode,
    planned: record.plannedCode,
    worked: record.workedCode,
    status: record.status,
    hours: record.hoursWorked,
    start: record.actualStart,
    end: record.actualEnd,
    label: record.label ?? null,
  };
}

/** The plan as it is written on the roster: the roster's own code, or the built-in one. */
export function writtenCode(record: Pick<RecordView, 'plannedCode' | 'label'>): string {
  return record.label ?? record.plannedCode;
}

export function recordKey(lineId: number, date: string): string {
  return `${lineId}|${date}`;
}

export function indexRecords(records: RecordView[]): Map<string, RecordView> {
  return new Map(records.map((r) => [recordKey(r.lineId, r.date), r]));
}

/**
 * A rules lookup over saved records, with optional cells replaced (a draft).
 * A draft may also roster a day that has nothing saved: a patch that names a
 * planned code stands as the whole cell there.
 */
export function buildLookup(
  records: Map<string, RecordView>,
  patches?: ReadonlyMap<string, Partial<RosterCell>>,
): CellLookup {
  return (lineId, date) => {
    const key = recordKey(lineId, date);
    const record = records.get(key);
    const patch = patches?.get(key);
    if (!record) {
      if (!patch?.planned) return null;
      return { generated: patch.planned, worked: null, status: 'planned', hours: null, start: null, end: null, ...patch, planned: patch.planned };
    }
    const cell = cellOfRecord(record);
    return patch ? { ...cell, ...patch } : cell;
  };
}

export type MonthStatus = 'none' | 'draft' | 'published';

export interface MonthView {
  month: string;
  status: MonthStatus;
  generatedAt: string | null;
  publishedAt: string | null;
  /** The date this month should be published by. */
  publishDue: string;
}

export interface HolidayView {
  id: string;
  date: string;
  name: string;
  country: string;
}

export type LeaveStatus = 'pending' | 'approved' | 'declined' | 'cancelled';

export interface LeaveView {
  id: number;
  lineId: number;
  lineCode: string;
  personName: string;
  type: LeaveType;
  /** The code it puts on the roster: LV, SL, CTO or UL. */
  code: string;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  /** Calendar days recorded: every day of the period, rest and on-call days included. */
  days: number;
  note: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/**
 * What the roster records about a person's time away. Days are calendar days
 * as rostered; how they count against an entitlement is HR's rule, applied
 * downstream.
 */
export interface LeaveBalance {
  entitlement: number;
  opening: number;
  accrued: number;
  /** Calendar days of approved annual leave this year. */
  taken: number;
  /** Calendar days a pending annual request covers. */
  pending: number;
  balance: number;
  /** Days on the roster under each code this calendar year. */
  away: Record<AwayCode, number>;
  /** Sick days in the 12 months to today, against the full-pay and half-pay allowances. */
  sick12m: number;
  cto: CtoBalance;
}

export const EMPTY_LEAVE_BALANCE: LeaveBalance = {
  entitlement: 0,
  opening: 0,
  accrued: 0,
  taken: 0,
  pending: 0,
  balance: 0,
  away: { LV: 0, SL: 0, CTO: 0, UL: 0 },
  sick12m: 0,
  cto: { earned: 0, taken: 0, lapsed: 0, balance: 0, expiringSoon: 0, nextExpiry: null },
};

/** One entry of the compensatory-time ledger. */
export interface CtoEntryView {
  id: number;
  lineId: number;
  lineCode: string;
  personName: string;
  date: string;
  days: number;
  source: 'holiday_callin' | 'overtime_callin' | 'manual';
  expiresOn: string | null;
  note: string | null;
  createdAt: string;
}

export interface AuditView {
  id: number;
  action: string;
  actorName: string;
  month: string | null;
  lineCode: string | null;
  date: string | null;
  summary: string;
  detail: unknown;
  blockOverridden: boolean;
  createdAt: string;
}

export interface UserOption {
  id: number;
  name: string;
  email: string;
  /** The roster line this account is already linked to, if any. */
  lineId: number | null;
}

export interface ChangeInput {
  lineId: number;
  date: string;
  /** As written: a built-in code or one of the roster's own. */
  code: string;
}

/** A save that the rules stopped comes back with what fired instead of records. */
export interface SaveResult {
  saved: boolean;
  blocks: Violation[];
  warnings: Violation[];
  records?: RecordView[];
  month?: MonthView;
}

/** Everything the admin roster needs for one month. */
export interface AdminOverview {
  today: string;
  rules: ShiftRules;
  lines: LineView[];
  month: MonthView;
  /** Months with saved records among those the window touches. */
  generatedMonths: string[];
  /** The month plus two weeks either side, so rule windows can be checked live. */
  records: RecordView[];
  holidays: HolidayView[];
  leaves: LeaveView[];
  balances: Record<number, LeaveBalance>;
  /** The compensatory-time ledger, newest first. */
  cto: CtoEntryView[];
  users: UserOption[];
}

/** Everyone's month, read-only: what an admin sees in the staff module. */
export interface TeamRoster {
  today: string;
  rules: ShiftRules;
  lines: LineView[];
  month: MonthView;
  records: RecordView[];
  holidays: HolidayView[];
}

/** One person's view of their own published shifts. */
export interface MyShifts {
  today: string;
  rules: ShiftRules;
  line: LineView | null;
  month: MonthView;
  /** This month's records, empty until the month is published. */
  records: RecordView[];
  /** Yesterday through the next two weeks, published months only. */
  upcoming: RecordView[];
  holidays: HolidayView[];
  totals: LineTotals;
  balance: LeaveBalance | null;
  leaves: LeaveView[];
}

// --- Dashboard ---------------------------------------------------------------

export type Tone = 'ok' | 'warn' | 'danger';

export interface DashboardNow {
  consoles: Array<{
    code: ShiftCode;
    name: string;
    /** True while this shift's hours are running. */
    active: boolean;
    /** Who is on it now when active, else who is rostered on it today. */
    people: string[];
    start: string | null;
    end: string | null;
  }>;
  onCall: string[];
  /** Project Coordinators at their desk today: the weekday fallback when no TRC is on call. */
  fallback: string[];
  /** Drivers rostered today, and whether each shift is running. */
  drivers: Array<{ name: string; code: string; start: string | null; end: string | null; active: boolean }>;
  nextHandover: { date: string; time: string } | null;
}

export interface DashboardLine {
  lineId: number;
  code: string;
  name: string;
  position: Position;
  /** Days of work in the seven days ending today. */
  workDays7: number;
  /** Days away this month under each code. */
  awayMonth: Record<AwayCode, number>;
  /** Hours in the seven days ending today. */
  last7: number;
  /** The heaviest seven-day window in the coming week. */
  next7: number;
  tone: Tone;
  payroll: PayrollTotals;
  /** Worked against planned to date, as a fraction; null with nothing planned yet. */
  variance: number | null;
  utilization: number | null;
  capacityAvailable: number;
  capacityUsed: number;
  callInsThisCycle: number;
  sickEpisodes: number;
  nights: number;
  weekendShifts: number;
  holidayShifts: number;
  leave: LeaveBalance;
}

export interface DashboardCallIn {
  date: string;
  lineCode: string;
  name: string;
  position: Position;
  code: ShiftCode;
  trigger: CallInTrigger;
  source: CoverSource | null;
  responseMinutes: number | null;
  late: boolean;
}

export interface DashboardRequest {
  leave: LeaveView;
  /** Dates where granting this would leave a console shift uncovered. */
  breaksCoverage: string[];
}

export interface Dashboard {
  today: string;
  month: string;
  quarter: { from: string; to: string };
  cycle: { from: string; to: string };
  rules: ShiftRules;
  now: DashboardNow;
  /** The next 14 days: gaps, doubles, nobody on call, and dates not generated yet. */
  coverage: { issues: Violation[]; ungenerated: string[] };
  restWarnings: Violation[];
  lines: DashboardLine[];
  callIns: DashboardCallIn[];
  callInRate: number | null;
  requests: DashboardRequest[];
  /** How the console plan was delivered, month to date. */
  reliability: { slots: number; asPlanned: number; callIn: number; cover: number; overtime: number; gaps: number; unconfirmed: number };
  /** TRC hours worked against the weekly target, month to date. */
  utilization: number | null;
  /** Spread between TRCs over the quarter, and night weeks between drivers. */
  fairness: { nights: number; weekends: number; holidays: number; callIns: number; driverNights: number };
  /** Project Coordinators this month: weekdays as the fallback, console covers, and desk days lost to them. */
  fallbackLoad: { fallbackDays: number; covers: number; deskDaysLost: number };
  /** Working days this month so far with one day and one night driver, of those with drivers rostered. */
  driverCoverage: { met: number; total: number };
  /** Call-ins per TRC per cycle in each of the last three months; above 1.0 two months running is a hiring signal. */
  hiring: { months: Array<{ month: string; rate: number | null; pcCovers: number }>; signal: boolean };
  months: MonthView[];
  compliance: AuditView[];
}
