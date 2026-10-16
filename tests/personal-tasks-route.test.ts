import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireRequestAuth, personalTodoFindMany, personalTodoCreate } = vi.hoisted(() => ({
  requireRequestAuth: vi.fn(),
  personalTodoFindMany: vi.fn(),
  personalTodoCreate: vi.fn(),
}));

vi.mock('../lib/request-auth', () => ({
  requireRequestAuth,
  // Module access has its own tests (request-auth-module); these cover the route itself.
  requireModuleRequest: (request: unknown) => requireRequestAuth(request),
}));

vi.mock('../lib/prisma', () => ({
  prisma: {
    personalTodo: {
      findMany: personalTodoFindMany,
      create: personalTodoCreate,
    },
  },
}));

import { GET, POST } from '../app/api/planning/tasks/route';

describe('planning tasks collection route', () => {
  beforeEach(() => {
    requireRequestAuth.mockReset();
    personalTodoFindMany.mockReset();
    personalTodoCreate.mockReset();
  });

  it('rejects unauthenticated requests', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    });

    const response = await GET(new NextRequest('http://localhost/api/planning/tasks'));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload.error).toBe('Not authenticated');
  });

  it('lists the current user personal tasks', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 7 } },
      response: null,
    });

    personalTodoFindMany.mockResolvedValue([
      {
        id: 10,
        title: 'Pay rent',
        description: null,
        priority: 'high',
        dueDate: new Date('2026-04-30T00:00:00.000Z'),
        completed: false,
        completedAt: null,
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
        updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);

    const response = await GET(new NextRequest('http://localhost/api/planning/tasks'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(personalTodoFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 7 } }),
    );
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0].title).toBe('Pay rent');
  });

  it('creates a personal task for the authenticated user', async () => {
    requireRequestAuth.mockResolvedValue({
      auth: { user: { id: 22 } },
      response: null,
    });

    personalTodoCreate.mockResolvedValue({
      id: 13,
      title: 'Finish month-end report',
      description: 'Need figures from finance',
      priority: 'medium',
      dueDate: null,
      completed: false,
      completedAt: null,
      createdAt: new Date('2026-04-03T08:00:00.000Z'),
      updatedAt: new Date('2026-04-03T08:00:00.000Z'),
    });

    const response = await POST(
      new NextRequest('http://localhost/api/planning/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Finish month-end report',
          description: 'Need figures from finance',
          priority: 'medium',
        }),
        headers: {
          'content-type': 'application/json',
        },
      }),
    );

    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(personalTodoCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 22,
          title: 'Finish month-end report',
        }),
      }),
    );
    expect(payload.task.id).toBe(13);
  });
});
