import { NextRequest, NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

type PersonalTodoLookupClient = {
  findFirst: (args: {
    where: { id: number; userId: number };
    select: { id: true; title: true };
  }) => Promise<{ id: number; title: string } | null>;
};

type UserLookupClient = {
  findMany: (args: { where: { id: { in: number[] } } }) => Promise<Array<{ id: number }>>;
};

const personalTodoClient = (prisma as unknown as { personalTodo: PersonalTodoLookupClient }).personalTodo;
const userClient = (prisma as unknown as { user: UserLookupClient }).user;

function parseTaskId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);

  if (response || !auth) {
    return response;
  }

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
  }

  const task = await personalTodoClient.findFirst({
    where: { id: taskId, userId: auth.user.id },
    select: { id: true, title: true },
  });

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const userIds = Array.isArray(body?.userIds) ? (body.userIds as unknown[]) : [];
  const normalizedIds = Array.from(
    new Set(
      userIds
        .map(Number)
        .filter((value: number) => Number.isInteger(value) && value > 0 && value !== auth.user.id),
    ),
  );

  if (normalizedIds.length === 0) {
    return NextResponse.json({ shared: 0, notified: 0 });
  }

  const existingUsers = await userClient.findMany({
    where: { id: { in: normalizedIds } },
  });
  const existingIds = existingUsers.map((user) => user.id);

  if (existingIds.length === 0) {
    return NextResponse.json({ shared: 0, notified: 0 });
  }

  const shareValues = existingIds.map((userId) => Prisma.sql`(${task.id}, ${userId})`);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "PersonalTodoShare" ("todoId", "userId")
      VALUES ${Prisma.join(shareValues)}
      ON CONFLICT ("todoId", "userId") DO NOTHING
    `,
  );

  const message = `Task "${task.title}" was shared with you.`;
  const notificationValues = existingIds.map(
    (userId) => Prisma.sql`(${userId}, ${task.id}, 'task_shared', ${message})`,
  );
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "PersonalTodoNotification" ("userId", "todoId", "type", "message")
      VALUES ${Prisma.join(notificationValues)}
    `,
  );

  return NextResponse.json({ shared: existingIds.length, notified: existingIds.length });
}
