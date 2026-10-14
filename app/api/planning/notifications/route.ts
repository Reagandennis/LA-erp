import { NextRequest, NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { listPersonalTodoNotifications } from '@/lib/notification-feed';
import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';

export async function GET(request: NextRequest) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const notifications = await listPersonalTodoNotifications(auth.user.id);
  return NextResponse.json({ notifications });
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
