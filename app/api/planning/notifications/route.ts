import { NextRequest, NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

type NotificationRecord = {
  id: number;
  todoId: number;
  type: string;
  message: string;
  createdAt: Date;
  readAt: Date | null;
};

function serializeNotification(notification: NotificationRecord) {
  return {
    id: notification.id,
    todoId: notification.todoId,
    type: notification.type,
    message: notification.message,
    createdAt: notification.createdAt.toISOString(),
    readAt: notification.readAt?.toISOString() ?? null,
  };
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const notifications = await prisma.$queryRaw<NotificationRecord[]>`
    SELECT "id", "todoId", "type", "message", "createdAt", "readAt"
    FROM "PersonalTodoNotification"
    WHERE "userId" = ${auth.user.id}
    ORDER BY "createdAt" DESC
    LIMIT 10
  `;

  return NextResponse.json({ notifications: notifications.map(serializeNotification) });
}

export async function PATCH(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]) : [];
  const normalizedIds = Array.from(
    new Set(
      ids
        .map(Number)
        .filter((value: number) => Number.isInteger(value) && value > 0),
    ),
  );

  if (normalizedIds.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const updated = await prisma.$executeRaw`
    UPDATE "PersonalTodoNotification"
    SET "readAt" = NOW()
    WHERE "userId" = ${auth.user.id} AND "id" IN (${Prisma.join(normalizedIds)})
  `;

  return NextResponse.json({ updated });
}
