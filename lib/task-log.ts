import 'server-only';

import { prisma } from './prisma';

export type TaskLogState = 'Active' | 'Completed' | 'Deleted';

export interface TaskLogEntry {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  state: TaskLogState;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: number; name: string; email: string };
}

function deriveState(row: { completed: boolean; deletedAt: Date | null }): TaskLogState {
  if (row.deletedAt) return 'Deleted';
  if (row.completed) return 'Completed';
  return 'Active';
}

/**
 * Lists every personal task as a historical log — including completed and
 * soft-deleted ones. A normal user sees only their own tasks; an admin sees all.
 */
export async function listTaskLogEntries(params: {
  userId: number;
  isAdmin: boolean;
}): Promise<TaskLogEntry[]> {
  const rows = await prisma.personalTodo.findMany({
    where: params.isAdmin ? {} : { userId: params.userId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      status: true,
      dueDate: true,
      completed: true,
      completedAt: true,
      deletedAt: true,
      createdAt: true,
      updatedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    state: deriveState(row),
    dueDate: row.dueDate ? row.dueDate.toISOString() : null,
    completed: row.completed,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    owner: row.user,
  }));
}
