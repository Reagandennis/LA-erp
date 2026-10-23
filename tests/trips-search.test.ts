import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, count, groupBy } = vi.hoisted(() => ({ findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: { trip: { findMany, count, groupBy } } }));
vi.mock('../lib/attachment-types', () => ({ isPreviewableImage: () => false }));

import {
  TRIP_PAGE_SIZE,
  TRIP_PAGE_SIZE_MAX,
  buildTripSearchWhere,
  countTripsByStatus,
  normalizeTripPaging,
  searchTrips,
  tripSearchOrderBy,
} from '../lib/trips';

function row(id: number) {
  return {
    id,
    reference: `TR-${id}`,
    trackingCode: `LA-${id}`,
    title: 'Trip',
    status: 'Planned',
    currency: 'USD',
    startDate: null,
    endDate: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    customer: { id: 1, name: 'Acme', company: null, email: null },
    travelers: [],
    createdBy: { id: 1, name: 'A', email: 'a@x' },
    owner: null,
    sourceQuote: null,
    _count: { assignments: 0, logEntries: 0, items: 2 },
  };
}

describe('trip search query', () => {
  beforeEach(() => {
    findMany.mockReset();
    count.mockReset();
    groupBy.mockReset();
  });

  it('admins see everything; others only their own trips', () => {
    expect(buildTripSearchWhere({ userId: 4, isAdmin: true })).toEqual({ AND: [{}] });
    expect(buildTripSearchWhere({ userId: 4, isAdmin: false })).toEqual({
      AND: [{ OR: [{ createdById: 4 }, { ownerId: 4 }] }],
    });
  });

  it('adds the status filter and a case-insensitive search across the row and its names', () => {
    const where = buildTripSearchWhere({ userId: 1, isAdmin: true, status: 'Active', q: '  Omar ' });
    const contains = { contains: 'Omar', mode: 'insensitive' };
    expect(where).toEqual({
      AND: [
        {},
        { status: 'Active' },
        {
          OR: [
            { reference: contains },
            { trackingCode: contains },
            { title: contains },
            { customer: { name: contains } },
            { customer: { company: contains } },
            { travelers: { some: { traveler: { name: contains } } } },
          ],
        },
      ],
    });
  });

  it('ignores a blank search', () => {
    expect(buildTripSearchWhere({ userId: 1, isAdmin: true, q: '   ' })).toEqual({ AND: [{}] });
  });

  it('defaults and caps the page size', () => {
    expect(normalizeTripPaging({})).toEqual({ page: 1, pageSize: TRIP_PAGE_SIZE });
    expect(normalizeTripPaging({ page: 0, pageSize: -5 })).toEqual({ page: 1, pageSize: TRIP_PAGE_SIZE });
    expect(normalizeTripPaging({ page: 3, pageSize: 10_000 })).toEqual({ page: 3, pageSize: TRIP_PAGE_SIZE_MAX });
  });

  it('orders by last update unless a start-date sort is asked for, dateless trips last', () => {
    expect(tripSearchOrderBy()).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    expect(tripSearchOrderBy('updated')).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    expect(tripSearchOrderBy('start-asc')).toEqual([{ startDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }]);
    expect(tripSearchOrderBy('start-desc')).toEqual([{ startDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]);
  });

  it('sorts the page as asked', async () => {
    findMany.mockResolvedValue([row(1)]);
    count.mockResolvedValue(1);

    await searchTrips({ userId: 1, isAdmin: true, sort: 'start-asc' });

    expect(findMany.mock.calls[0][0].orderBy).toEqual([{ startDate: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }]);
  });

  it('fetches one page with its total and never the long text fields', async () => {
    findMany.mockResolvedValue([row(2), row(1)]);
    count.mockResolvedValue(77);

    const page = await searchTrips({ userId: 1, isAdmin: true, page: 2, pageSize: 2 });

    expect(page).toMatchObject({ total: 77, page: 2, pageSize: 2 });
    expect(page.trips.map((t) => t.id)).toEqual([2, 1]);
    expect(page.trips[0]).toMatchObject({ description: null, notes: null, itemCount: 2 });
    const args = findMany.mock.calls[0][0];
    expect(args).toMatchObject({ skip: 2, take: 2, omit: { description: true, notes: true } });
    expect(args.orderBy).toEqual([{ updatedAt: 'desc' }, { id: 'desc' }]);
    expect(count).toHaveBeenCalledWith({ where: args.where });
  });

  it('counts trips per status with a total', async () => {
    groupBy.mockResolvedValue([
      { status: 'Completed', _count: { _all: 1523 } },
      { status: 'Active', _count: { _all: 9 } },
    ]);
    expect(await countTripsByStatus(3, false)).toEqual({
      Draft: 0,
      Planned: 0,
      Active: 9,
      Completed: 1523,
      Cancelled: 0,
      total: 1532,
    });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['status'], where: { OR: [{ createdById: 3 }, { ownerId: 3 }] } }),
    );
  });
});
