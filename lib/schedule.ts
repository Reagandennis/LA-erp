import 'server-only';

import { prisma } from '@/lib/prisma';

export type ShiftType = 'work-day' | 'work-night' | 'vacation' | 'preference' | 'available' | 'empty';

export type ShiftBlock = {
  type: ShiftType;
  startTime?: string | null;
  endTime?: string | null;
  timeLabel?: string | null;
  statusLabel?: string | null;
  note?: string | null;
  tasksCompleted?: number | null;
  totalTasks?: number | null;
};

export type ScheduleShiftSummary = {
  employeeId: number;
  date: string;
  block: ShiftBlock;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

type Row = {
  employeeId: number;
  date: string;
  type: string;
  startTime: string | null;
  endTime: string | null;
  timeLabel: string | null;
  statusLabel: string | null;
  note: string | null;
  tasksCompleted: number | null;
  totalTasks: number | null;
};

function serialize(row: Row): ScheduleShiftSummary {
  return {
    employeeId: row.employeeId,
    date: row.date,
    block: {
      type: row.type as ShiftType,
      startTime: row.startTime,
      endTime: row.endTime,
      timeLabel: row.timeLabel,
      statusLabel: row.statusLabel,
      note: row.note,
      tasksCompleted: row.tasksCompleted,
      totalTasks: row.totalTasks,
    },
  };
}

const SELECT = {
  employeeId: true,
  date: true,
  type: true,
  startTime: true,
  endTime: true,
  timeLabel: true,
  statusLabel: true,
  note: true,
  tasksCompleted: true,
  totalTasks: true,
} as const;

/** All shifts (shared roster), optionally limited to a [from, to] date-key range. */
export async function listShifts(from?: string, to?: string): Promise<ScheduleShiftSummary[]> {
  const dateFilter: { gte?: string; lte?: string } = {};
  if (isValidDateKey(from)) dateFilter.gte = from;
  if (isValidDateKey(to)) dateFilter.lte = to;

  const rows = await prisma.scheduleShift.findMany({
    where: Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
    select: SELECT,
    orderBy: [{ date: 'asc' }],
  });
  return rows.map(serialize);
}

/** Create or update one employee's shift on a given day. */
export async function upsertShift(input: {
  adminId: number;
  employeeId: number;
  date: string;
  block: ShiftBlock;
}): Promise<ScheduleShiftSummary> {
  if (!isValidDateKey(input.date)) throw new Error('Invalid date');

  const employee = await prisma.user.findUnique({ where: { id: input.employeeId }, select: { id: true } });
  if (!employee) throw new Error('Employee not found');

  const b = input.block;
  const data = {
    type: b.type,
    startTime: b.startTime ?? null,
    endTime: b.endTime ?? null,
    timeLabel: b.timeLabel ?? null,
    statusLabel: b.statusLabel ?? null,
    note: b.note ?? null,
    tasksCompleted: typeof b.tasksCompleted === 'number' ? b.tasksCompleted : null,
    totalTasks: typeof b.totalTasks === 'number' ? b.totalTasks : null,
  };

  const row = await prisma.scheduleShift.upsert({
    where: { employeeId_date: { employeeId: input.employeeId, date: input.date } },
    create: { employeeId: input.employeeId, date: input.date, createdById: input.adminId, ...data },
    update: { ...data, createdById: input.adminId },
    select: SELECT,
  });
  return serialize(row);
}

/** Clear an employee's shift on a given day. */
export async function deleteShift(employeeId: number, date: string): Promise<boolean> {
  if (!isValidDateKey(date)) return false;
  const result = await prisma.scheduleShift.deleteMany({ where: { employeeId, date } });
  return result.count > 0;
}
