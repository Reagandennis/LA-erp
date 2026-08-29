import 'server-only';

import { prisma } from '@/lib/prisma';

export type ShiftType = 'work-day' | 'work-night' | 'vacation' | 'preference' | 'available' | 'empty';

export type ShiftBlock = {
  type: ShiftType;
  startTime?: string | null;
  endTime?: string | null;
  timeLabel?: string | null;
  statusLabel?: string | null;
  role?: string | null;
  location?: string | null;
  breakMinutes?: number | null;
  note?: string | null;
  tasksCompleted?: number | null;
  totalTasks?: number | null;
};

export type ScheduleShiftSummary = {
  id: number;
  employeeId: number;
  date: string;
  /** The pattern this shift came from, when it was created from one. Drives
   *  the colour it is drawn in, so the board reads at a glance. */
  templateId: string | null;
  block: ShiftBlock;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && DATE_RE.test(value);
}

type Row = {
  id: number;
  employeeId: number;
  date: string;
  templateId: string | null;
  type: string;
  startTime: string | null;
  endTime: string | null;
  timeLabel: string | null;
  statusLabel: string | null;
  role: string | null;
  location: string | null;
  breakMinutes: number | null;
  note: string | null;
  tasksCompleted: number | null;
  totalTasks: number | null;
};

function serialize(row: Row): ScheduleShiftSummary {
  return {
    id: row.id,
    employeeId: row.employeeId,
    date: row.date,
    templateId: row.templateId,
    block: {
      type: row.type as ShiftType,
      startTime: row.startTime,
      endTime: row.endTime,
      timeLabel: row.timeLabel,
      statusLabel: row.statusLabel,
      role: row.role,
      location: row.location,
      breakMinutes: row.breakMinutes,
      note: row.note,
      tasksCompleted: row.tasksCompleted,
      totalTasks: row.totalTasks,
    },
  };
}

const SELECT = {
  id: true,
  employeeId: true,
  date: true,
  templateId: true,
  type: true,
  startTime: true,
  endTime: true,
  timeLabel: true,
  statusLabel: true,
  role: true,
  location: true,
  breakMinutes: true,
  note: true,
  tasksCompleted: true,
  totalTasks: true,
} as const;

/** Map a client block onto column values, dropping undefined. */
function blockToData(b: ShiftBlock) {
  return {
    type: b.type,
    startTime: b.startTime ?? null,
    endTime: b.endTime ?? null,
    timeLabel: b.timeLabel ?? null,
    statusLabel: b.statusLabel ?? null,
    role: b.role ?? null,
    location: b.location ?? null,
    breakMinutes: typeof b.breakMinutes === 'number' ? b.breakMinutes : null,
    note: b.note ?? null,
    tasksCompleted: typeof b.tasksCompleted === 'number' ? b.tasksCompleted : null,
    totalTasks: typeof b.totalTasks === 'number' ? b.totalTasks : null,
  };
}

/** All shifts (shared roster), optionally limited to a [from, to] date-key range. */
export async function listShifts(from?: string, to?: string): Promise<ScheduleShiftSummary[]> {
  const dateFilter: { gte?: string; lte?: string } = {};
  if (isValidDateKey(from)) dateFilter.gte = from;
  if (isValidDateKey(to)) dateFilter.lte = to;

  const rows = await prisma.scheduleShift.findMany({
    where: Object.keys(dateFilter).length ? { date: dateFilter } : undefined,
    select: SELECT,
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
  });
  return rows.map(serialize);
}

/** Create a new shift for an employee on a day (multiple shifts/day allowed). */
export async function createShift(input: {
  adminId: number;
  employeeId: number;
  date: string;
  block: ShiftBlock;
  templateId?: string | null;
}): Promise<ScheduleShiftSummary> {
  if (!isValidDateKey(input.date)) throw new Error('Invalid date');

  const employee = await prisma.user.findUnique({
    where: { id: input.employeeId },
    select: { id: true },
  });
  if (!employee) throw new Error('Employee not found');

  const row = await prisma.scheduleShift.create({
    data: {
      employeeId: input.employeeId,
      date: input.date,
      templateId: input.templateId ?? null,
      createdById: input.adminId,
      ...blockToData(input.block),
    },
    select: SELECT,
  });
  return serialize(row);
}

/** Update an existing shift by id. */
export async function updateShift(input: {
  adminId: number;
  id: number;
  block: ShiftBlock;
}): Promise<ScheduleShiftSummary | null> {
  const existing = await prisma.scheduleShift.findUnique({
    where: { id: input.id },
    select: { id: true },
  });
  if (!existing) return null;

  const row = await prisma.scheduleShift.update({
    where: { id: input.id },
    data: { ...blockToData(input.block), createdById: input.adminId },
    select: SELECT,
  });
  return serialize(row);
}

/** Delete a single shift by id. */
export async function deleteShiftById(id: number): Promise<boolean> {
  const result = await prisma.scheduleShift.deleteMany({ where: { id } });
  return result.count > 0;
}
