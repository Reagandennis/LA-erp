import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, count } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: { tripAssignment: { findMany, count } } }));

import {
  ACTIVE_ASSIGNMENT_STATUSES,
  ASSIGNMENT_SEARCH_LIMIT,
  buildAssignmentSearchWhere,
  computeStats,
  countPastAssignments,
  listCurrentAssignments,
  searchAssignments,
} from '../lib/task-assignment';

const row = {
  id: 1,
  tripId: 9,
  status: 'Active',
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  trip: { id: 9, reference: 'TR-9', title: 'Airport', status: 'Active', customer: { name: 'Acme' } },
  vehicle: null,
  driver: { id: 2, name: 'Omar' },
  officer: null,
};

describe('assignment search', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
  });

  it('matches the trip, car, driver and officer names case-insensitively', () => {
    const contains = { contains: 'omar', mode: 'insensitive' };
    expect(buildAssignmentSearchWhere(' omar ')).toEqual({
      OR: [
        { trip: { reference: contains } },
        { trip: { title: contains } },
        { trip: { customer: { name: contains } } },
        { vehicle: { registration: contains } },
        { driver: { name: contains } },
        { officer: { name: contains } },
      ],
    });
    expect(buildAssignmentSearchWhere('   ')).toEqual({});
  });

  it('caps a search at the limit and serialises rows', async () => {
    findMany.mockResolvedValue([row]);
    const items = await searchAssignments('omar', 5_000);
    expect(items).toEqual([
      expect.objectContaining({ id: 1, trip: expect.objectContaining({ customerName: 'Acme' }), driver: { id: 2, name: 'Omar' } }),
    ]);
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: ASSIGNMENT_SEARCH_LIMIT, orderBy: [{ createdAt: 'desc' }] });
  });

  it('loads only current assignments and counts the rest', async () => {
    findMany.mockResolvedValue([row]);
    count.mockResolvedValue(2_500);
    await listCurrentAssignments();
    expect(findMany.mock.calls[0][0].where).toEqual({ status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } });
    expect(await countPastAssignments()).toBe(2_500);
    expect(count).toHaveBeenCalledWith({ where: { status: { notIn: [...ACTIVE_ASSIGNMENT_STATUSES] } } });
  });

  it('counts past assignments into the stats', () => {
    const stats = computeStats({
      trips: [],
      assignments: [row as never],
      pastAssignments: 2_500,
      vehicles: [],
      drivers: [],
      officers: [],
    });
    expect(stats.assignments).toBe(2_501);
  });
});
