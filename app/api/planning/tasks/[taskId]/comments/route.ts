import { NextRequest, NextResponse } from 'next/server';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

type TaskLookupClient = {
  findFirst: (args: { where: { id: number; userId: number } }) => Promise<{ id: number } | null>;
};

type CommentRecord = {
  id: number;
  body: string;
  createdAt: Date;
  authorName: string;
};

const personalTodoClient = (prisma as unknown as { personalTodo: TaskLookupClient }).personalTodo;

function parseTaskId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function hasAccess(taskId: number, userId: number) {
  const owned = await personalTodoClient.findFirst({
    where: { id: taskId, userId },
  });
  if (owned) {
    return true;
  }

  const shared = await prisma.$queryRaw<Array<{ todoId: number }>>`
    SELECT "todoId" FROM "PersonalTodoShare" WHERE "todoId" = ${taskId} AND "userId" = ${userId}
  `;

  return shared.length > 0;
}

function serializeComment(comment: CommentRecord) {
  return {
    id: comment.id,
    text: comment.body,
    author: comment.authorName,
    createdAt: comment.createdAt.toISOString(),
  };
}

export async function GET(
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

  const canAccess = await hasAccess(taskId, auth.user.id);

  if (!canAccess) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const comments = await prisma.$queryRaw<CommentRecord[]>`
    SELECT c."id", c."body", c."createdAt", u."name" as "authorName"
    FROM "PersonalTodoComment" c
    JOIN "User" u ON u."id" = c."userId"
    WHERE c."todoId" = ${taskId}
    ORDER BY c."createdAt" DESC
  `;

  return NextResponse.json({ comments: comments.map(serializeComment) });
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

  const canAccess = await hasAccess(taskId, auth.user.id);

  if (!canAccess) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const rawUserIds = Array.isArray(body?.userIds) ? (body.userIds as unknown[]) : [];
  const mentionIds = Array.from(
    new Set(
      rawUserIds
        .map(Number)
        .filter((value: number) => Number.isInteger(value) && value > 0),
    ),
  );

  if (!text) {
    return NextResponse.json({ error: 'Comment text is required' }, { status: 400 });
  }

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "PersonalTodoComment" ("todoId", "userId", "body")
      VALUES (${taskId}, ${auth.user.id}, ${text})
    `,
  );

  if (mentionIds.length > 0) {
    const shareValues = mentionIds.map((userId) => Prisma.sql`(${taskId}, ${userId})`);
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "PersonalTodoShare" ("todoId", "userId")
        VALUES ${Prisma.join(shareValues)}
        ON CONFLICT ("todoId", "userId") DO NOTHING
      `,
    );

    const message = `Task was shared with you.`;
    const notificationValues = mentionIds.map(
      (userId) => Prisma.sql`(${userId}, ${taskId}, 'task_shared', ${message})`,
    );
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "PersonalTodoNotification" ("userId", "todoId", "type", "message")
        VALUES ${Prisma.join(notificationValues)}
      `,
    );
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
