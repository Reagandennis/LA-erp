import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  trip: { findUnique: vi.fn() },
  tripAssignment: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  tripItineraryItem: { findMany: vi.fn() },
  vehicle: { findUnique: vi.fn() },
  driver: { findUnique: vi.fn() },
  officer: { findUnique: vi.fn() },
}));

vi.mock('server-only', () => ({}));
vi.mock('../lib/prisma', () => ({ prisma: db }));

import {
  assertNoResourceConflicts,
  createAssignment,
  listEngagements,
  ResourceConflictError,
} from '../lib/task-assignment';

const KENYA = { reference: 'MCF-KEN-NOV-2701', title: 'Nairobi detail', startDate: new Date('2026-11-10T00:00:00Z'), endDate: new Date('2026-11-14T00:00:00Z') };

beforeEach(() => {
  for (const table of Object.values(db)) for (const fn of Object.values(table)) fn.mockReset();
  db.tripAssignment.findMany.mockResolvedValue([]);
  db.tripItineraryItem.findMany.mockResolvedValue([]);
  db.vehicle.findUnique.mockResolvedValue({ registration: 'KDA 123A' });
  db.driver.findUnique.mockResolvedValue({ name: 'Peter Kamau' });
  db.officer.findUnique.mockResolvedValue({ name: 'Jane Achieng' });
});

describe('listEngagements', () => {
  it('turns allocations and crewed movements into per-resource day ranges', async () => {
    db.tripAssignment.findMany.mockResolvedValue([
      { id: 5, tripId: 1, status: 'Confirmed', vehicleId: 30, driverId: 2, officerId: null, trip: KENYA },
    ]);
    db.tripItineraryItem.findMany.mockResolvedValue([
      {
        id: 501,
        tripId: 7,
        scheduledAt: new Date('2026-11-20T06:30:00Z'),
        endsAt: null,
        vehicleId: 30,
        driverId: null,
        officerId: 9,
        trip: { reference: 'LA-KEN-NOV-2710', title: 'Airport run', status: 'Active' },
      },
    ]);

    const out = await listEngagements();

    expect(out).toEqual([
      expect.objectContaining({ kind: 'vehicle', resourceId: 30, tripId: 1, from: '2026-11-10', to: '2026-11-14', source: 'assignment', assignmentId: 5 }),
      expect.objectContaining({ kind: 'driver', resourceId: 2, tripId: 1, source: 'assignment' }),
      expect.objectContaining({ kind: 'vehicle', resourceId: 30, tripId: 7, from: '2026-11-20', to: '2026-11-20', source: 'movement', assignmentId: null, itemId: 501 }),
      expect.objectContaining({ kind: 'officer', resourceId: 9, tripId: 7, source: 'movement' }),
    ]);
    // Closed trips hold nobody, and only live allocations count.
    const where = db.tripAssignment.findMany.mock.calls[0]![0].where;
    expect(where.status).toEqual({ in: ['Planned', 'Confirmed', 'Active'] });
    expect(where.trip).toEqual({ status: { notIn: ['Cancelled', 'Completed'] } });
    // The grid's movements are bounded to a window around today.
    const movementWhere = db.tripItineraryItem.findMany.mock.calls[0]![0].where;
    expect(movementWhere.scheduledAt.gte).toBeInstanceOf(Date);
    expect(movementWhere.scheduledAt.lte).toBeInstanceOf(Date);
  });

  it('narrows to the asked-for resources for a conflict check, with no date window', async () => {
    await listEngagements({ resources: { vehicle: [30], driver: [], officer: [] } });
    const where = db.tripAssignment.findMany.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ vehicleId: { in: [30] } }]);
    const movementWhere = db.tripItineraryItem.findMany.mock.calls[0]![0].where;
    expect(movementWhere.scheduledAt).toEqual({ not: null });
    expect(movementWhere.OR).toEqual([{ vehicleId: { in: [30] } }]);
  });

  it('asks the database nothing when no resource is picked', async () => {
    expect(await listEngagements({ resources: {} })).toEqual([]);
    expect(db.tripAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe('assertNoResourceConflicts', () => {
  it('lets a car take a trip on days it is free', async () => {
    db.trip.findUnique.mockResolvedValue({ startDate: new Date('2026-11-15T00:00:00Z'), endDate: new Date('2026-11-18T00:00:00Z') });
    db.tripAssignment.findMany.mockResolvedValue([
      { id: 5, tripId: 1, status: 'Confirmed', vehicleId: 30, driverId: null, officerId: null, trip: KENYA },
    ]);

    await expect(assertNoResourceConflicts({ tripId: 9, vehicleId: 30, driverId: null, officerId: null })).resolves.toBeUndefined();
  });

  it('refuses a car already on another trip for overlapping days, naming the trip and dates', async () => {
    db.trip.findUnique.mockResolvedValue({ startDate: new Date('2026-11-13T00:00:00Z'), endDate: new Date('2026-11-18T00:00:00Z') });
    db.tripAssignment.findMany.mockResolvedValue([
      { id: 5, tripId: 1, status: 'Confirmed', vehicleId: 30, driverId: 2, officerId: null, trip: KENYA },
    ]);

    const attempt = assertNoResourceConflicts({ tripId: 9, vehicleId: 30, driverId: 2, officerId: null });
    await expect(attempt).rejects.toBeInstanceOf(ResourceConflictError);
    const error = (await attempt.catch((e: ResourceConflictError) => e)) as ResourceConflictError;
    expect(error.message).toBe(
      'Car KDA 123A is already on MCF-KEN-NOV-2701 (10–14 Nov). Pick another car. ' +
        'Driver Peter Kamau is already on MCF-KEN-NOV-2701 (10–14 Nov). Pick another driver.',
    );
    expect(error.conflicts.map((c) => [c.kind, c.resourceId, c.label])).toEqual([
      ['vehicle', 30, 'Car KDA 123A'],
      ['driver', 2, 'Driver Peter Kamau'],
    ]);
    expect(error.conflicts[0]!.conflicts[0]).toMatchObject({ tripId: 1, from: '2026-11-10', to: '2026-11-14' });
  });

  it('counts a crewed itinerary movement on another trip as busy', async () => {
    db.trip.findUnique.mockResolvedValue({ startDate: new Date('2026-11-13T00:00:00Z'), endDate: new Date('2026-11-18T00:00:00Z') });
    db.tripItineraryItem.findMany.mockResolvedValue([
      { tripId: 7, scheduledAt: new Date('2026-11-16T06:30:00Z'), endsAt: null, vehicleId: null, driverId: null, officerId: 9, trip: { reference: 'LA-KEN-NOV-2710', title: 'Airport run', status: 'Active' } },
    ]);

    await expect(assertNoResourceConflicts({ tripId: 9, vehicleId: null, driverId: null, officerId: 9 })).rejects.toThrow(
      'Officer Jane Achieng is already on LA-KEN-NOV-2710 (16 Nov). Pick another officer.',
    );
  });

  it('allows the same person on several bookings of the same trip, and an edit of itself', async () => {
    db.trip.findUnique.mockResolvedValue({ startDate: new Date('2026-11-10T00:00:00Z'), endDate: new Date('2026-11-14T00:00:00Z') });
    db.tripAssignment.findMany.mockResolvedValue([
      { id: 5, tripId: 1, status: 'Confirmed', vehicleId: 30, driverId: null, officerId: null, trip: KENYA },
      { id: 6, tripId: 1, status: 'Planned', vehicleId: null, driverId: 2, officerId: null, trip: KENYA },
    ]);

    await expect(assertNoResourceConflicts({ tripId: 1, vehicleId: 30, driverId: 2, officerId: null })).resolves.toBeUndefined();
    await expect(
      assertNoResourceConflicts({ tripId: 9, vehicleId: 30, driverId: null, officerId: null, excludeAssignmentId: 5 }),
    ).resolves.toBeUndefined();
  });

  it('holds busy people for a trip whose dates are not set yet, and says why', async () => {
    db.trip.findUnique.mockResolvedValue({ startDate: null, endDate: null });
    db.tripAssignment.findMany.mockResolvedValue([
      { id: 5, tripId: 1, status: 'Confirmed', vehicleId: 30, driverId: null, officerId: null, trip: KENYA },
    ]);

    await expect(assertNoResourceConflicts({ tripId: 9, vehicleId: 30, driverId: null, officerId: null })).rejects.toThrow(
      /This trip has no dates yet, so anyone busy is held until it does\.$/,
    );
  });
});

describe('createAssignment', () => {
  it('checks against the trip being booked before writing', async () => {
    db.trip.findUnique.mockResolvedValue({ id: 9, startDate: new Date('2026-11-13T00:00:00Z'), endDate: new Date('2026-11-18T00:00:00Z') });
    db.tripAssignment.findMany.mockResolvedValue([
      { id: 5, tripId: 1, status: 'Confirmed', vehicleId: 30, driverId: null, officerId: null, trip: KENYA },
    ]);

    await expect(createAssignment({ userId: 1, tripId: 9, vehicleId: 30 })).rejects.toBeInstanceOf(ResourceConflictError);
    expect(db.tripAssignment.create).not.toHaveBeenCalled();
  });

  it('skips the check for an allocation that holds nobody (completed or cancelled)', async () => {
    db.trip.findUnique.mockResolvedValue({ id: 9 });
    db.tripAssignment.create.mockResolvedValue({
      id: 11, tripId: 9, status: 'Completed', notes: null, createdAt: new Date(),
      trip: { id: 9, reference: 'X', title: 'T', status: 'Active', startDate: null, endDate: null, customer: { name: 'Acme' } },
      vehicle: { id: 30, registration: 'KDA 123A', type: 'SUV' }, driver: null, officer: null,
    });

    const item = await createAssignment({ userId: 1, tripId: 9, vehicleId: 30, status: 'Completed' });
    expect(item.trip).toMatchObject({ startDate: null, endDate: null, customerName: 'Acme' });
    expect(db.tripAssignment.findMany).not.toHaveBeenCalled();
  });
});
