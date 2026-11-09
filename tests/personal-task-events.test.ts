import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  personalTodoShare: { findMany: vi.fn() },
  personalTodo: { findMany: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import { listTaskCalendarEvents } from '../lib/personal-task-events';

const FROM = new Date('2026-11-01T00:00:00Z');
const TO = new Date('2026-12-01T00:00:00Z');

beforeEach(() => {
  db.personalTodoShare.findMany.mockReset();
  db.personalTodo.findMany.mockReset();
});

describe('listTaskCalendarEvents', () => {
  it('puts own and shared tasks on the calendar as all-day entries, tagging who shared', async () => {
    db.personalTodoShare.findMany.mockResolvedValue([{ todoId: 7 }]);
    db.personalTodo.findMany.mockResolvedValue([
      { id: 3, title: 'Renew insurance', dueDate: new Date('2026-11-12T00:00:00Z'), userId: 1, user: { name: 'Me' } },
      { id: 7, title: 'Chase invoice', dueDate: new Date('2026-11-14T00:00:00Z'), userId: 2, user: { name: 'Mary Wanjiku' } },
    ]);

    const events = await listTaskCalendarEvents(1, FROM, TO);

    expect(events).toEqual([
      { key: 'task-3', title: 'Renew insurance', startsAt: '2026-11-12T00:00:00.000Z', endsAt: null, allDay: true, tag: 'Task' },
      { key: 'task-7', title: 'Chase invoice', startsAt: '2026-11-14T00:00:00.000Z', endsAt: null, allDay: true, tag: 'Shared by Mary Wanjiku' },
    ]);

    const where = db.personalTodo.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ userId: 1 }, { id: { in: [7] } }]);
    // Only live tasks with a due date inside the window.
    expect(where).toMatchObject({ dueDate: { gte: FROM, lt: TO }, completed: false, deletedAt: null });
  });

  it('asks only for the caller’s own tasks when nothing is shared with them', async () => {
    db.personalTodoShare.findMany.mockResolvedValue([]);
    db.personalTodo.findMany.mockResolvedValue([]);

    expect(await listTaskCalendarEvents(1, FROM, TO)).toEqual([]);
    expect(db.personalTodo.findMany.mock.calls[0]![0].where.OR).toEqual([{ userId: 1 }]);
  });
});
