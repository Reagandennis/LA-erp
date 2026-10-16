import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { API_ACCESS } from '@/lib/api-access';
import { requireModuleRequest } from '@/lib/request-auth';
import { personalTodoCreateSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type TaskRecord = {
  id: number;
  userId: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  startDate: Date | null;
  dueDate: Date | null;
  completed: boolean;
  completedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PersonalTodoCollectionClient = {
  findMany: (args: {
    where: { userId: number } | { OR: Array<{ userId: number } | { id: { in: number[] } }> };
    orderBy: Array<{
      completed?: 'asc' | 'desc';
      dueDate?: 'asc' | 'desc';
      createdAt?: 'asc' | 'desc';
    }>;
  }) => Promise<TaskRecord[]>;
  create: (args: {
    data: {
      userId: number;
      title: string;
      description: string | null;
      priority: string;
      status: string;
      startDate: Date | null;
      dueDate: Date | null;
      completed: boolean;
      completedAt: Date | null;
    };
  }) => Promise<TaskRecord>;
};

const personalTodoClient = (prisma as unknown as { personalTodo: PersonalTodoCollectionClient }).personalTodo;

function parseDueDate(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeTask(task: TaskRecord) {
  return {
    id: task.id,
    userId: task.userId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    startDate: task.startDate?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    completed: task.completed,
    completedAt: task.completedAt?.toISOString() ?? null,
    deletedAt: task.deletedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);

  if (response || !auth) {
    return response;
  }

  let sharedIds: number[] = [];

  try {
    const sharedResults = await prisma.$queryRaw<Array<{ todoId: number }>>`
      SELECT "todoId" FROM "PersonalTodoShare" WHERE "userId" = ${auth.user.id}
    `;
    sharedIds = sharedResults.map((row) => row.todoId);
  } catch {
    sharedIds = [];
  }

  const whereClause = sharedIds.length
    ? {
        OR: [{ userId: auth.user.id }, { id: { in: sharedIds } }],
      }
    : { userId: auth.user.id };

  const tasks = await personalTodoClient.findMany({
    where: whereClause,
    orderBy: [{ completed: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
  });

  const sharedIdSet = new Set(sharedIds);
  const serialized = tasks.map((task) => ({
    ...serializeTask(task),
    isShared: sharedIdSet.has(task.id) && task.userId !== auth.user.id,
  }));

  return NextResponse.json({ tasks: serialized });
}

export async function POST(request: NextRequest) {
  const { auth, response } = await requireModuleRequest(request, ...API_ACCESS.tasks);

  if (response || !auth) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const validation = personalTodoCreateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const dueDate = parseDueDate(validation.data.dueDate);
  const startDate = parseDueDate(validation.data.startDate);
  const isCompleted = validation.data.completed ?? false;

  if (validation.data.dueDate && !dueDate) {
    return NextResponse.json({ error: 'Invalid due date' }, { status: 400 });
  }

  if (validation.data.startDate && !startDate) {
    return NextResponse.json({ error: 'Invalid start date' }, { status: 400 });
  }

  const task = await personalTodoClient.create({
    data: {
      userId: auth.user.id,
      title: validation.data.title,
      description:
        validation.data.description && validation.data.description.length > 0
          ? validation.data.description
          : null,
      priority: validation.data.priority,
      status: validation.data.status,
      startDate,
      dueDate,
      completed: isCompleted,
      completedAt: isCompleted ? new Date() : null,
    },
  });

  return NextResponse.json({ task: serializeTask(task) }, { status: 201 });
}
