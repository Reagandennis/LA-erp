import 'server-only';

import { prisma } from '@/lib/prisma';

// --- Option sets -----------------------------------------------------------

export const SHIFT_PERIODS = ['Day', 'Night', 'Morning', 'Afternoon', 'Evening'] as const;
export const HANDOVER_STATUSES = ['Normal', 'Attention', 'Urgent'] as const;

export type ShiftPeriod = (typeof SHIFT_PERIODS)[number];
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

function pickPeriod(value: unknown): ShiftPeriod {
  return (SHIFT_PERIODS as readonly string[]).includes(value as string) ? (value as ShiftPeriod) : 'Day';
}
function pickStatus(value: unknown): HandoverStatus {
  return (HANDOVER_STATUSES as readonly string[]).includes(value as string) ? (value as HandoverStatus) : 'Normal';
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --- Serialized shapes -----------------------------------------------------

export type HandoverSummary = {
  id: number;
  shiftDate: string;
  shiftPeriod: string;
  post: string | null;
  status: string;
  summary: string;
  createdAt: string;
  createdBy: { id: number; name: string } | null;
  acknowledgedBy: { id: number; name: string } | null;
  acknowledgedAt: string | null;
};

export type HandoverDetail = HandoverSummary & {
  incidents: string | null;
  watchItems: string | null;
};

export type HandoverStats = {
  awaiting: number;
  attention: number;
  thisWeek: number;
  total: number;
};

const DETAIL_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
  acknowledgedBy: { select: { id: true, name: true } },
} as const;

type HandoverRow = {
  id: number;
  shiftDate: Date;
  shiftPeriod: string;
  post: string | null;
  status: string;
  summary: string;
  incidents: string | null;
  watchItems: string | null;
  createdAt: Date;
  acknowledgedAt: Date | null;
  createdBy: { id: number; name: string } | null;
  acknowledgedBy: { id: number; name: string } | null;
};

function serialize(row: HandoverRow): HandoverDetail {
  return {
    id: row.id,
    shiftDate: row.shiftDate.toISOString(),
    shiftPeriod: row.shiftPeriod,
    post: row.post,
    status: row.status,
    summary: row.summary,
    incidents: row.incidents,
    watchItems: row.watchItems,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
  };
}

// --- Reads -----------------------------------------------------------------

export async function listHandovers(): Promise<HandoverDetail[]> {
  const rows = await prisma.handoverEntry.findMany({
    orderBy: [{ shiftDate: 'desc' }, { id: 'desc' }],
    include: DETAIL_INCLUDE,
  });
  return rows.map(serialize);
}

export async function getHandover(id: number): Promise<HandoverDetail | null> {
  const row = await prisma.handoverEntry.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  return row ? serialize(row) : null;
}

export function computeStats(rows: HandoverSummary[]): HandoverStats {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return {
    awaiting: rows.filter((r) => !r.acknowledgedBy).length,
    attention: rows.filter((r) => !r.acknowledgedBy && (r.status === 'Attention' || r.status === 'Urgent')).length,
    thisWeek: rows.filter((r) => new Date(r.createdAt).getTime() >= weekAgo).length,
    total: rows.length,
  };
}

// --- Writes ----------------------------------------------------------------

export async function createHandover(input: {
  userId: number;
  shiftDate?: string | null;
  shiftPeriod?: string;
  post?: string | null;
  status?: string;
  summary: string;
  incidents?: string | null;
  watchItems?: string | null;
}): Promise<HandoverDetail> {
  const summary = input.summary.trim();
  if (!summary) throw new Error('A handover summary is required');
  const row = await prisma.handoverEntry.create({
    data: {
      shiftDate: parseDate(input.shiftDate) ?? new Date(),
      shiftPeriod: pickPeriod(input.shiftPeriod),
      post: trimOrNull(input.post),
      status: pickStatus(input.status),
      summary,
      incidents: trimOrNull(input.incidents),
      watchItems: trimOrNull(input.watchItems),
      createdById: input.userId,
    },
    include: DETAIL_INCLUDE,
  });
  return serialize(row);
}

export async function updateHandover(
  id: number,
  patch: {
    shiftDate?: string | null;
    shiftPeriod?: string;
    post?: string | null;
    status?: string;
    summary?: string;
    incidents?: string | null;
    watchItems?: string | null;
  },
): Promise<HandoverDetail | null> {
  const existing = await prisma.handoverEntry.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return null;
  const data: Record<string, unknown> = {};
  if (patch.shiftDate !== undefined) {
    const d = parseDate(patch.shiftDate);
    if (d) data.shiftDate = d;
  }
  if (patch.shiftPeriod !== undefined) data.shiftPeriod = pickPeriod(patch.shiftPeriod);
  if (patch.post !== undefined) data.post = trimOrNull(patch.post);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.summary !== undefined) {
    const v = patch.summary.trim();
    if (v) data.summary = v;
  }
  if (patch.incidents !== undefined) data.incidents = trimOrNull(patch.incidents);
  if (patch.watchItems !== undefined) data.watchItems = trimOrNull(patch.watchItems);
  const row = await prisma.handoverEntry.update({ where: { id }, data, include: DETAIL_INCLUDE });
  return serialize(row);
}

/** The incoming shift acknowledges receipt. The author can't acknowledge their own. */
export async function acknowledgeHandover(id: number, userId: number): Promise<HandoverDetail | null> {
  const existing = await prisma.handoverEntry.findUnique({
    where: { id },
    select: { id: true, createdById: true, acknowledgedById: true },
  });
  if (!existing) return null;
  if (existing.acknowledgedById) throw new Error('This handover has already been acknowledged');
  if (existing.createdById === userId) throw new Error('You cannot acknowledge your own handover');
  const row = await prisma.handoverEntry.update({
    where: { id },
    data: { acknowledgedById: userId, acknowledgedAt: new Date() },
    include: DETAIL_INCLUDE,
  });
  return serialize(row);
}

export async function deleteHandover(id: number): Promise<boolean> {
  const existing = await prisma.handoverEntry.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.handoverEntry.delete({ where: { id } });
  return true;
}

/** True when the user may edit/delete the handover (its author or an admin). */
export async function canManageHandover(id: number, userId: number): Promise<boolean | null> {
  const row = await prisma.handoverEntry.findUnique({ where: { id }, select: { createdById: true } });
  if (!row) return null;
  return row.createdById === userId;
}
