import 'server-only';

import { prisma } from '@/lib/prisma';

/** A task with a due date, shaped for the Calendar module's `extraEvents`. */
export interface TaskCalendarEvent {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  tag: string;
}

/**
 * The tasks that belong on `userId`'s calendar: their own and the ones shared
 * with them, due within the window, not done and not deleted. A shared task is
 * tagged so it reads as someone else's ask.
 */
export async function listTaskCalendarEvents(userId: number, from: Date, to: Date): Promise<TaskCalendarEvent[]> {
  const shared = await prisma.personalTodoShare.findMany({ where: { userId }, select: { todoId: true } });
  const sharedIds = shared.map((s) => s.todoId);

  const tasks = await prisma.personalTodo.findMany({
    where: {
      OR: [{ userId }, ...(sharedIds.length > 0 ? [{ id: { in: sharedIds } }] : [])],
      dueDate: { gte: from, lt: to },
      completed: false,
      deletedAt: null,
    },
    select: { id: true, title: true, dueDate: true, userId: true, user: { select: { name: true } } },
    orderBy: { dueDate: 'asc' },
  });

  return tasks.map((task) => {
    const mine = task.userId === userId;
    return {
      key: `task-${task.id}`,
      title: task.title,
      startsAt: task.dueDate!.toISOString(),
      endsAt: null,
      allDay: true,
      tag: mine ? 'Task' : `Shared by ${task.user.name}`,
    };
  });
}
