import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';

import { prisma } from './prisma';

interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  actorUserId?: number | null;
  targetUserId?: number | null;
  metadata?: Prisma.InputJsonValue;
  request?: NextRequest;
}

function getRequestContext(request?: NextRequest) {
  const forwardedFor = request?.headers.get('x-forwarded-for') ?? '';
  const ipAddress = forwardedFor.split(',')[0]?.trim() || null;

  return {
    ipAddress,
    userAgent: request?.headers.get('user-agent') ?? null,
  };
}

export async function recordAuditEvent(input: AuditInput) {
  const { ipAddress, userAgent } = getRequestContext(input.request);

  await prisma.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata,
      ipAddress,
      userAgent,
    },
  });
}

// --- Query / reporting -----------------------------------------------------

export type AuditUserRef = { id: number; email: string; name: string } | null;

export type AuditLogEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  actor: AuditUserRef;
  target: AuditUserRef;
};

export type AuditFilters = {
  q?: string;
  action?: string;
  entityType?: string;
  actorId?: number | null;
  from?: Date | null;
  to?: Date | null;
  page?: number;
  pageSize?: number;
};

export type AuditQueryResult = {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  facets: { actions: string[]; entityTypes: string[] };
};

const USER_REF_SELECT = { select: { id: true, email: true, name: true } } as const;
const MAX_PAGE_SIZE = 1000;

function buildWhere(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];

  if (filters.action) and.push({ action: filters.action });
  if (filters.entityType) and.push({ entityType: filters.entityType });
  if (filters.actorId) and.push({ actorUserId: filters.actorId });

  if (filters.from || filters.to) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (filters.from) createdAt.gte = filters.from;
    if (filters.to) createdAt.lte = filters.to;
    and.push({ createdAt });
  }

  const q = filters.q?.trim();
  if (q) {
    and.push({
      OR: [
        { action: { contains: q, mode: 'insensitive' } },
        { entityType: { contains: q, mode: 'insensitive' } },
        { entityId: { contains: q, mode: 'insensitive' } },
        { ipAddress: { contains: q, mode: 'insensitive' } },
        { actorUser: { is: { email: { contains: q, mode: 'insensitive' } } } },
        { actorUser: { is: { name: { contains: q, mode: 'insensitive' } } } },
        { targetUser: { is: { email: { contains: q, mode: 'insensitive' } } } },
        { targetUser: { is: { name: { contains: q, mode: 'insensitive' } } } },
      ],
    });
  }

  return and.length > 0 ? { AND: and } : {};
}

/** Filterable, paginated audit-log query with facet lists for the filter UI. */
export async function queryAuditLogs(filters: AuditFilters = {}): Promise<AuditQueryResult> {
  const page = Math.max(1, Math.trunc(filters.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(filters.pageSize ?? 25)));
  const where = buildWhere(filters);

  const [total, rows, actionGroups, entityGroups] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actorUser: USER_REF_SELECT, targetUser: USER_REF_SELECT },
    }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['entityType'], select: { entityType: true }, orderBy: { entityType: 'asc' } }),
  ]);

  return {
    logs: rows.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      createdAt: log.createdAt.toISOString(),
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      metadata: log.metadata,
      actor: log.actorUser,
      target: log.targetUser,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    facets: {
      actions: actionGroups.map((a) => a.action),
      entityTypes: entityGroups.map((e) => e.entityType),
    },
  };
}
