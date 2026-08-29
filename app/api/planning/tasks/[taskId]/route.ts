import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';
import { requireRequestAuth } from '@/lib/request-auth';
import { personalTodoUpdateSchema } from '@/lib/validation';

type TaskUpdateInput = {
  title?: string;
  description?: string | null;
  priority?: string;
  status?: string;
  startDate?: string | null;
  dueDate?: string | null;
  completed?: boolean;
  deleted?: boolean;
};

type TaskRecord = {
  id: number;
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

type PersonalTodoDetailClient = {
  updateMany: (args: {
    where: { id: number; userId: number };
    data: {
      title?: string;
      description?: string | null;
      priority?: string;
      status?: string;
      startDate?: Date | null;
      dueDate?: Date | null;
      completed?: boolean;
      completedAt?: Date | null;
      deletedAt?: Date | null;
    };
  }) => Promise<{ count: number }>;
  findFirst: (args: { where: { id: number; userId: number } }) => Promise<TaskRecord | null>;
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

  let startDate: Date | null | undefined;

  if (input.startDate === undefined) {
    startDate = undefined;
  } else {
    startDate = parseDueDate(input.startDate);

    if (input.startDate && !startDate) {
      return {
        error: 'Invalid start date',
        data: null,
      };
    }
  }

  // Only checkable when the caller sends both — `updateMany` is a partial
  // update, so a start-only PUT can't see the stored due date without a read.
  // The drag path always sends the pair, which is the case that matters.
  if (startDate && dueDate && startDate.getTime() > dueDate.getTime()) {
    return {
      error: 'Start date must be on or before the due date',
      data: null,
    };
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
      status: input.status,
      startDate,
      dueDate,
      completed: input.completed,
      completedAt:
        input.completed === undefined
          ? undefined
          : input.completed
            ? new Date()
            : null,
      // `deleted: false` restores a soft-deleted task; `deleted: true` archives it.
      deletedAt:
        input.deleted === undefined ? undefined : input.deleted ? new Date() : null,
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

  let updateResult: { count: number };
  let task: TaskRecord | null;

  try {
    updateResult = await personalTodoClient.updateMany({
      where: {
        id: taskId,
        userId: auth.user.id,
      },
      data: normalized.data,
    });

    if (updateResult.count === 0) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    task = await personalTodoClient.findFirst({
      where: {
        id: taskId,
        userId: auth.user.id,
      },
    });
  } catch (error) {
    // Surface the reason instead of a bare 500. A stale Prisma client — a dev
    // server still running from before a migration — reports the new column as
    // an unknown argument here, which is otherwise invisible from the client.
    console.error('[planning/tasks] update failed', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not update the task' },
      { status: 500 },
    );
  }

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

  // Soft delete: keep the row so the task stays visible and restorable under the
  // "Deleted" filter. Hard removal would lose the history the user wants to see.
  const result = await personalTodoClient.updateMany({
    where: {
      id: taskId,
      userId: auth.user.id,
    },
    data: {
      deletedAt: new Date(),
    },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
