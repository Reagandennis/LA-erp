import 'server-only';

import { Prisma } from '@prisma/client';

import { APP_LOCALE } from './locale';
import { prisma } from './prisma';
import {
  CALL_IN_TRIGGERS,
  CODE_KIND,
  DEFAULT_RULES,
  LEAVE_TYPES,
  LINE_ROLES,
  type CallInTrigger,
  type GeneratedCheck,
  type LeaveType,
  type LineRole,
  type RecordStatus,
  type RosterCell,
  type ShiftCode,
  type ShiftRules,
  type Violation,
  addDays,
  addMonths,
  baseOf,
  codeDef,
  datesBetween,
  emptyTotals,
  extraOf,
  generatedCode,
  isConsole,
  isDateKey,
  isMonthKey,
  isRecordStatus,
  isRosterCode,
  isShiftCode,
  isTimeOfDay,
  isWorking,
  leaveAccrued,
  lineOnRoster,
  lineTotals,
  monthEnd,
  monthOf,
  monthStart,
  newViolations,
  resolveCell,
  sanitizeRules,
  spanHours,
  validateRoster,
  writtenCodes,
  zonedNow,
} from './shift-rules';
import {
  type ExistingCell,
  type ImportCodeChoices,
  type ImportPreview,
  type ImportResult,
  type ImportTarget,
  type NamedSheet,
  checkImport,
  newLineCodes,
  personName,
  planRosterImport,
  readRosterWorkbook,
  rosterTemplate,
  withNewCodes,
} from './shift-import';
import {
  type AdminOverview,
  type AuditView,
  type CallInView,
  type ChangeInput,
  type HolidayView,
  type LeaveBalance,
  type LeaveStatus,
  type LeaveView,
  type LineView,
  type MonthView,
  type MyShifts,
  type RecordView,
  type SaveResult,
  type TeamRoster,
  type UserOption,
  buildLookup,
  cellOfRecord,
  indexRecords,
  recordKey,
  writtenCode,
} from './shift-types';

/**
 * Shift planning: the roster's data layer.
 *
 * The rules themselves (rotation, duties, validation) are pure functions in
 * lib/shift-rules.ts; this file loads rows, runs those rules, and writes — with
 * an audit entry beside every write. Nothing else touches the Shift* tables.
 */

export interface Actor {
  id: number;
  name: string;
}

/** A problem to show the person as-is (a 400), not a bug. */
export class RosterError extends Error {}

type Db = Prisma.TransactionClient | typeof prisma;

const MAX_CHANGES = 400;

// --- Rules -------------------------------------------------------------------

/** The roster's own codes are kept with the built-in ones, in the `codes` column. */
const EXTRA_KEY = 'extra';

export async function getRules(db: Db = prisma): Promise<ShiftRules> {
  const row = await db.shiftConfig.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_RULES;
  const stored = (row.codes && typeof row.codes === 'object' ? row.codes : {}) as Record<string, unknown>;
  try {
    return sanitizeRules({ ...row, extra: stored[EXTRA_KEY] ?? [] }, DEFAULT_RULES);
  } catch {
    try {
      // One bad code of the roster's own must not throw away the whole configuration.
      return sanitizeRules({ ...row, extra: [] }, DEFAULT_RULES);
    } catch {
      return DEFAULT_RULES;
    }
  }
}

/** The rules as the ShiftConfig row holds them. */
function configData(rules: ShiftRules, actorId: number) {
  const { extra, codes, ...columns } = rules;
  return { ...columns, codes: { ...codes, [EXTRA_KEY]: extra } as unknown as Prisma.InputJsonValue, updatedById: actorId };
}

async function writeRules(db: Db, rules: ShiftRules, actorId: number): Promise<void> {
  const data = configData(rules, actorId);
  await db.shiftConfig.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

export async function saveRules(actor: Actor, input: unknown): Promise<ShiftRules> {
  const before = await getRules();
  let rules: ShiftRules;
  try {
    rules = sanitizeRules(input, before);
  } catch (error) {
    throw new RosterError(error instanceof Error ? error.message : 'Invalid settings.');
  }
  // A code that is on the roster cannot be taken away from under it.
  const dropped = before.extra.filter((old) => !rules.extra.some((extra) => extra.code === old.code)).map((old) => old.code);
  for (const code of dropped) {
    const count = await prisma.shiftRecord.count({ where: { OR: [{ plannedCode: code }, { generatedCode: code }] } });
    if (count > 0) throw new RosterError(`${code} is on the roster (${count} shift${count === 1 ? '' : 's'}), so it cannot be removed. Change those shifts first.`);
  }
  await prisma.$transaction(async (tx) => {
    await writeRules(tx, rules, actor.id);
    const changed = (Object.keys(rules) as Array<keyof ShiftRules>).filter(
      (key) => JSON.stringify(rules[key]) !== JSON.stringify(before[key]),
    );
    await audit(tx, actor, {
      action: 'config',
      summary: changed.length ? `Changed rules: ${changed.join(', ')}` : 'Saved rules (no changes)',
      detail: { before: pickKeys(before, changed), after: pickKeys(rules, changed) },
    });
  });
  return rules;
}

function pickKeys<T extends object>(source: T, keys: Array<keyof T>): Partial<T> {
  const out: Partial<T> = {};
  for (const key of keys) out[key] = source[key];
  return out;
}

// --- Audit -------------------------------------------------------------------

interface AuditInput {
  action: string;
  summary: string;
  month?: string | null;
  lineCode?: string | null;
  date?: string | null;
  detail?: unknown;
  blockOverridden?: boolean;
}

async function audit(db: Db, actor: Actor, input: AuditInput): Promise<void> {
  await db.shiftAudit.create({
    data: {
      action: input.action,
      actorId: actor.id,
      actorName: actor.name,
      month: input.month ?? null,
      lineCode: input.lineCode ?? null,
      date: input.date ?? null,
      summary: input.summary.slice(0, 500),
      detail: input.detail === undefined ? undefined : (input.detail as Prisma.InputJsonValue),
      blockOverridden: input.blockOverridden ?? false,
    },
  });
}

function auditView(row: {
  id: number;
  action: string;
  actorName: string;
  month: string | null;
  lineCode: string | null;
  date: string | null;
  summary: string;
  detail: unknown;
  blockOverridden: boolean;
  createdAt: Date;
}): AuditView {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export async function listAudit(options: { limit?: number; before?: number | null; compliance?: boolean } = {}): Promise<AuditView[]> {
  const rows = await prisma.shiftAudit.findMany({
    where: {
      ...(options.before ? { id: { lt: options.before } } : {}),
      ...(options.compliance ? { blockOverridden: true } : {}),
    },
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(options.limit ?? 100, 1), 200),
  });
  return rows.map(auditView);
}

// --- Lines -------------------------------------------------------------------

const LINE_INCLUDE = { user: { select: { id: true, name: true, email: true } } } as const;
type LineRow = Prisma.ShiftLineGetPayload<{ include: typeof LINE_INCLUDE }>;

function lineView(row: LineRow): LineView {
  return {
    id: row.id,
    code: row.code,
    userId: row.userId,
    name: row.user?.name ?? row.displayName ?? row.code,
    email: row.user?.email ?? null,
    displayName: row.displayName,
    role: (LINE_ROLES as readonly string[]).includes(row.role) ? (row.role as LineRole) : 'line',
    cycleOffset: row.cycleOffset,
    startDate: row.startDate,
    endDate: row.endDate,
    contractHoursPerWeek: row.contractHoursPerWeek,
    leaveEntitlementDays: row.leaveEntitlementDays,
    leaveOpeningBalance: row.leaveOpeningBalance,
    active: row.active,
    sortOrder: row.sortOrder,
  };
}

export async function listLines(db: Db = prisma): Promise<LineView[]> {
  const rows = await db.shiftLine.findMany({ include: LINE_INCLUDE, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  return rows.map(lineView);
}

export async function lineForUser(userId: number): Promise<LineView | null> {
  const row = await prisma.shiftLine.findUnique({ where: { userId }, include: LINE_INCLUDE });
  return row ? lineView(row) : null;
}

export async function listUserOptions(): Promise<UserOption[]> {
  const [users, lines] = await Promise.all([
    prisma.user.findMany({ where: { status: 'active' }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true } }),
    prisma.shiftLine.findMany({ where: { userId: { not: null } }, select: { id: true, userId: true } }),
  ]);
  const linked = new Map(lines.map((l) => [l.userId as number, l.id]));
  return users.map((u) => ({ ...u, lineId: linked.get(u.id) ?? null }));
}

export interface LineInput {
  code?: unknown;
  userId?: unknown;
  displayName?: unknown;
  role?: unknown;
  cycleOffset?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  contractHoursPerWeek?: unknown;
  leaveEntitlementDays?: unknown;
  leaveOpeningBalance?: unknown;
  active?: unknown;
  sortOrder?: unknown;
}

function optionalDate(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isDateKey(value)) throw new RosterError(`${label} must be a date.`);
  return value;
}

function numberBetween(value: unknown, min: number, max: number, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new RosterError(`${label} must be between ${min} and ${max}.`);
  return n;
}

/** Turns a form into column values; only the keys present are returned. */
async function lineData(input: LineInput, rules: ShiftRules, selfId: number | null) {
  const data: Prisma.ShiftLineUncheckedUpdateInput = {};

  if ('code' in input) {
    const code = String(input.code ?? '').trim();
    if (!code || code.length > 20) throw new RosterError('The roster code is required (up to 20 characters).');
    const clash = await prisma.shiftLine.findUnique({ where: { code }, select: { id: true } });
    if (clash && clash.id !== selfId) throw new RosterError(`${code} is already on the roster.`);
    data.code = code;
  }
  if ('userId' in input) {
    if (input.userId === null || input.userId === '' || input.userId === undefined) {
      data.userId = null;
    } else {
      const userId = Number(input.userId);
      const user = Number.isInteger(userId) ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }) : null;
      if (!user) throw new RosterError('That login account no longer exists.');
      const taken = await prisma.shiftLine.findUnique({ where: { userId }, select: { id: true, code: true } });
      if (taken && taken.id !== selfId) throw new RosterError(`That account is already linked to ${taken.code}.`);
      data.userId = userId;
    }
  }
  if ('displayName' in input) data.displayName = String(input.displayName ?? '').trim().slice(0, 80) || null;
  if ('role' in input) {
    if (!(LINE_ROLES as readonly unknown[]).includes(input.role)) throw new RosterError('Unknown role.');
    data.role = input.role as LineRole;
  }
  if ('cycleOffset' in input) {
    if (input.cycleOffset === null || input.cycleOffset === '' || input.cycleOffset === undefined) {
      data.cycleOffset = null;
    } else {
      const offset = Number(input.cycleOffset);
      if (!Number.isInteger(offset) || offset < 0 || offset >= rules.pattern.length) {
        throw new RosterError(`The starting cycle day must be between 1 and ${rules.pattern.length}.`);
      }
      data.cycleOffset = offset;
    }
  }
  if ('startDate' in input) data.startDate = optionalDate(input.startDate, 'Start date');
  if ('endDate' in input) data.endDate = optionalDate(input.endDate, 'End date');
  if (typeof data.startDate === 'string' && typeof data.endDate === 'string' && data.endDate < data.startDate) {
    throw new RosterError('The end date is before the start date.');
  }
  if ('contractHoursPerWeek' in input) data.contractHoursPerWeek = numberBetween(input.contractHoursPerWeek, 0, 168, 'Contract hours');
  if ('leaveEntitlementDays' in input) data.leaveEntitlementDays = numberBetween(input.leaveEntitlementDays, 0, 365, 'Leave entitlement');
  if ('leaveOpeningBalance' in input) data.leaveOpeningBalance = numberBetween(input.leaveOpeningBalance, -365, 365, 'Opening balance');
  if ('active' in input) data.active = Boolean(input.active);
  if ('sortOrder' in input) data.sortOrder = Math.round(numberBetween(input.sortOrder, 0, 9999, 'Order'));
  return data;
}

export async function createLine(actor: Actor, input: LineInput): Promise<LineView> {
  const rules = await getRules();
  const data = await lineData({ code: input.code, ...input }, rules, null);
  const last = await prisma.shiftLine.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.shiftLine.create({
      data: { ...(data as Prisma.ShiftLineUncheckedCreateInput), sortOrder: (last._max.sortOrder ?? 0) + 1 },
      include: LINE_INCLUDE,
    });
    await audit(tx, actor, { action: 'line', lineCode: created.code, summary: `Added ${created.code} to the roster`, detail: data });
    return created;
  });
  return lineView(row);
}

export async function updateLine(actor: Actor, id: number, input: LineInput): Promise<LineView | null> {
  const existing = await prisma.shiftLine.findUnique({ where: { id } });
  if (!existing) return null;
  const rules = await getRules();
  const data = await lineData(input, rules, id);
  const start = 'startDate' in data ? (data.startDate as string | null) : existing.startDate;
  const end = 'endDate' in data ? (data.endDate as string | null) : existing.endDate;
  if (start && end && end < start) throw new RosterError('The end date is before the start date.');
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.shiftLine.update({ where: { id }, data, include: LINE_INCLUDE });
    await audit(tx, actor, { action: 'line', lineCode: updated.code, summary: `Updated ${updated.code}`, detail: data });
    return updated;
  });
  return lineView(row);
}

/** Removes a line with no roster history; one that has worked is made inactive instead. */
export async function deleteLine(actor: Actor, id: number): Promise<boolean> {
  const existing = await prisma.shiftLine.findUnique({ where: { id }, select: { id: true, code: true } });
  if (!existing) return false;
  const history = await prisma.shiftRecord.count({ where: { lineId: id } });
  if (history > 0) {
    throw new RosterError(`${existing.code} has roster history. Set an end date or make the line inactive instead.`);
  }
  await prisma.$transaction(async (tx) => {
    await tx.shiftLine.delete({ where: { id } });
    await audit(tx, actor, { action: 'line', lineCode: existing.code, summary: `Removed ${existing.code} from the roster` });
  });
  return true;
}

// --- Holidays ----------------------------------------------------------------

export async function listHolidays(from?: string, to?: string): Promise<HolidayView[]> {
  const rows = await prisma.publicHoliday.findMany({
    where: from && to ? { date: { gte: from, lte: to } } : undefined,
    orderBy: { date: 'asc' },
    select: { id: true, date: true, name: true, country: true },
  });
  return rows;
}

export async function addHoliday(actor: Actor, input: { date?: unknown; name?: unknown; country?: unknown }): Promise<HolidayView> {
  if (!isDateKey(input.date)) throw new RosterError('Pick the holiday date.');
  const name = String(input.name ?? '').trim().slice(0, 80);
  if (!name) throw new RosterError('Name the holiday.');
  const country = String(input.country ?? 'KE').trim().toUpperCase().slice(0, 2) || 'KE';
  const clash = await prisma.publicHoliday.findUnique({ where: { date: input.date }, select: { name: true } });
  if (clash) throw new RosterError(`${clash.name} is already on that date.`);
  const date = input.date;
  return prisma.$transaction(async (tx) => {
    const row = await tx.publicHoliday.create({
      data: { date, name, country, createdById: actor.id },
      select: { id: true, date: true, name: true, country: true },
    });
    await audit(tx, actor, { action: 'holiday', date, month: monthOf(date), summary: `Added public holiday ${name}` });
    return row;
  });
}

export async function removeHoliday(actor: Actor, id: string): Promise<boolean> {
  const existing = await prisma.publicHoliday.findUnique({ where: { id } });
  if (!existing) return false;
  await prisma.$transaction(async (tx) => {
    await tx.publicHoliday.delete({ where: { id } });
    await audit(tx, actor, { action: 'holiday', date: existing.date, month: monthOf(existing.date), summary: `Removed public holiday ${existing.name}` });
  });
  return true;
}

// --- Records -----------------------------------------------------------------

const RECORD_INCLUDE = { callIn: true } as const;
type RecordRow = Prisma.ShiftRecordGetPayload<{ include: typeof RECORD_INCLUDE }>;

function callInView(row: NonNullable<RecordRow['callIn']>): CallInView {
  return {
    id: row.id,
    trigger: (CALL_IN_TRIGGERS as readonly string[]).includes(row.trigger) ? (row.trigger as CallInTrigger) : 'absence',
    calledAt: row.calledAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    arrivedAt: row.arrivedAt?.toISOString() ?? null,
    releasedAt: row.releasedAt?.toISOString() ?? null,
    responseMinutes: row.responseMinutes,
    escalation: row.escalationApprovedById !== null,
    note: row.note,
  };
}

/** A saved row as the app reads it: each code as the built-in one it counts as, the plan's own code beside it. */
function recordView(rules: ShiftRules, row: RecordRow): RecordView {
  const code = (value: string): ShiftCode => baseOf(rules, value) ?? 'X';
  return {
    id: row.id,
    lineId: row.lineId,
    date: row.date,
    generatedCode: code(row.generatedCode),
    plannedCode: code(row.plannedCode),
    label: extraOf(rules, row.plannedCode)?.code ?? null,
    workedCode: row.workedCode ? baseOf(rules, row.workedCode) : null,
    status: isRecordStatus(row.status) ? row.status : 'planned',
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    hoursWorked: row.hoursWorked,
    reasonCode: row.reasonCode,
    note: row.note,
    leaveId: row.leaveId,
    callIn: row.callIn ? callInView(row.callIn) : null,
  };
}

export async function loadRecords(db: Db, from: string, to: string, lineId?: number, rules?: ShiftRules): Promise<RecordView[]> {
  const [rows, known] = await Promise.all([
    db.shiftRecord.findMany({
      where: { date: { gte: from, lte: to }, ...(lineId ? { lineId } : {}) },
      include: RECORD_INCLUDE,
      orderBy: [{ date: 'asc' }, { lineId: 'asc' }],
    }),
    rules ? Promise.resolve(rules) : getRules(db),
  ]);
  return rows.map((row) => recordView(known, row));
}

/** The hours a written code is rostered for; none for on call, rest and leave. */
function plannedTimes(rules: ShiftRules, written: string): { plannedStart: string | null; plannedEnd: string | null } {
  const base = baseOf(rules, written);
  if (!base || !isWorking(base)) return { plannedStart: null, plannedEnd: null };
  const def = codeDef(rules, base, written);
  return { plannedStart: def.start, plannedEnd: def.end };
}

function monthLabel(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(APP_LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(APP_LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// --- Months ------------------------------------------------------------------

function monthView(
  rules: ShiftRules,
  month: string,
  row: { status: string; generatedAt: Date; publishedAt: Date | null } | null,
): MonthView {
  return {
    month,
    status: !row ? 'none' : row.status === 'published' ? 'published' : 'draft',
    generatedAt: row?.generatedAt.toISOString() ?? null,
    publishedAt: row?.publishedAt?.toISOString() ?? null,
    publishDue: addDays(monthStart(month), -rules.publishLeadDays),
  };
}

export async function getMonth(month: string, rules?: ShiftRules): Promise<MonthView> {
  const [row, resolved] = await Promise.all([
    prisma.shiftMonth.findUnique({ where: { month } }),
    rules ? Promise.resolve(rules) : getRules(),
  ]);
  return monthView(resolved, month, row);
}

/** Which months between two dates have been generated, as a check for the rules. */
export async function generatedMonths(db: Db, from: string, to: string): Promise<string[]> {
  const rows = await db.shiftMonth.findMany({ where: { month: { gte: monthOf(from), lte: monthOf(to) } }, select: { month: true } });
  return rows.map((r) => r.month);
}

export function generatedCheck(months: string[]): GeneratedCheck {
  const set = new Set(months);
  return (date) => set.has(monthOf(date));
}

async function publishedMonths(months: string[]): Promise<Set<string>> {
  const rows = await prisma.shiftMonth.findMany({ where: { month: { in: months }, status: 'published' }, select: { month: true } });
  return new Set(rows.map((r) => r.month));
}

function assertMonth(month: unknown): asserts month is string {
  if (!isMonthKey(month)) throw new RosterError('Pick a month.');
}

/**
 * Creates the month's records from the rotation. Safe to run again: it only
 * fills what is missing (a person added since), unless `reset` is asked for,
 * which discards every manual change in a draft month and starts over.
 */
export async function generateMonth(actor: Actor, month: string, options: { reset?: boolean } = {}): Promise<MonthView> {
  assertMonth(month);
  const rules = await getRules();
  const lines = (await listLines()).filter((line) => line.active && line.cycleOffset !== null);
  if (lines.length === 0) throw new RosterError('Add people to the rotation before generating a month.');
  const from = monthStart(month);
  const to = monthEnd(month);

  const row = await prisma.$transaction(async (tx) => {
    const existing = await tx.shiftMonth.findUnique({ where: { month } });
    if (options.reset) {
      if (existing?.status === 'published') throw new RosterError('Unpublish the month before resetting it.');
      const actuals = await tx.shiftRecord.count({
        where: { date: { gte: from, lte: to }, status: { in: ['worked', 'sick', 'no-show', 'call-in'] } },
      });
      if (actuals > 0) throw new RosterError('This month has recorded actuals, so it cannot be reset.');
      await tx.shiftRecord.deleteMany({ where: { date: { gte: from, lte: to } } });
    }

    const data: Prisma.ShiftRecordCreateManyInput[] = [];
    for (const line of lines) {
      for (const date of datesBetween(from, to)) {
        if (!lineOnRoster(line, date)) continue;
        const cell = resolveCell(rules, line, date, () => null);
        if (!cell) continue;
        data.push({ lineId: line.id, date, generatedCode: cell.generated, plannedCode: cell.planned, ...plannedTimes(rules, cell.planned) });
      }
    }
    const created = await tx.shiftRecord.createMany({ data, skipDuplicates: true });

    const saved = await tx.shiftMonth.upsert({
      where: { month },
      create: { month, generatedById: actor.id },
      update: options.reset ? { generatedAt: new Date(), generatedById: actor.id } : {},
    });

    // Leave approved before the month existed lands on it now.
    const leaves = await tx.shiftLeave.findMany({ where: { status: 'approved', startDate: { lte: to }, endDate: { gte: from } } });
    for (const leave of leaves) await applyLeave(tx, rules, leave);

    await audit(tx, actor, {
      action: 'generate',
      month,
      summary: `${options.reset ? 'Reset and regenerated' : existing ? 'Filled in' : 'Generated'} ${monthLabel(month)}: ${created.count} shifts across ${lines.length} people`,
      detail: { created: created.count, lines: lines.map((l) => l.code), reset: Boolean(options.reset), pattern: rules.pattern },
    });
    return saved;
  });
  return monthView(rules, month, row);
}

/** Publishes a month to staff. Blocking problems stop it unless approved through with a reason. */
export async function publishMonth(
  actor: Actor,
  month: string,
  options: { forceReason?: string | null } = {},
): Promise<SaveResult> {
  assertMonth(month);
  const rules = await getRules();
  const existing = await prisma.shiftMonth.findUnique({ where: { month } });
  if (!existing) throw new RosterError('Generate the month before publishing it.');

  const from = monthStart(month);
  const to = monthEnd(month);
  const [lines, records, months] = await Promise.all([
    listLines(),
    loadRecords(prisma, addDays(from, -14), to),
    generatedMonths(prisma, addDays(from, -14), to),
  ]);
  const violations = validateRoster(rules, lines, buildLookup(indexRecords(records)), from, to, generatedCheck(months));
  const blocks = violations.filter((v) => v.severity === 'block');
  const warnings = violations.filter((v) => v.severity === 'warn');
  const reason = options.forceReason?.trim() ?? '';
  if (blocks.length > 0 && !reason) return { saved: false, blocks, warnings };

  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.shiftMonth.update({
      where: { month },
      data: { status: 'published', publishedAt: new Date(), publishedById: actor.id },
    });
    await audit(tx, actor, {
      action: 'publish',
      month,
      summary: `Published ${monthLabel(month)}${blocks.length ? ` with ${blocks.length} blocking problem${blocks.length === 1 ? '' : 's'} approved` : ''}`,
      detail: { blocks: blocks.map((v) => v.message), warnings: warnings.map((v) => v.message), reason: reason || null },
      blockOverridden: blocks.length > 0,
    });
    return saved;
  });
  return { saved: true, blocks, warnings, month: monthView(rules, month, row) };
}

export async function unpublishMonth(actor: Actor, month: string): Promise<MonthView> {
  assertMonth(month);
  const rules = await getRules();
  const existing = await prisma.shiftMonth.findUnique({ where: { month } });
  if (!existing) throw new RosterError('That month has not been generated.');
  const row = await prisma.$transaction(async (tx) => {
    const saved = await tx.shiftMonth.update({ where: { month }, data: { status: 'draft', publishedAt: null, publishedById: null } });
    await audit(tx, actor, { action: 'unpublish', month, summary: `Unpublished ${monthLabel(month)}; staff can no longer see it` });
    return saved;
  });
  return monthView(rules, month, row);
}

// --- Checking a change against the rules --------------------------------------

interface Checked {
  blocks: Violation[];
  warnings: Violation[];
  /** True when the save may go ahead. */
  allowed: boolean;
}

/**
 * Runs every rule before and after a set of cell changes and reports only what
 * the change introduces, so a roster that already has a problem can still be
 * edited towards fixing it.
 */
function checkChange(
  rules: ShiftRules,
  lines: LineView[],
  records: Map<string, RecordView>,
  patches: Map<string, Partial<RosterCell>>,
  dates: string[],
  options: { confirmWarnings?: boolean; forceReason?: string | null },
  generated: GeneratedCheck,
): Checked {
  const sorted = [...dates].sort();
  const from = sorted[0] as string;
  const to = addDays(sorted[sorted.length - 1] as string, 13);
  const before = validateRoster(rules, lines, buildLookup(records), from, to, generated);
  const after = validateRoster(rules, lines, buildLookup(records, patches), from, to, generated);
  const fresh = newViolations(before, after);
  const blocks = fresh.filter((v) => v.severity === 'block');
  const warnings = fresh.filter((v) => v.severity === 'warn');
  const forced = Boolean(options.forceReason?.trim());
  const allowed = blocks.length > 0 ? forced : warnings.length === 0 || Boolean(options.confirmWarnings) || forced;
  return { blocks, warnings, allowed };
}

async function loadWindow(dates: string[]) {
  const sorted = [...dates].sort();
  const from = addDays(sorted[0] as string, -14);
  const to = addDays(sorted[sorted.length - 1] as string, 14);
  const [rules, lines, records, months] = await Promise.all([
    getRules(),
    listLines(),
    loadRecords(prisma, from, to),
    generatedMonths(prisma, from, to),
  ]);
  return { rules, lines, records: indexRecords(records), generated: generatedCheck(months) };
}

// --- Overrides and swaps -----------------------------------------------------

export interface ChangeOptions {
  reason?: string | null;
  kind?: 'override' | 'swap';
  confirmWarnings?: boolean;
  forceReason?: string | null;
}

/**
 * Saves a batch of roster changes as one unit. A batch is what makes cover
 * possible: leave for one person and the shift handed to another are valid
 * together where neither is alone.
 */
export async function applyChanges(actor: Actor, input: ChangeInput[], options: ChangeOptions = {}): Promise<SaveResult> {
  if (!Array.isArray(input) || input.length === 0) throw new RosterError('There is nothing to save.');
  if (input.length > MAX_CHANGES) throw new RosterError('Too many changes in one save.');
  const seen = new Set<string>();
  for (const change of input) {
    if (!Number.isInteger(change?.lineId) || !isDateKey(change?.date) || typeof change?.code !== 'string') {
      throw new RosterError('One of the changes is not valid.');
    }
    const key = recordKey(change.lineId, change.date);
    if (seen.has(key)) throw new RosterError('The same shift is changed twice.');
    seen.add(key);
  }

  const { rules, lines, records, generated } = await loadWindow(input.map((c) => c.date));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  /** `code` is as written; `base` is the built-in code it counts as. */
  const effective: Array<{ record: RecordView; code: string; base: ShiftCode; line: LineView }> = [];
  /** Days with nothing rostered that the change fills in. */
  const filling: Array<{ date: string; code: string; base: ShiftCode; line: LineView; generated: string }> = [];
  for (const change of input) {
    const base = baseOf(rules, change.code);
    if (!base) throw new RosterError(`${change.code} is not a code this roster uses.`);
    const record = records.get(recordKey(change.lineId, change.date));
    const line = lineById.get(change.lineId);
    if (!line) throw new RosterError('That person is no longer on the roster.');
    if (!record) {
      // A blank day in a month that exists: someone who joined after it was built, or a roster uploaded in part.
      if (!generated(change.date)) throw new RosterError(`Nothing is rostered on ${dayLabel(change.date)} yet. Generate the month first.`);
      if (!lineOnRoster(line, change.date)) {
        throw new RosterError(`${line.code} is not on the roster on ${dayLabel(change.date)}. Check their start and end dates, and that they are active.`);
      }
      // What the rotation would have given is kept beside it, as for every other day.
      filling.push({ date: change.date, code: change.code, base, line, generated: line.cycleOffset !== null ? generatedCode(rules, line.cycleOffset, change.date) : change.code });
      continue;
    }
    if (record.callIn || ['worked', 'sick', 'no-show', 'call-in'].includes(record.status)) {
      throw new RosterError(`${line.code} on ${dayLabel(change.date)} has recorded actuals. Clear them before changing the plan.`);
    }
    if (writtenCode(record) !== change.code) effective.push({ record, code: change.code, base, line });
  }
  if (effective.length === 0 && filling.length === 0) return { saved: true, blocks: [], warnings: [], records: [] };

  const patches = new Map<string, Partial<RosterCell>>();
  for (const { record, code, base } of effective) {
    patches.set(recordKey(record.lineId, record.date), { planned: base, label: extraOf(rules, code)?.code ?? null });
  }
  for (const fill of filling) {
    patches.set(recordKey(fill.line.id, fill.date), {
      generated: baseOf(rules, fill.generated) ?? fill.base,
      planned: fill.base,
      status: fill.base === 'LV' ? 'leave' : 'planned',
      label: extraOf(rules, fill.code)?.code ?? null,
    });
  }
  const check = checkChange(rules, lines, records, patches, [...effective.map((e) => e.record.date), ...filling.map((f) => f.date)], options, generated);
  if (!check.allowed) return { saved: false, blocks: check.blocks, warnings: check.warnings };

  const kind = options.kind === 'swap' ? 'swap' : 'override';
  const reason = options.reason?.trim().slice(0, 200) || null;
  const saved = await prisma.$transaction(async (tx) => {
    const rows: RecordView[] = [];
    for (const { record, code, base } of effective) {
      const status: RecordStatus = base === 'LV' ? 'leave' : kind === 'swap' ? 'swapped' : 'planned';
      const row = await tx.shiftRecord.update({
        where: { id: record.id },
        data: {
          plannedCode: code,
          status,
          ...plannedTimes(rules, code),
          reasonCode: reason,
          approvedById: actor.id,
          updatedById: actor.id,
          // A manual change takes the cell out of any leave that put LV there.
          leaveId: base === 'LV' ? record.leaveId : null,
        },
        include: RECORD_INCLUDE,
      });
      rows.push(recordView(rules, row));
    }
    for (const fill of filling) {
      const row = await tx.shiftRecord.create({
        data: {
          lineId: fill.line.id,
          date: fill.date,
          generatedCode: fill.generated,
          plannedCode: fill.code,
          status: fill.base === 'LV' ? 'leave' : 'planned',
          ...plannedTimes(rules, fill.code),
          reasonCode: reason,
          approvedById: actor.id,
          updatedById: actor.id,
        },
        include: RECORD_INCLUDE,
      });
      rows.push(recordView(rules, row));
    }
    const all = [
      ...effective.map((e) => ({ line: e.line.code, date: e.record.date, generated: e.record.generatedCode as string, from: writtenCode(e.record) as string | null, to: e.code })),
      ...filling.map((f) => ({ line: f.line.code, date: f.date, generated: f.generated, from: null as string | null, to: f.code })),
    ];
    const first = all[0] as (typeof all)[number];
    await audit(tx, actor, {
      action: kind,
      month: monthOf(first.date),
      date: first.date,
      lineCode: all.length === 1 ? first.line : null,
      summary: all.map((change) => `${change.line} ${dayLabel(change.date)} ${change.from ?? 'blank'}→${change.to}`).join('; '),
      detail: {
        changes: all,
        reason,
        warnings: check.warnings.map((v) => v.message),
        blocks: check.blocks.map((v) => v.message),
        forceReason: options.forceReason?.trim() || null,
      },
      blockOverridden: check.blocks.length > 0,
    });
    return rows;
  });
  return { saved: true, blocks: check.blocks, warnings: check.warnings, records: saved };
}

// --- Actuals -----------------------------------------------------------------

export interface ActualInput {
  lineId: number;
  date: string;
  /** 'planned' clears what was recorded. */
  status: 'planned' | 'worked' | 'sick' | 'no-show';
  actualStart?: string | null;
  actualEnd?: string | null;
  note?: string | null;
}

/** Records what happened on a rostered shift. The plan is never overwritten. */
export async function recordActual(actor: Actor, input: ActualInput): Promise<RecordView> {
  if (!['planned', 'worked', 'sick', 'no-show'].includes(input.status)) throw new RosterError('Unknown status.');
  const row = await prisma.shiftRecord.findUnique({
    where: { lineId_date: { lineId: input.lineId, date: input.date } },
    include: { ...RECORD_INCLUDE, line: { select: { code: true } } },
  });
  if (!row) throw new RosterError('Nothing is rostered there.');
  if (row.callIn) throw new RosterError('This day has a call-in. Edit or cancel the call-in instead.');
  const rules = await getRules();
  const planned = baseOf(rules, row.plannedCode);
  if (!planned || !isWorking(planned)) {
    throw new RosterError('Only a rostered shift can be marked worked, sick or no-show.');
  }
  const start = input.actualStart || null;
  const end = input.actualEnd || null;
  if ((start && !isTimeOfDay(start)) || (end && !isTimeOfDay(end))) throw new RosterError('Times must be HH:MM.');
  if (Boolean(start) !== Boolean(end)) throw new RosterError('Give both the actual start and finish, or neither.');

  const worked = input.status === 'worked';
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.shiftRecord.update({
      where: { id: row.id },
      data: {
        status: input.status,
        actualStart: worked ? start : null,
        actualEnd: worked ? end : null,
        hoursWorked: worked && start && end ? spanHours(start, end) : null,
        note: input.note?.trim().slice(0, 300) || null,
        updatedById: actor.id,
      },
      include: RECORD_INCLUDE,
    });
    await audit(tx, actor, {
      action: 'actual',
      month: monthOf(row.date),
      date: row.date,
      lineCode: row.line.code,
      summary: `${row.line.code} ${dayLabel(row.date)} ${row.plannedCode}: ${row.status} → ${input.status}`,
      detail: { from: row.status, to: input.status, actualStart: start, actualEnd: end },
    });
    return updated;
  });
  return recordView(rules, saved);
}

/** Confirms every past console shift in a month that nobody has touched as worked to plan. */
export async function confirmWorked(actor: Actor, month: string): Promise<number> {
  assertMonth(month);
  const rules = await getRules();
  const today = zonedNow(rules.timeZone, Date.now()).date;
  const to = monthEnd(month) < today ? monthEnd(month) : addDays(today, -1);
  if (to < monthStart(month)) return 0;
  return prisma.$transaction(async (tx) => {
    const result = await tx.shiftRecord.updateMany({
      where: { date: { gte: monthStart(month), lte: to }, status: { in: ['planned', 'swapped'] }, plannedCode: { in: writtenCodes(rules, isWorking) } },
      data: { status: 'worked', updatedById: actor.id },
    });
    if (result.count > 0) {
      await audit(tx, actor, {
        action: 'actual',
        month,
        summary: `Confirmed ${result.count} shift${result.count === 1 ? '' : 's'} in ${monthLabel(month)} as worked to plan (up to ${dayLabel(to)})`,
        detail: { count: result.count, through: to },
      });
    }
    return result.count;
  });
}

// --- Call-ins ----------------------------------------------------------------

export interface CallInInput {
  lineId: number;
  date: string;
  code: ShiftCode;
  trigger: CallInTrigger;
  calledAt?: string | null;
  acknowledgedAt?: string | null;
  arrivedAt?: string | null;
  releasedAt?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  /** Required to call someone in from a rest day. */
  escalationApproved?: boolean;
  note?: string | null;
  confirmWarnings?: boolean;
  forceReason?: string | null;
}

function optionalInstant(value: unknown, label: string): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new RosterError(`${label} is not a valid time.`);
  return date;
}

/**
 * Brings an on-call (or resting) person in. Converts the day to the shift
 * actually covered; the hours count as worked. Saving again edits the call-in.
 */
export async function saveCallIn(actor: Actor, input: CallInInput): Promise<SaveResult> {
  if (!isDateKey(input.date) || !Number.isInteger(input.lineId)) throw new RosterError('Pick the person and date.');
  if (!isShiftCode(input.code) || !isConsole(input.code)) throw new RosterError('Pick the shift being covered.');
  if (!(CALL_IN_TRIGGERS as readonly unknown[]).includes(input.trigger)) throw new RosterError('Pick the reason for the call-in.');
  const start = input.actualStart || null;
  const end = input.actualEnd || null;
  if ((start && !isTimeOfDay(start)) || (end && !isTimeOfDay(end))) throw new RosterError('Times must be HH:MM.');
  if (Boolean(start) !== Boolean(end)) throw new RosterError('Give both the start and finish, or neither.');

  const { rules, lines, records, generated } = await loadWindow([input.date]);
  const key = recordKey(input.lineId, input.date);
  const record = records.get(key);
  const line = lines.find((l) => l.id === input.lineId);
  if (!record || !line) throw new RosterError('Nothing is rostered there. Generate the month first.');
  const kind = CODE_KIND[record.plannedCode];
  if (kind !== 'on_call' && kind !== 'off') {
    throw new RosterError('Only someone on call or on a rest day can be called in.');
  }
  if (kind === 'off' && !input.escalationApproved) {
    throw new RosterError('Calling someone in from a rest day is an overtime escalation and needs approval.');
  }

  const hours = start && end ? spanHours(start, end) : rules.codes[input.code].hours;
  const patches = new Map<string, Partial<RosterCell>>([
    [key, { worked: input.code, status: 'call-in', start, end, hours: start && end ? hours : null }],
  ]);
  const check = checkChange(rules, lines, records, patches, [input.date], input, generated);
  if (!check.allowed) return { saved: false, blocks: check.blocks, warnings: check.warnings };

  const calledAt = optionalInstant(input.calledAt, 'Called at') ?? new Date();
  const arrivedAt = optionalInstant(input.arrivedAt, 'Arrived at');
  const times = {
    trigger: input.trigger,
    calledAt,
    acknowledgedAt: optionalInstant(input.acknowledgedAt, 'Acknowledged at'),
    arrivedAt,
    releasedAt: optionalInstant(input.releasedAt, 'Released at'),
    responseMinutes: arrivedAt ? Math.max(0, Math.round((arrivedAt.getTime() - calledAt.getTime()) / 60_000)) : null,
    escalationApprovedById: kind === 'off' ? actor.id : null,
    note: input.note?.trim().slice(0, 300) || null,
  };

  const saved = await prisma.$transaction(async (tx) => {
    await tx.shiftCallIn.upsert({
      where: { recordId: record.id },
      create: { recordId: record.id, calledById: actor.id, ...times },
      update: times,
    });
    const row = await tx.shiftRecord.update({
      where: { id: record.id },
      data: { workedCode: input.code, status: 'call-in', actualStart: start, actualEnd: end, hoursWorked: hours, updatedById: actor.id },
      include: RECORD_INCLUDE,
    });
    await audit(tx, actor, {
      action: 'call_in',
      month: monthOf(input.date),
      date: input.date,
      lineCode: line.code,
      summary: `${record.callIn ? 'Updated call-in' : 'Called in'} ${line.code} on ${dayLabel(input.date)}: ${record.plannedCode}→${input.code} (${input.trigger.replace('_', ' ')})`,
      detail: {
        planned: record.plannedCode,
        worked: input.code,
        trigger: input.trigger,
        hours,
        responseMinutes: times.responseMinutes,
        escalation: kind === 'off',
        warnings: check.warnings.map((v) => v.message),
        blocks: check.blocks.map((v) => v.message),
        forceReason: input.forceReason?.trim() || null,
      },
      blockOverridden: check.blocks.length > 0,
    });
    return row;
  });
  return { saved: true, blocks: check.blocks, warnings: check.warnings, records: [recordView(rules, saved)] };
}

export async function cancelCallIn(actor: Actor, lineId: number, date: string): Promise<RecordView | null> {
  const row = await prisma.shiftRecord.findUnique({
    where: { lineId_date: { lineId, date } },
    include: { ...RECORD_INCLUDE, line: { select: { code: true } } },
  });
  if (!row?.callIn) return null;
  const saved = await prisma.$transaction(async (tx) => {
    await tx.shiftCallIn.delete({ where: { recordId: row.id } });
    const updated = await tx.shiftRecord.update({
      where: { id: row.id },
      data: { workedCode: null, status: 'planned', actualStart: null, actualEnd: null, hoursWorked: null, updatedById: actor.id },
      include: RECORD_INCLUDE,
    });
    await audit(tx, actor, {
      action: 'call_in',
      month: monthOf(date),
      date,
      lineCode: row.line.code,
      summary: `Cancelled the call-in for ${row.line.code} on ${dayLabel(date)}`,
    });
    return updated;
  });
  return recordView(await getRules(), saved);
}

// --- Leave -------------------------------------------------------------------

type LeaveRow = Prisma.ShiftLeaveGetPayload<{ include: { line: { include: typeof LINE_INCLUDE } } }>;

async function leaveViews(rows: LeaveRow[]): Promise<LeaveView[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter((id): id is number => id !== null))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((row) => ({
    id: row.id,
    lineId: row.lineId,
    lineCode: row.line.code,
    personName: row.line.user?.name ?? row.line.displayName ?? row.line.code,
    type: (LEAVE_TYPES as readonly string[]).includes(row.type) ? (row.type as LeaveType) : 'other',
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as LeaveStatus,
    shiftsCharged: row.shiftsCharged,
    note: row.note,
    requestedByName: row.requestedById ? (names.get(row.requestedById) ?? null) : null,
    decidedByName: row.decidedById ? (names.get(row.decidedById) ?? null) : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

const LEAVE_INCLUDE = { line: { include: LINE_INCLUDE } } as const;

export async function listLeaves(filter: { lineId?: number; from?: string } = {}): Promise<LeaveView[]> {
  const rows = await prisma.shiftLeave.findMany({
    where: { ...(filter.lineId ? { lineId: filter.lineId } : {}), ...(filter.from ? { endDate: { gte: filter.from } } : {}) },
    include: LEAVE_INCLUDE,
    orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
    take: 300,
  });
  return leaveViews(rows);
}

/**
 * Rostered console shifts inside a leave range: what the leave is charged.
 * On-call and rest days are never charged. Uses saved records where a month
 * exists and the rotation where it does not yet.
 */
export async function chargeableDates(db: Db, rules: ShiftRules, line: LineView, start: string, end: string, leaveId: number | null): Promise<string[]> {
  const records = indexRecords(await loadRecords(db, start, end, line.id, rules));
  const out: string[] = [];
  for (const date of datesBetween(start, end)) {
    const record = records.get(recordKey(line.id, date));
    if (record) {
      const chargedHere = leaveId !== null && record.leaveId === leaveId;
      if (chargedHere || (isWorking(record.plannedCode) && !record.callIn && ['planned', 'swapped'].includes(record.status))) out.push(date);
    } else if (line.cycleOffset !== null && lineOnRoster(line, date)) {
      const cell = resolveCell(rules, line, date, () => null);
      if (cell && isConsole(cell.planned)) out.push(date);
    }
  }
  return out;
}

/** Puts LV on the rostered shifts of an approved leave and recounts what it is charged. */
async function applyLeave(tx: Prisma.TransactionClient, rules: ShiftRules, leave: { id: number; lineId: number; startDate: string; endDate: string }): Promise<void> {
  const lineRow = await tx.shiftLine.findUnique({ where: { id: leave.lineId }, include: LINE_INCLUDE });
  if (!lineRow) return;
  const line = lineView(lineRow);
  const charged = await chargeableDates(tx, rules, line, leave.startDate, leave.endDate, leave.id);
  await tx.shiftRecord.updateMany({
    where: {
      lineId: leave.lineId,
      date: { in: charged },
      leaveId: null,
      plannedCode: { in: writtenCodes(rules, isWorking) },
      status: { in: ['planned', 'swapped'] },
    },
    data: { plannedCode: 'LV', status: 'leave', leaveId: leave.id, plannedStart: null, plannedEnd: null },
  });
  await tx.shiftLeave.update({ where: { id: leave.id }, data: { shiftsCharged: charged.length } });
}

/** Hands back the shifts a leave had taken, restoring what the rotation produced. */
async function revertLeave(tx: Prisma.TransactionClient, rules: ShiftRules, leaveId: number): Promise<void> {
  const rows = await tx.shiftRecord.findMany({ where: { leaveId } });
  for (const row of rows) {
    const code = isRosterCode(rules, row.generatedCode) ? row.generatedCode : 'X';
    await tx.shiftRecord.update({
      where: { id: row.id },
      data: { plannedCode: code, status: 'planned', leaveId: null, ...plannedTimes(rules, code) },
    });
  }
}

export interface LeaveInput {
  type?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  note?: unknown;
}

/** A leave request for a roster line; pending until a scheduler decides it. */
export async function requestLeave(actor: Actor, lineId: number, input: LeaveInput): Promise<LeaveView> {
  if (!isDateKey(input.startDate) || !isDateKey(input.endDate)) throw new RosterError('Pick the first and last day of leave.');
  if (input.endDate < input.startDate) throw new RosterError('The last day is before the first.');
  if (datesBetween(input.startDate, input.endDate).length > 92) throw new RosterError('A single request can cover at most three months.');
  const type = (LEAVE_TYPES as readonly unknown[]).includes(input.type) ? (input.type as LeaveType) : 'annual';
  const lineRow = await prisma.shiftLine.findUnique({ where: { id: lineId }, include: LINE_INCLUDE });
  if (!lineRow) throw new RosterError('That person is not on the roster.');
  const overlap = await prisma.shiftLeave.findFirst({
    where: { lineId, status: { in: ['pending', 'approved'] }, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } },
    select: { id: true },
  });
  if (overlap) throw new RosterError('There is already leave requested or approved over those dates.');

  const rules = await getRules();
  const charged = await chargeableDates(prisma, rules, lineView(lineRow), input.startDate, input.endDate, null);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.shiftLeave.create({
      data: {
        lineId,
        type,
        startDate: input.startDate as string,
        endDate: input.endDate as string,
        shiftsCharged: charged.length,
        note: String(input.note ?? '').trim().slice(0, 300) || null,
        requestedById: actor.id,
      },
      include: LEAVE_INCLUDE,
    });
    await audit(tx, actor, {
      action: 'leave',
      lineCode: lineRow.code,
      date: created.startDate,
      month: monthOf(created.startDate),
      summary: `Leave requested for ${lineRow.code}: ${dayLabel(created.startDate)} to ${dayLabel(created.endDate)} (${charged.length} shift${charged.length === 1 ? '' : 's'})`,
    });
    return created;
  });
  return (await leaveViews([row]))[0] as LeaveView;
}

/**
 * Approves, declines or cancels leave. Approving puts LV on the rostered
 * shifts, which opens coverage gaps by design: the result lists them so the
 * scheduler can assign cover on the roster.
 */
export async function decideLeave(
  actor: Actor,
  id: number,
  decision: 'approve' | 'decline' | 'cancel',
): Promise<{ leave: LeaveView; needsCover: Violation[] } | null> {
  const existing = await prisma.shiftLeave.findUnique({ where: { id }, include: LEAVE_INCLUDE });
  if (!existing) return null;
  if (decision === 'approve' && existing.status !== 'pending') throw new RosterError('Only a pending request can be approved.');
  if (decision === 'decline' && existing.status !== 'pending') throw new RosterError('Only a pending request can be declined.');
  if (decision === 'cancel' && !['pending', 'approved'].includes(existing.status)) throw new RosterError('That leave is already closed.');

  const rules = await getRules();
  const status: LeaveStatus = decision === 'approve' ? 'approved' : decision === 'decline' ? 'declined' : 'cancelled';
  const row = await prisma.$transaction(async (tx) => {
    if (decision === 'approve') await applyLeave(tx, rules, existing);
    if (decision === 'cancel' && existing.status === 'approved') await revertLeave(tx, rules, id);
    const updated = await tx.shiftLeave.update({
      where: { id },
      data: { status, decidedById: actor.id, decidedAt: new Date() },
      include: LEAVE_INCLUDE,
    });
    await audit(tx, actor, {
      action: 'leave',
      lineCode: existing.line.code,
      date: existing.startDate,
      month: monthOf(existing.startDate),
      summary: `Leave ${status} for ${existing.line.code}: ${dayLabel(existing.startDate)} to ${dayLabel(existing.endDate)}`,
      detail: { from: existing.status, to: status, shiftsCharged: updated.shiftsCharged },
    });
    return updated;
  });

  let needsCover: Violation[] = [];
  if (decision === 'approve') {
    const [lines, records] = await Promise.all([listLines(), loadRecords(prisma, existing.startDate, existing.endDate)]);
    const months = await generatedMonths(prisma, addDays(existing.startDate, -14), existing.endDate);
    needsCover = validateRoster(rules, lines, buildLookup(indexRecords(records)), existing.startDate, existing.endDate, generatedCheck(months)).filter(
      (v) => v.rule === 'coverage_gap' && records.some((r) => r.date === v.date),
    );
  }
  return { leave: (await leaveViews([row]))[0] as LeaveView, needsCover };
}

/** A person withdrawing their own request before it is decided. */
export async function withdrawLeave(actor: Actor, id: number, lineId: number): Promise<boolean> {
  const existing = await prisma.shiftLeave.findUnique({ where: { id }, include: { line: { select: { code: true } } } });
  if (!existing || existing.lineId !== lineId) return false;
  if (existing.status !== 'pending') throw new RosterError('Only a pending request can be withdrawn. Ask a scheduler to cancel approved leave.');
  await prisma.$transaction(async (tx) => {
    await tx.shiftLeave.update({ where: { id }, data: { status: 'cancelled', decidedAt: new Date() } });
    await audit(tx, actor, {
      action: 'leave',
      lineCode: existing.line.code,
      date: existing.startDate,
      month: monthOf(existing.startDate),
      summary: `Leave request withdrawn for ${existing.line.code}: ${dayLabel(existing.startDate)} to ${dayLabel(existing.endDate)}`,
    });
  });
  return true;
}

/** Accrual and balance for the calendar year of `today`. */
export async function leaveBalances(lines: LineView[], today: string): Promise<Record<number, LeaveBalance>> {
  const year = today.slice(0, 4);
  const rows = await prisma.shiftLeave.groupBy({
    by: ['lineId', 'status'],
    where: { type: 'annual', status: { in: ['approved', 'pending'] }, startDate: { gte: `${year}-01-01`, lte: `${year}-12-31` } },
    _sum: { shiftsCharged: true },
  });
  const out: Record<number, LeaveBalance> = {};
  for (const line of lines) {
    const sum = (status: string) => rows.find((r) => r.lineId === line.id && r.status === status)?._sum.shiftsCharged ?? 0;
    const accrued = leaveAccrued(line.leaveEntitlementDays, line.startDate, today);
    const taken = sum('approved');
    out[line.id] = {
      entitlement: line.leaveEntitlementDays,
      opening: line.leaveOpeningBalance,
      accrued,
      taken,
      pending: sum('pending'),
      balance: Math.round((line.leaveOpeningBalance + accrued - taken) * 100) / 100,
    };
  }
  return out;
}

// --- Uploading a roster --------------------------------------------------------

export interface RosterImportInput {
  month: string;
  fileName: string;
  /** The uploaded file, already read into rows (see lib/spreadsheet-read.ts). */
  sheets: NamedSheet[];
  /** The sheet to read, when the workbook has several rosters for the month. */
  sheet?: string | null;
  blankAsOff?: boolean;
  /** Who each row of the file is, where the scheduler chose; by the row's key. */
  mapping?: Record<string, ImportTarget>;
  /** What each code the roster does not know counts as, where the scheduler chose. */
  codes?: ImportCodeChoices;
  /** False (the default) only works out what would happen. */
  apply?: boolean;
  /** Needed when the upload adds a blocking problem to a published month. */
  forceReason?: string | null;
}

const IMPORT_REASON = 'Roster upload';
const MAX_SHOWN_VIOLATIONS = 40;
const LOCKED_STATUSES = ['worked', 'sick', 'no-show', 'call-in'];

/**
 * Fills a month from an uploaded roster: one row per person, one column per
 * day. Without `apply` nothing is written and the result is a preview of
 * exactly what would be.
 *
 * The file sets the plan, the way a scheduler's own changes do. It reaches
 * only the people and days it names: anyone else on the roster keeps their
 * month, and a day with recorded actuals keeps its history. A month that does
 * not exist yet is created as a draft, and people the roster does not know
 * are added to it, outside the rotation.
 */
export async function importRoster(actor: Actor, input: RosterImportInput): Promise<ImportResult> {
  const { month } = input;
  assertMonth(month);
  const from = monthStart(month);
  const to = monthEnd(month);
  const [saved, lines, monthRow, records, months, users, leaves] = await Promise.all([
    getRules(),
    listLines(),
    prisma.shiftMonth.findUnique({ where: { month } }),
    loadRecords(prisma, addDays(from, -14), addDays(to, 14)),
    generatedMonths(prisma, addDays(from, -14), addDays(to, 14)),
    listUserOptions(),
    prisma.shiftLeave.findMany({ where: { status: 'approved', startDate: { lte: to }, endDate: { gte: from } } }),
  ]);

  // Read once to meet the file's own codes ("SOC-D", "WT"), then again with them
  // added to the rules, so that those cells are shifts like any other.
  const first = readRosterWorkbook(input.sheets, month, saved, input.sheet);
  if (!first.reading || !first.sheet) throw new RosterError(first.error ?? 'No roster was found in this file.');
  const learned = withNewCodes(saved, first.reading.unknown, input.codes ?? {});
  let rules = saved;
  if (learned.rules !== saved) {
    try {
      rules = sanitizeRules(learned.rules, saved);
    } catch (error) {
      throw new RosterError(error instanceof Error ? error.message : 'One of the codes in this file cannot be used.');
    }
  }
  const newCodes = rules.extra.filter((extra) => !saved.extra.some((old) => old.code === extra.code));
  const workbook = rules === saved ? first : readRosterWorkbook(input.sheets, month, rules, first.sheet);
  if (!workbook.reading || !workbook.sheet) throw new RosterError(workbook.error ?? 'No roster was found in this file.');
  const reading = workbook.reading;

  const index = indexRecords(records);
  const existing = new Map<string, ExistingCell>();
  for (const record of records) {
    if (record.date < from || record.date > to) continue;
    existing.set(recordKey(record.lineId, record.date), {
      id: record.id,
      planned: writtenCode(record),
      generated: record.generatedCode,
      locked: Boolean(record.callIn) || LOCKED_STATUSES.includes(record.status),
      cell: cellOfRecord(record),
    });
  }

  const mapping: Record<string, ImportTarget> = {};
  for (const [key, target] of Object.entries(input.mapping ?? {})) {
    if (target === 'new' || target === 'skip' || (Number.isInteger(target) && lines.some((line) => line.id === target))) mapping[key] = target;
  }
  const plan = planRosterImport({ month, rules, reading, lines, existing, options: { blankAsOff: Boolean(input.blankAsOff), mapping } });

  // In a month that is only now being created, approved leave lands on it as it does when generating.
  const onLeave = new Set<string>();
  if (!monthRow) {
    for (const person of plan.people) {
      if (typeof person.target !== 'number') continue;
      for (const leave of leaves) {
        if (leave.lineId !== person.target) continue;
        for (const shift of person.shifts) {
          const base = baseOf(rules, shift.code);
          if (base && isWorking(base) && shift.date >= leave.startDate && shift.date <= leave.endDate) onLeave.add(recordKey(leave.lineId, shift.date));
        }
      }
    }
  }
  const checks = checkImport({ month, rules, plan, lines, lookup: buildLookup(index), generatedMonths: months, onLeave });

  // People the file adds: a login account with exactly their name becomes theirs.
  const free = users.filter((user) => user.lineId === null);
  const claimed = new Set<number>();
  const fileNames = new Map(reading.people.map((person) => [person.key, person.identity]));
  const adding = plan.people
    .filter((person) => person.target === 'new' && person.shifts.length > 0)
    .map((person) => {
      const names = fileNames.get(person.key) ?? [person.label];
      // Only the full name or the email itself: a shared first name is not enough to hand someone a login's shifts.
      const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
      const account = free.find((user) => !claimed.has(user.id) && names.some((name) => same(name, user.name) || same(name, user.email))) ?? null;
      if (account) claimed.add(account.id);
      return { person, names, account: account ? { id: account.id, name: account.name } : null };
    });
  const accountOf = new Map(adding.map((entry) => [entry.person.key, entry.account]));

  const totals = { set: 0, unchanged: 0, blank: 0, locked: 0, outside: 0, unreadable: 0, newPeople: adding.length };
  for (const person of plan.people) {
    totals.set += person.shifts.length;
    totals.unchanged += person.unchanged;
    totals.blank += person.blank;
    totals.locked += person.locked;
    totals.outside += person.outside;
    totals.unreadable += person.unreadable;
  }
  const inFile = new Set(plan.people.map((person) => person.target));
  const needsReason = monthRow?.status === 'published' && checks.newBlocks.length > 0;
  const preview: ImportPreview = {
    month,
    monthStatus: monthView(rules, month, monthRow).status,
    fileName: input.fileName,
    sheet: workbook.sheet,
    sheets: workbook.sheets,
    days: reading.dates.length,
    daysInMonth: datesBetween(from, to).length,
    turned: reading.turned,
    people: plan.people.map(({ shifts, ...person }) => ({ ...person, set: shifts.length, account: accountOf.get(person.key)?.name ?? null })),
    totals,
    notInFile: lines
      .filter((line) => line.active && !inFile.has(line.id) && (monthRow ? [...existing.keys()].some((key) => key.startsWith(`${line.id}|`)) : line.cycleOffset !== null))
      .map((line) => (line.name === line.code ? line.code : `${line.code} · ${line.name}`)),
    onLeave: onLeave.size,
    newCodes: learned.codes,
    notes: plan.notes,
    moreNotes: plan.moreNotes,
    blocks: checks.blocks.slice(0, MAX_SHOWN_VIOLATIONS),
    warnings: checks.warnings.slice(0, MAX_SHOWN_VIOLATIONS),
    moreBlocks: Math.max(0, checks.blocks.length - MAX_SHOWN_VIOLATIONS),
    moreWarnings: Math.max(0, checks.warnings.length - MAX_SHOWN_VIOLATIONS),
    needsReason,
    newBlocks: checks.newBlocks.length,
  };
  if (!input.apply) return { applied: false, preview, summary: null };

  if (totals.set === 0) throw new RosterError(`Nothing in this file changes the roster for ${monthLabel(month)}.`);
  const forceReason = input.forceReason?.trim().slice(0, 300) ?? '';
  if (needsReason && !forceReason) {
    throw new RosterError(`${monthLabel(month)} is published and this upload would break a roster rule. Give a reason to go ahead.`);
  }

  const codes = newLineCodes(lines.map((line) => line.code), adding.map((entry) => entry.names));
  const last = lines.reduce((max, line) => Math.max(max, line.sortOrder), 0);
  const counts = await prisma.$transaction(
    async (tx) => {
      const lineIdOf = new Map<string, number>();
      for (const [i, entry] of adding.entries()) {
        const created = await tx.shiftLine.create({
          data: {
            code: codes[i] as string,
            displayName: personName(entry.names) || entry.person.label.slice(0, 80),
            userId: entry.account?.id ?? null,
            cycleOffset: null,
            sortOrder: last + i + 1,
          },
          select: { id: true },
        });
        lineIdOf.set(entry.person.key, created.id);
      }

      await tx.shiftMonth.upsert({ where: { month }, create: { month, generatedById: actor.id }, update: {} });
      // The roster keeps the codes it has just met, and shows them as written from now on.
      if (newCodes.length > 0) await writeRules(tx, rules, actor.id);

      const creates: Prisma.ShiftRecordCreateManyInput[] = [];
      const updates = new Map<string, number[]>();
      for (const person of plan.people) {
        const lineId = typeof person.target === 'number' ? person.target : lineIdOf.get(person.key);
        if (lineId === undefined) continue;
        for (const shift of person.shifts) {
          if (shift.recordId !== null) {
            updates.set(shift.code, [...(updates.get(shift.code) ?? []), shift.recordId]);
            continue;
          }
          creates.push({
            lineId,
            date: shift.date,
            generatedCode: shift.generated,
            plannedCode: shift.code,
            status: baseOf(rules, shift.code) === 'LV' ? 'leave' : 'planned',
            ...plannedTimes(rules, shift.code),
            reasonCode: IMPORT_REASON,
            approvedById: actor.id,
            updatedById: actor.id,
          });
        }
      }
      const created = await tx.shiftRecord.createMany({ data: creates, skipDuplicates: true });
      let updated = 0;
      for (const [code, ids] of updates) {
        const result = await tx.shiftRecord.updateMany({
          // Someone may have recorded actuals since the preview: those days keep their history.
          where: { id: { in: ids }, status: { notIn: LOCKED_STATUSES } },
          data: {
            plannedCode: code,
            status: baseOf(rules, code) === 'LV' ? 'leave' : 'planned',
            ...plannedTimes(rules, code),
            reasonCode: IMPORT_REASON,
            approvedById: actor.id,
            updatedById: actor.id,
            // A change by hand takes the day out of any leave that put LV there.
            ...(baseOf(rules, code) === 'LV' ? {} : { leaveId: null }),
          },
        });
        updated += result.count;
      }

      if (!monthRow) for (const leave of leaves) await applyLeave(tx, rules, leave);

      const people = plan.people.filter((person) => person.target !== 'skip' && person.shifts.length > 0);
      const shifts = created.count + updated;
      const summary = `${monthRow ? 'Updated' : 'Filled'} ${monthLabel(month)} from ${input.fileName}: ${shifts} shift${shifts === 1 ? '' : 's'} for ${people.length} ${people.length === 1 ? 'person' : 'people'}${adding.length ? `, ${adding.length} of them new to the roster` : ''}${newCodes.length ? `; added the code${newCodes.length === 1 ? '' : 's'} ${newCodes.map((extra) => extra.code).join(', ')}` : ''}`;
      await audit(tx, actor, {
        action: 'import',
        month,
        summary,
        detail: {
          file: input.fileName,
          sheet: workbook.sheet,
          created: created.count,
          updated,
          people: people.map((person) => person.lineCode ?? codes[adding.findIndex((entry) => entry.person.key === person.key)] ?? person.label),
          added: adding.map((entry, i) => ({ code: codes[i], name: personName(entry.names), account: entry.account?.name ?? null })),
          newCodes: newCodes.map((extra) => ({ code: extra.code, as: extra.as })),
          blankAsOff: Boolean(input.blankAsOff),
          skipped: { locked: totals.locked, unreadable: totals.unreadable, outside: totals.outside },
          blocks: needsReason ? checks.newBlocks.map((v) => v.message) : [],
          forceReason: needsReason ? forceReason : null,
        },
        blockOverridden: needsReason,
      });
      return { summary };
    },
    { timeout: 20_000 },
  );
  return { applied: true, preview, summary: `${counts.summary}.` };
}

/**
 * The month as a table to download, edit in Excel and upload again: one row
 * per active person, one column per day. A month not generated yet shows what
 * the rotation would give.
 */
export async function rosterTemplateRows(month: string): Promise<string[][]> {
  assertMonth(month);
  const [rules, lines, monthRow, records] = await Promise.all([
    getRules(),
    listLines(),
    prisma.shiftMonth.findUnique({ where: { month }, select: { month: true } }),
    loadRecords(prisma, monthStart(month), monthEnd(month)),
  ]);
  const index = indexRecords(records);
  return rosterTemplate({
    month,
    lines: lines.filter((line) => line.active || records.some((record) => record.lineId === line.id)),
    codeAt: (lineId, date) => {
      const record = index.get(recordKey(lineId, date));
      if (record) return writtenCode(record);
      const line = lines.find((l) => l.id === lineId);
      if (monthRow || !line || line.cycleOffset === null || !lineOnRoster(line, date)) return null;
      return resolveCell(rules, line, date, () => null)?.planned ?? null;
    },
  });
}

// --- Views -------------------------------------------------------------------

/** One month for the admin roster, with two weeks either side for the rule windows. */
export async function adminOverview(month: string): Promise<AdminOverview> {
  assertMonth(month);
  const rules = await getRules();
  const today = zonedNow(rules.timeZone, Date.now()).date;
  const from = addDays(monthStart(month), -14);
  const to = addDays(monthEnd(month), 14);
  const [lines, monthRow, records, holidays, leaves, users, months] = await Promise.all([
    listLines(),
    prisma.shiftMonth.findUnique({ where: { month } }),
    loadRecords(prisma, from, to),
    listHolidays(),
    listLeaves(),
    listUserOptions(),
    generatedMonths(prisma, from, to),
  ]);
  return {
    today,
    rules,
    lines,
    month: monthView(rules, month, monthRow),
    generatedMonths: months,
    records,
    holidays,
    leaves,
    balances: await leaveBalances(lines, today),
    users,
  };
}

/** Everyone's month, read-only. Drafts are included: this is for admins. */
export async function teamRoster(month: string): Promise<TeamRoster> {
  assertMonth(month);
  const rules = await getRules();
  const [lines, monthRow, records, holidays] = await Promise.all([
    listLines(),
    prisma.shiftMonth.findUnique({ where: { month } }),
    loadRecords(prisma, monthStart(month), monthEnd(month)),
    listHolidays(monthStart(month), monthEnd(month)),
  ]);
  return {
    today: zonedNow(rules.timeZone, Date.now()).date,
    rules,
    lines: lines.filter((line) => line.active || records.some((r) => r.lineId === line.id)),
    month: monthView(rules, month, monthRow),
    records,
    holidays,
  };
}

/** A person's own shifts. Only published months are ever returned. */
export async function myShifts(userId: number, month: string): Promise<MyShifts> {
  assertMonth(month);
  const rules = await getRules();
  const today = zonedNow(rules.timeZone, Date.now()).date;
  const [line, monthRow, holidays] = await Promise.all([
    lineForUser(userId),
    prisma.shiftMonth.findUnique({ where: { month } }),
    listHolidays(addDays(monthStart(month), -7), addDays(monthEnd(month), 45)),
  ]);
  const view = monthView(rules, month, monthRow);
  // An unpublished month looks the same to staff as one that does not exist.
  const visible: MyShifts['month'] = view.status === 'published' ? view : { ...view, status: 'none', generatedAt: null };
  if (!line) {
    return { today, rules, line: null, month: visible, records: [], upcoming: [], holidays, totals: emptyTotals(), balance: null, leaves: [] };
  }

  const aheadFrom = addDays(today, -1);
  const aheadTo = addDays(today, 14);
  const [monthRecords, ahead, published, balances, leaves] = await Promise.all([
    view.status === 'published' ? loadRecords(prisma, monthStart(month), monthEnd(month), line.id) : Promise.resolve([]),
    loadRecords(prisma, aheadFrom, aheadTo, line.id),
    publishedMonths([monthOf(aheadFrom), monthOf(aheadTo)]),
    leaveBalances([line], today),
    listLeaves({ lineId: line.id }),
  ]);
  const index = indexRecords(monthRecords);
  const lookup = buildLookup(index);
  const holidaySet = new Set(holidays.map((h) => h.date));
  return {
    today,
    rules,
    line,
    month: visible,
    records: monthRecords,
    upcoming: ahead.filter((r) => published.has(monthOf(r.date))),
    holidays,
    totals: lineTotals(
      rules,
      monthRecords.map((r) => ({ date: r.date, cell: lookup(line.id, r.date) })),
      holidaySet,
    ),
    balance: balances[line.id] ?? null,
    leaves: leaves.slice(0, 20),
  };
}

/** Months around `month` and whether each is generated or published. */
export async function listMonths(rules: ShiftRules, around: string, back = 2, ahead = 3): Promise<MonthView[]> {
  const months = Array.from({ length: back + ahead + 1 }, (_, i) => addMonths(around, i - back));
  const rows = await prisma.shiftMonth.findMany({ where: { month: { in: months } } });
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  return months.map((m) => monthView(rules, m, byMonth.get(m) ?? null));
}

/** The month it is now on the roster's clock. */
export async function currentMonth(): Promise<string> {
  const rules = await getRules();
  return monthOf(zonedNow(rules.timeZone, Date.now()).date);
}
