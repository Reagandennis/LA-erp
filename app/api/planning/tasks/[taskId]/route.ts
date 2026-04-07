import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import { personalTodoUpdateSchema } from '@/lib/validation';

type TaskUpdateInput = {
  title?: string;
  description?: string | null;
  priority?: string;
  dueDate?: string | null;
  completed?: boolean;
};

type TaskRecord = {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  dueDate: Date | null;
  completed: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type PersonalTodoDetailClient = {
  updateMany: (args: {
    where: { id: number; userId: number };
    data: {
      title?: string;
      description?: string | null;
      priority?: string;
      dueDate?: Date | null;
      completed?: boolean;
      completedAt?: Date | null;
    };
  }) => Promise<{ count: number }>;
  findFirst: (args: { where: { id: number; userId: number } }) => Promise<TaskRecord | null>;
  deleteMany: (args: { where: { id: number; userId: number } }) => Promise<{ count: number }>;
};

const personalTodoClient = (prisma as unknown as { personalTodo: PersonalTodoDetailClient }).personalTodo;

function parseTaskId(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

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
    title: task.title,
    description: task.description,
    priority: task.priority,
    dueDate: task.dueDate?.toISOString() ?? null,
    completed: task.completed,
    completedAt: task.completedAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function normalizeUpdateInput(input: TaskUpdateInput) {
  let dueDate: Date | null | undefined;

  if (input.dueDate === undefined) {
    dueDate = undefined;
  } else {
    dueDate = parseDueDate(input.dueDate);

    if (input.dueDate && !dueDate) {
      return {
        error: 'Invalid due date',
        data: null,
      };
    }
  }

  return {
    error: null,
    data: {
      title: input.title,
      description:
        input.description === undefined
          ? undefined
          : input.description && input.description.length > 0
            ? input.description
            : null,
      priority: input.priority,
      dueDate,
      completed: input.completed,
      completedAt:
        input.completed === undefined
          ? undefined
          : input.completed
            ? new Date()
            : null,
    },
  };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const validation = personalTodoUpdateSchema.safeParse(body);

  if (!validation.success) {
    return NextResponse.json(
      { error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const normalized = normalizeUpdateInput(validation.data);

  if (normalized.error) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  if (!normalized.data) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const updateResult = await personalTodoClient.updateMany({
    where: {
      id: taskId,
      userId: auth.user.id,
    },
    data: normalized.data,
  });

  if (updateResult.count === 0) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  const task = await personalTodoClient.findFirst({
    where: {
      id: taskId,
      userId: auth.user.id,
    },
  });

  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({ task: serializeTask(task) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const { auth, response } = await requireRequestAuth(request);

  if (response || !auth) {
    return response;
  }

  const { taskId: rawTaskId } = await params;
  const taskId = parseTaskId(rawTaskId);

  if (!taskId) {
    return NextResponse.json({ error: 'Invalid task id' }, { status: 400 });
  }

  const result = await personalTodoClient.deleteMany({
    where: {
      id: taskId,
      userId: auth.user.id,
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
