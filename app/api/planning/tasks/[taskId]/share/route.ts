import { NextRequest, NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { notifyNotificationsChanged } from '@/lib/notification-events';
import { prisma } from '@/lib/prisma';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { groupsOf, shareTodoWithGroups, todoGroupShares, unshareTodoFromGroup } from '@/lib/user-groups';

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
  const groupIds = Array.isArray(body?.groupIds) ? (body.groupIds as unknown[]).map(Number) : [];
  const normalizedIds = Array.from(
    new Set(
      userIds
        .map(Number)
        .filter((value: number) => Number.isInteger(value) && value > 0 && value !== auth.user.id),
    ),
  );

  const existingIds = normalizedIds.length
    ? (await userClient.findMany({ where: { id: { in: normalizedIds } } })).map((user) => user.id)
    : [];

  if (existingIds.length > 0) {
    const shareValues = existingIds.map((userId) => Prisma.sql`(${task.id}, ${userId})`);
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "PersonalTodoShare" ("todoId", "userId")
        VALUES ${Prisma.join(shareValues)}
        ON CONFLICT ("todoId", "userId") DO NOTHING
      `,
    );
  }

  // Groups the owner belongs to: every member sees it, including anyone who joins later.
  const groupRecipients = await shareTodoWithGroups(task.id, auth.user.id, groupIds);
  const recipients = Array.from(new Set([...existingIds, ...groupRecipients]));

  if (recipients.length > 0) {
    const message = `Task "${task.title}" was shared with you.`;
    const notificationValues = recipients.map(
      (userId) => Prisma.sql`(${userId}, ${task.id}, 'task_shared', ${message})`,
    );
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "PersonalTodoNotification" ("userId", "todoId", "type", "message")
        VALUES ${Prisma.join(notificationValues)}
      `,
    );
    notifyNotificationsChanged(recipients);
  }

  return NextResponse.json({ shared: existingIds.length, groups: groupIds.length, notified: recipients.length });
}

/** The owner's groups, and which of them the task is shared with. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);
  if (response || !auth) return response;
  const taskId = parseTaskId((await params).taskId);
  if (!taskId) return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
  const task = await personalTodoClient.findFirst({ where: { id: taskId, userId: auth.user.id }, select: { id: true, title: true } });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  const [groups, shares] = await Promise.all([groupsOf(auth.user.id), todoGroupShares([taskId])]);
  return NextResponse.json({ groups, sharedGroupIds: (shares.get(taskId) ?? []).map((g) => g.id) });
}

/** Stops sharing the task with a group (?groupId=). */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);
  if (response || !auth) return response;
  const taskId = parseTaskId((await params).taskId);
  const groupId = Number(request.nextUrl.searchParams.get('groupId'));
  if (!taskId || !Number.isInteger(groupId) || groupId <= 0) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  const task = await personalTodoClient.findFirst({ where: { id: taskId, userId: auth.user.id }, select: { id: true, title: true } });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  await unshareTodoFromGroup(taskId, groupId);
  return NextResponse.json({ removed: true });
}
