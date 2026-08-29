import 'server-only';

import { prisma } from './prisma';

/**
 * Shift planning: patterns, teams, leave and holidays.
 *
 * Complements lib/schedule.ts, which owns the individual ScheduleShift rows
 * that land on the board. The split matters: a template is an editable pattern,
 * while a shift is a fact about a day that has possibly already been worked —
 * changing a pattern must never silently rewrite history.
 *
 * Dates are 'YYYY-MM-DD' strings throughout, matching ScheduleShift.date, so
 * range filtering is a lexicographic compare with no timezone in play.
 */

export const LEAVE_TYPES = ['annual', 'sick', 'casual', 'unpaid'] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const LEAVE_STATUSES = ['pending', 'approved', 'declined'] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Palette keys the UI maps to actual colours; kept server-side so seeds agree. */
export const COLOURS = ['blue', 'emerald', 'amber', 'violet', 'rose', 'slate'] as const;
export type Colour = (typeof COLOURS)[number];

export function isLeaveType(value: unknown): value is LeaveType {
  return typeof value === 'string' && (LEAVE_TYPES as readonly string[]).includes(value);
}

export function isColour(value: unknown): value is Colour {
  return typeof value === 'string' && (COLOURS as readonly string[]).includes(value);
}

export function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** 24-hour 'HH:MM'. */
export function isTimeOfDay(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

// --- Shift templates -------------------------------------------------------

export interface TemplatePerson {
  userId: number;
  name: string;
  email: string;
  hours: number | null;
}

export interface TemplateTeam {
  teamId: string;
  name: string;
  colour: string;
  memberCount: number;
  hours: number | null;
}

export interface ShiftTemplateSummary {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  /** ISO weekdays: 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  colour: string;
  active: boolean;
  sortOrder: number;
  members: TemplatePerson[];
  teams: TemplateTeam[];
  /** Span in hours, accounting for a shift that crosses midnight. */
  spanHours: number;
}

/** Hours between two 'HH:MM' times, treating end <= start as crossing midnight. */
export function spanHoursBetween(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const start = (sh ?? 0) * 60 + (sm ?? 0);
  let end = (eh ?? 0) * 60 + (em ?? 0);
  if (end <= start) end += 24 * 60;
  return Math.round(((end - start) / 60) * 100) / 100;
}

const TEMPLATE_INCLUDE = {
  members: { include: { user: { select: { id: true, name: true, email: true } } } },
  teams: {
    include: {
      team: { select: { id: true, name: true, colour: true, _count: { select: { members: true } } } },
    },
  },
} as const;

type TemplateRow = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  colour: string;
  active: boolean;
  sortOrder: number;
  members: Array<{ hours: number | null; user: { id: number; name: string; email: string } }>;
  teams: Array<{
    hours: number | null;
    team: { id: string; name: string; colour: string; _count: { members: number } };
  }>;
};

function serializeTemplate(row: TemplateRow): ShiftTemplateSummary {
  return {
    id: row.id,
    name: row.name,
    startTime: row.startTime,
    endTime: row.endTime,
    weekdays: [...row.weekdays].sort((a, b) => a - b),
    colour: row.colour,
    active: row.active,
    sortOrder: row.sortOrder,
    spanHours: spanHoursBetween(row.startTime, row.endTime),
    members: row.members.map((m) => ({
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      hours: m.hours,
    })),
    teams: row.teams.map((t) => ({
      teamId: t.team.id,
      name: t.team.name,
      colour: t.team.colour,
      memberCount: t.team._count.members,
      hours: t.hours,
    })),
  };
}

export async function listTemplates(): Promise<ShiftTemplateSummary[]> {
  const rows = await prisma.shiftTemplate.findMany({
    include: TEMPLATE_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
  });
  return rows.map((r) => serializeTemplate(r as TemplateRow));
}

export async function createTemplate(input: {
  name: string;
  startTime: string;
  endTime: string;
  weekdays: number[];
  colour: string;
  createdById: number;
}): Promise<ShiftTemplateSummary> {
  const last = await prisma.shiftTemplate.findFirst({ orderBy: { sortOrder: 'desc' } });
  const row = await prisma.shiftTemplate.create({
    data: {
      name: input.name,
      startTime: input.startTime,
      endTime: input.endTime,
      weekdays: input.weekdays,
      colour: input.colour,
      sortOrder: (last?.sortOrder ?? 0) + 1,
      createdById: input.createdById,
    },
    include: TEMPLATE_INCLUDE,
  });
  return serializeTemplate(row as TemplateRow);
}

export async function updateTemplate(
  id: string,
  patch: Partial<{
    name: string;
    startTime: string;
    endTime: string;
    weekdays: number[];
    colour: string;
    active: boolean;
  }>,
): Promise<ShiftTemplateSummary | null> {
  try {
    const row = await prisma.shiftTemplate.update({
      where: { id },
      data: patch,
      include: TEMPLATE_INCLUDE,
    });
    return serializeTemplate(row as TemplateRow);
  } catch {
    return null;
  }
}

/**
 * Delete a pattern. Shifts already generated from it keep their rows and simply
 * lose the link (`templateId` is SetNull) — deleting a pattern must not erase
 * worked history.
 */
export async function deleteTemplate(id: string): Promise<boolean> {
  try {
    await prisma.shiftTemplate.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function setTemplateMember(
  templateId: string,
  userId: number,
  hours: number | null,
): Promise<void> {
  await prisma.shiftTemplateMember.upsert({
    where: { templateId_userId: { templateId, userId } },
    create: { templateId, userId, hours },
    update: { hours },
  });
}

export async function removeTemplateMember(templateId: string, userId: number): Promise<void> {
  await prisma.shiftTemplateMember
    .delete({ where: { templateId_userId: { templateId, userId } } })
    .catch(() => undefined);
}

export async function setTemplateTeam(
  templateId: string,
  teamId: string,
  hours: number | null,
): Promise<void> {
  await prisma.shiftTemplateTeam.upsert({
    where: { templateId_teamId: { templateId, teamId } },
    create: { templateId, teamId, hours },
    update: { hours },
  });
}

export async function removeTemplateTeam(templateId: string, teamId: string): Promise<void> {
  await prisma.shiftTemplateTeam
    .delete({ where: { templateId_teamId: { templateId, teamId } } })
    .catch(() => undefined);
}

// --- Teams -----------------------------------------------------------------

export interface TeamSummary {
  id: string;
  name: string;
  colour: string;
  members: Array<{ userId: number; name: string; email: string }>;
}

export async function listTeams(): Promise<TeamSummary[]> {
  const rows = await prisma.team.findMany({
    include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
    orderBy: { name: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    colour: row.colour,
    members: row.members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email })),
  }));
}

export async function createTeam(input: {
  name: string;
  colour: string;
  createdById: number;
}): Promise<TeamSummary | null> {
  try {
    const row = await prisma.team.create({
      data: { name: input.name, colour: input.colour, createdById: input.createdById },
      include: { members: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    return { id: row.id, name: row.name, colour: row.colour, members: [] };
  } catch {
    // Unique violation on name.
    return null;
  }
}

export async function deleteTeam(id: string): Promise<boolean> {
  try {
    await prisma.team.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

export async function addTeamMember(teamId: string, userId: number): Promise<void> {
  await prisma.teamMember
    .upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId },
      update: {},
    })
    .catch(() => undefined);
}

export async function removeTeamMember(teamId: string, userId: number): Promise<void> {
  await prisma.teamMember
    .delete({ where: { teamId_userId: { teamId, userId } } })
    .catch(() => undefined);
}

// --- Leave -----------------------------------------------------------------

export interface LeaveSummary {
  id: string;
  userId: number;
  userName: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  status: LeaveStatus;
  note: string | null;
  decidedByName: string | null;
}

const LEAVE_INCLUDE = {
  user: { select: { id: true, name: true } },
  decidedBy: { select: { name: true } },
} as const;

type LeaveRow = {
  id: string;
  userId: number;
  type: string;
  startDate: string;
  endDate: string;
  status: string;
  note: string | null;
  user: { id: number; name: string };
  decidedBy: { name: string } | null;
};

function serializeLeave(row: LeaveRow): LeaveSummary {
  return {
    id: row.id,
    userId: row.userId,
    userName: row.user.name,
    type: row.type as LeaveType,
    startDate: row.startDate,
    endDate: row.endDate,
    status: row.status as LeaveStatus,
    note: row.note,
    decidedByName: row.decidedBy?.name ?? null,
  };
}

/**
 * Leave overlapping a date range.
 *
 * Overlap, not containment: a request that starts before the window and ends
 * inside it still affects those days, and the calendar must show it.
 */
export async function listLeave(from?: string, to?: string): Promise<LeaveSummary[]> {
  const rows = await prisma.leaveRequest.findMany({
    where: from && to ? { startDate: { lte: to }, endDate: { gte: from } } : undefined,
    include: LEAVE_INCLUDE,
    orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => serializeLeave(r as LeaveRow));
}

export async function createLeave(input: {
  userId: number;
  type: LeaveType;
  startDate: string;
  endDate: string;
  note: string | null;
  /** Managers booking on someone's behalf skip the pending step. */
  autoApproveById?: number;
}): Promise<LeaveSummary> {
  const row = await prisma.leaveRequest.create({
    data: {
      userId: input.userId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note,
      status: input.autoApproveById ? 'approved' : 'pending',
      decidedById: input.autoApproveById ?? null,
      decidedAt: input.autoApproveById ? new Date() : null,
    },
    include: LEAVE_INCLUDE,
  });
  return serializeLeave(row as LeaveRow);
}

export async function decideLeave(
  id: string,
  status: Extract<LeaveStatus, 'approved' | 'declined'>,
  decidedById: number,
): Promise<LeaveSummary | null> {
  try {
    const row = await prisma.leaveRequest.update({
      where: { id },
      data: { status, decidedById, decidedAt: new Date() },
      include: LEAVE_INCLUDE,
    });
    return serializeLeave(row as LeaveRow);
  } catch {
    return null;
  }
}

export async function deleteLeave(id: string): Promise<boolean> {
  try {
    await prisma.leaveRequest.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// --- Public holidays -------------------------------------------------------

export interface HolidaySummary {
  id: string;
  date: string;
  name: string;
}

export async function listHolidays(from?: string, to?: string): Promise<HolidaySummary[]> {
  const rows = await prisma.publicHoliday.findMany({
    where: from && to ? { date: { gte: from, lte: to } } : undefined,
    orderBy: { date: 'asc' },
  });
  return rows.map((r) => ({ id: r.id, date: r.date, name: r.name }));
}

export async function createHoliday(input: {
  date: string;
  name: string;
  createdById: number;
}): Promise<HolidaySummary | null> {
  try {
    const row = await prisma.publicHoliday.create({
      data: { date: input.date, name: input.name, createdById: input.createdById },
    });
    return { id: row.id, date: row.date, name: row.name };
  } catch {
    // Unique violation on date.
    return null;
  }
}

export async function deleteHoliday(id: string): Promise<boolean> {
  try {
    await prisma.publicHoliday.delete({ where: { id } });
    return true;
  } catch {
    return false;
  }
}

// --- Roster ----------------------------------------------------------------

export interface RosterPerson {
  id: number;
  name: string;
  email: string;
  /** First RBAC role, used as a job label on the board. */
  position: string;
  teamIds: string[];
}

/**
 * People who can be rostered: anyone active who holds the shift-planning module,
 * plus admins. Previously this keyed off the clock-in-out module; the module
 * moved, so the roster follows it.
 */
export async function listRoster(): Promise<RosterPerson[]> {
  const users = await prisma.user.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      email: true,
      userRoles: { select: { role: { select: { name: true } } } },
      userModules: { select: { module: { select: { slug: true } } } },
      teamMemberships: { select: { teamId: true } },
    },
    orderBy: { name: 'asc' },
  });

  return users
    .filter((user) => {
      const roles = user.userRoles.map((r) => r.role.name.toLowerCase());
      const modules = user.userModules.map((m) => m.module.slug);
      return modules.includes('shift-planning') || roles.includes('admin');
    })
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      position: user.userRoles[0]?.role.name ?? 'Staff',
      teamIds: user.teamMemberships.map((t) => t.teamId),
    }));
}
