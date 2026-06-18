import 'server-only';

import { prisma } from '@/lib/prisma';

export const SOP_CATEGORIES = ['Safety', 'Operations', 'Human Resources', 'IT & Security', 'Finance'] as const;
export const SOP_STATUSES = ['Draft', 'Review', 'Active', 'Archived'] as const;

export type SopCategory = (typeof SOP_CATEGORIES)[number];
export type SopStatus = (typeof SOP_STATUSES)[number];

function pickCategory(value: unknown): SopCategory {
  return (SOP_CATEGORIES as readonly string[]).includes(value as string)
    ? (value as SopCategory)
    : 'Operations';
}
function pickStatus(value: unknown): SopStatus {
  return (SOP_STATUSES as readonly string[]).includes(value as string) ? (value as SopStatus) : 'Draft';
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

function normalizeSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
}

function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isReviewOverdue(status: string, reviewDate: Date | null): boolean {
  if (status !== 'Active' || !reviewDate) return false;
  return reviewDate.getTime() < Date.now();
}

// --- Serialized shapes -----------------------------------------------------

export type SopSummary = {
  id: number;
  code: string;
  title: string;
  category: string;
  status: string;
  version: string;
  ownerName: string | null;
  description: string | null;
  stepCount: number;
  effectiveDate: string | null;
  reviewDate: string | null;
  reviewOverdue: boolean;
  ackCount: number;
  acknowledgedByMe: boolean;
  createdAt: string;
};

export type SopRevisionEntry = {
  id: number;
  version: string;
  summary: string;
  changedBy: string;
  createdAt: string;
};

export type SopAckEntry = {
  userId: number;
  userName: string;
  version: string;
  acknowledgedAt: string;
};

export type SopDetail = SopSummary & {
  steps: string[];
  createdBy: string;
  totalUsers: number;
  revisions: SopRevisionEntry[];
  acknowledgements: SopAckEntry[];
};

export type SopStats = {
  total: number;
  active: number;
  inReview: number;
  reviewOverdue: number;
};

type AckRow = { userId: number; version: string };

function summarize(
  row: {
    id: number;
    code: string;
    title: string;
    category: string;
    status: string;
    version: string;
    ownerName: string | null;
    description: string | null;
    steps: string[];
    effectiveDate: Date | null;
    reviewDate: Date | null;
    createdAt: Date;
  },
  acks: AckRow[],
  userId: number,
): SopSummary {
  const currentAcks = acks.filter((a) => a.version === row.version);
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    category: row.category,
    status: row.status,
    version: row.version,
    ownerName: row.ownerName,
    description: row.description,
    stepCount: row.steps.length,
    effectiveDate: row.effectiveDate ? row.effectiveDate.toISOString() : null,
    reviewDate: row.reviewDate ? row.reviewDate.toISOString() : null,
    reviewOverdue: isReviewOverdue(row.status, row.reviewDate),
    ackCount: currentAcks.length,
    acknowledgedByMe: currentAcks.some((a) => a.userId === userId),
    createdAt: row.createdAt.toISOString(),
  };
}

const LIST_SELECT = {
  id: true,
  code: true,
  title: true,
  category: true,
  status: true,
  version: true,
  ownerName: true,
  description: true,
  steps: true,
  effectiveDate: true,
  reviewDate: true,
  createdAt: true,
  acknowledgements: { select: { userId: true, version: true } },
} as const;

// --- Reads -----------------------------------------------------------------

export async function listSops(userId: number): Promise<SopSummary[]> {
  const rows = await prisma.sop.findMany({ orderBy: [{ code: 'asc' }], select: LIST_SELECT });
  return rows.map((r) => summarize(r, r.acknowledgements, userId));
}

export async function getSop(id: number, userId: number): Promise<SopDetail | null> {
  const row = await prisma.sop.findUnique({
    where: { id },
    select: {
      ...LIST_SELECT,
      createdBy: { select: { name: true } },
      revisions: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, version: true, summary: true, createdAt: true, changedBy: { select: { name: true } } },
      },
      acknowledgements: {
        orderBy: { acknowledgedAt: 'desc' },
        select: { userId: true, version: true, acknowledgedAt: true, user: { select: { name: true } } },
      },
    },
  });
  if (!row) return null;

  const totalUsers = await prisma.user.count();
  const base = summarize(
    row,
    row.acknowledgements.map((a) => ({ userId: a.userId, version: a.version })),
    userId,
  );

  return {
    ...base,
    steps: row.steps,
    createdBy: row.createdBy?.name ?? 'Unknown',
    totalUsers,
    revisions: row.revisions.map((rev) => ({
      id: rev.id,
      version: rev.version,
      summary: rev.summary,
      changedBy: rev.changedBy?.name ?? 'Unknown',
      createdAt: rev.createdAt.toISOString(),
    })),
    acknowledgements: row.acknowledgements.map((a) => ({
      userId: a.userId,
      userName: a.user?.name ?? 'Unknown',
      version: a.version,
      acknowledgedAt: a.acknowledgedAt.toISOString(),
    })),
  };
}

export async function getSopStats(): Promise<SopStats> {
  const now = new Date();
  const [total, active, inReview, reviewOverdue] = await Promise.all([
    prisma.sop.count(),
    prisma.sop.count({ where: { status: 'Active' } }),
    prisma.sop.count({ where: { status: 'Review' } }),
    prisma.sop.count({ where: { status: 'Active', reviewDate: { lt: now } } }),
  ]);
  return { total, active, inReview, reviewOverdue };
}

// --- Writes ----------------------------------------------------------------

export async function createSop(input: {
  userId: number;
  code: string;
  title: string;
  category?: string;
  status?: string;
  version?: string;
  ownerName?: string | null;
  description?: string | null;
  steps?: unknown;
  effectiveDate?: string | null;
  reviewDate?: string | null;
}): Promise<SopSummary> {
  const code = input.code.trim();
  if (!code) throw new Error('SOP code is required');
  const title = input.title.trim();
  if (!title) throw new Error('Title is required');
  const version = (input.version ?? '').trim() || 'v1.0';

  const existing = await prisma.sop.findUnique({ where: { code }, select: { id: true } });
  if (existing) throw new Error(`An SOP with code "${code}" already exists`);

  const row = await prisma.sop.create({
    data: {
      code,
      title,
      category: pickCategory(input.category),
      status: pickStatus(input.status),
      version,
      ownerName: trimOrNull(input.ownerName),
      description: trimOrNull(input.description),
      steps: normalizeSteps(input.steps),
      effectiveDate: parseDate(input.effectiveDate),
      reviewDate: parseDate(input.reviewDate),
      createdById: input.userId,
      revisions: {
        create: { version, summary: 'Initial version created', changedById: input.userId },
      },
    },
    select: LIST_SELECT,
  });
  return summarize(row, row.acknowledgements, input.userId);
}

export async function updateSop(
  id: number,
  changedById: number,
  patch: {
    code?: string;
    title?: string;
    category?: string;
    status?: string;
    version?: string;
    ownerName?: string | null;
    description?: string | null;
    steps?: unknown;
    effectiveDate?: string | null;
    reviewDate?: string | null;
    revisionSummary?: string;
  },
): Promise<SopSummary | null> {
  const existing = await prisma.sop.findUnique({ where: { id }, select: { id: true, version: true } });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (patch.code !== undefined) {
    const v = patch.code.trim();
    if (v) data.code = v;
  }
  if (patch.title !== undefined) {
    const v = patch.title.trim();
    if (v) data.title = v;
  }
  if (patch.category !== undefined) data.category = pickCategory(patch.category);
  if (patch.status !== undefined) data.status = pickStatus(patch.status);
  if (patch.version !== undefined) {
    const v = patch.version.trim();
    if (v) data.version = v;
  }
  if (patch.ownerName !== undefined) data.ownerName = trimOrNull(patch.ownerName);
  if (patch.description !== undefined) data.description = trimOrNull(patch.description);
  if (patch.steps !== undefined) data.steps = normalizeSteps(patch.steps);
  if (patch.effectiveDate !== undefined) data.effectiveDate = parseDate(patch.effectiveDate);
  if (patch.reviewDate !== undefined) data.reviewDate = parseDate(patch.reviewDate);

  const newVersion = typeof data.version === 'string' ? data.version : existing.version;
  const versionChanged = newVersion !== existing.version;
  const summary = patch.revisionSummary?.trim();

  // Record an audit-trail revision when the version bumps or a summary is supplied.
  if (versionChanged || summary) {
    data.revisions = {
      create: {
        version: newVersion,
        summary: summary || (versionChanged ? `Updated to ${newVersion}` : 'Document updated'),
        changedById,
      },
    };
  }

  const row = await prisma.sop.update({ where: { id }, data, select: LIST_SELECT });
  return summarize(row, row.acknowledgements, changedById);
}

export async function deleteSop(id: number): Promise<boolean> {
  const existing = await prisma.sop.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return false;
  await prisma.sop.delete({ where: { id } });
  return true;
}

export type AcknowledgeResult = { acknowledged: true; version: string; ackCount: number };

export async function acknowledgeSop(sopId: number, userId: number): Promise<AcknowledgeResult | null> {
  const sop = await prisma.sop.findUnique({ where: { id: sopId }, select: { version: true } });
  if (!sop) return null;

  await prisma.sopAcknowledgement.upsert({
    where: { sopId_userId_version: { sopId, userId, version: sop.version } },
    create: { sopId, userId, version: sop.version },
    update: {},
  });

  const ackCount = await prisma.sopAcknowledgement.count({ where: { sopId, version: sop.version } });
  return { acknowledged: true, version: sop.version, ackCount };
}
