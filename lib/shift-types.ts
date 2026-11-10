/**
 * Shapes the shift-planning APIs return, and the small helpers both sides
 * need to read them. Client-safe: types and pure functions only.
 */

import type {
  CallInTrigger,
  CellLookup,
  LeaveType,
  LineRole,
  LineTotals,
  PayrollTotals,
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
  role: LineRole;
  contractHoursPerWeek: number;
  leaveEntitlementDays: number;
  leaveOpeningBalance: number;
  sortOrder: number;
}

export interface CallInView {
  id: number;
  trigger: CallInTrigger;
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
  plannedCode: ShiftCode;
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
  };
}

export function recordKey(lineId: number, date: string): string {
  return `${lineId}|${date}`;
}

export function indexRecords(records: RecordView[]): Map<string, RecordView> {
  return new Map(records.map((r) => [recordKey(r.lineId, r.date), r]));
}

/** A rules lookup over saved records, with optional cells replaced (a draft). */
export function buildLookup(
  records: Map<string, RecordView>,
  patches?: ReadonlyMap<string, Partial<RosterCell>>,
): CellLookup {
  return (lineId, date) => {
    const key = recordKey(lineId, date);
    const record = records.get(key);
    if (!record) return null;
    const cell = cellOfRecord(record);
    const patch = patches?.get(key);
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
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  shiftsCharged: number;
  note: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface LeaveBalance {
  entitlement: number;
  opening: number;
  accrued: number;
  /** Shifts charged to approved annual leave this year. */
  taken: number;
  /** Shifts a pending request would charge. */
  pending: number;
  balance: number;
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
  code: ShiftCode;
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
  nextHandover: { date: string; time: string } | null;
}

export interface DashboardLine {
  lineId: number;
  code: string;
  name: string;
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
  code: ShiftCode;
  trigger: CallInTrigger;
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
  reliability: { slots: number; asPlanned: number; callIn: number; gaps: number; unconfirmed: number };
  utilization: number | null;
  fairness: { nights: number; weekends: number; holidays: number };
  months: MonthView[];
  compliance: AuditView[];
}
