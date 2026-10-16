import { NextRequest, NextResponse } from 'next/server';

import { z } from 'zod';

import { prisma } from '@/lib/prisma';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';

type TaskLookupClient = {
  findFirst: (args: {
    where: { id: number; userId: number };
    select: { subtasks: boolean };
  }) => Promise<{ subtasks: unknown } | null>;
  updateMany: (args: {
    where: { id: number; userId: number };
    data: { subtasks: unknown };
  }) => Promise<{ count: number }>;
};

const personalTodoClient = (
  prisma as unknown as { personalTodo: TaskLookupClient }
).personalTodo;

const subtasksBodySchema = z.object({
  subtasks: z.array(
    z.object({
      id: z.string(),
      title: z.string().trim().min(1).max(200),
      completed: z.boolean(),
    }),
  ),
});

function parseTaskId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);
  if (response || !auth) return response;

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);
  if (!taskId) return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });

  const todo = await personalTodoClient.findFirst({
    where: { id: taskId, userId: auth.user.id },
    select: { subtasks: true },
  });

  if (!todo) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ subtasks: (todo.subtasks as unknown[]) ?? [] });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);
  if (response || !auth) return response;

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);
  if (!taskId) return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = subtasksBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid subtasks data' }, { status: 400 });
  }

  const result = await personalTodoClient.updateMany({
    where: { id: taskId, userId: auth.user.id },
    data: { subtasks: parsed.data.subtasks },
  });

  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ subtasks: parsed.data.subtasks });
}
