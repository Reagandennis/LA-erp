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
