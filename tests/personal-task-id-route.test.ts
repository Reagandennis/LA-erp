import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireRequestAuth,
  personalTodoUpdateMany,
  personalTodoFindFirst,
  personalTodoDeleteMany,
} = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  personalTodoUpdateMany: vi.fn(),
  personalTodoFindFirst: vi.fn(),
  personalTodoDeleteMany: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    personalTodo: {
      updateMany: personalTodoUpdateMany,
      findFirst: personalTodoFindFirst,
      deleteMany: personalTodoDeleteMany,
    },
  },
}));

import { DELETE, PUT } from '../app/api/planning/tasks/[taskId]/route';

describe('planning task detail route', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    personalTodoUpdateMany.mockReset();
    personalTodoFindFirst.mockReset();
    personalTodoDeleteMany.mockReset();
  });

  it('updates a personal task completion state', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 9 } }, response: null });
    personalTodoUpdateMany.mockResolvedValue({ count: 1 });
    personalTodoFindFirst.mockResolvedValue({
      id: 3,
      title: 'Close open invoices',
      description: null,
      priority: 'high',
      dueDate: null,
      completed: true,
      completedAt: new Date('2026-04-07T14:00:00.000Z'),
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      updatedAt: new Date('2026-04-07T14:00:00.000Z'),
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/planning/tasks/3', {
        method: 'PUT',
        body: JSON.stringify({ completed: true }),
        headers: {
          'content-type': 'application/json',
        },
      }),
      { params: Promise.resolve({ taskId: '3' }) },
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(personalTodoUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 3, userId: 9 } }),
    );
    expect(payload.task.completed).toBe(true);
  });

  it('soft-deletes a task by setting deletedAt', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 9 } }, response: null });
    personalTodoUpdateMany.mockResolvedValue({ count: 1 });

    const response = await DELETE(
      new NextRequest('http://localhost/api/planning/tasks/3', { method: 'DELETE' }),
      { params: Promise.resolve({ taskId: '3' }) },
    );

    expect(response.status).toBe(200);
    expect(personalTodoUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3, userId: 9 },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    // Soft delete must NOT remove the row.
    expect(personalTodoDeleteMany).not.toHaveBeenCalled();
  });

  it('restores a task via PUT { deleted: false }', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 9 } }, response: null });
    personalTodoUpdateMany.mockResolvedValue({ count: 1 });
    personalTodoFindFirst.mockResolvedValue({
      id: 3,
      title: 'Close open invoices',
      description: null,
      priority: 'high',
      status: 'Backlog',
      dueDate: null,
      completed: false,
      completedAt: null,
      deletedAt: null,
      createdAt: new Date('2026-04-07T10:00:00.000Z'),
      updatedAt: new Date('2026-04-07T14:00:00.000Z'),
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/planning/tasks/3', {
        method: 'PUT',
        body: JSON.stringify({ deleted: false }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ taskId: '3' }) },
    );

    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(personalTodoUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3, userId: 9 },
        data: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(payload.task.deletedAt).toBeNull();
  });

  it('returns not found when deleting another user task', async () => {
    requireRequestAuth.mockResolvedValue({ auth: { user: { id: 1 } }, response: null });
    personalTodoUpdateMany.mockResolvedValue({ count: 0 });

    const response = await DELETE(
      new NextRequest('http://localhost/api/planning/tasks/999', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ taskId: '999' }) },
    );

    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error).toBe('Task not found');
  });
});
